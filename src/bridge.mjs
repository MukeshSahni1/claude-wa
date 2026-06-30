// The bridge: connect to WhatsApp (Baileys), print a QR to link, and route your
// messages to Claude Code (or raw shell), replying in chat.
//
// OPEN mode (default): no PIN. Your "Message yourself" chat is the console —
//   every message there is a prompt, with conversation memory across messages.
//   Other chats are ignored, so Claude never hijacks your real conversations.
// PIN mode (--pin): messages must start with "<PIN> "; works across the
//   self-chat plus any --allow numbers.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { existsSync, mkdirSync } from 'node:fs';
import { runClaude, runShell } from './claude.mjs';
import { isTrusted, saveBoundJid } from './config.mjs';

const seen = new Set(); // de-dupe processed message ids
function markSeen(id) { if (id) { seen.add(id); if (seen.size > 1000) seen.clear(); } }

function helpText(cfg) {
  const lead = cfg.requirePin ? `${cfg.pin} ` : '';
  return [
    'claude-wa — Claude Code over WhatsApp',
    '',
    cfg.requirePin
      ? `Send:  ${cfg.pin} <message>  (PIN must lead every message)`
      : 'Just type — every message here goes to Claude Code.',
    `  ${lead}add a /health route and run the tests   → Claude edits / acts`,
    cfg.shell ? `  ${lead}!docker ps                            → raw shell command` : null,
    `  ${lead}/new                                  → start a fresh conversation`,
    `  ${lead}help                                  → this menu`,
    '',
    `Mode: ${cfg.readOnly ? 'READ-ONLY' : 'ACTION'}${cfg.continueConversation ? ' · remembers context' : ''} · dir: ${cfg.workdir}`,
  ].filter(Boolean).join('\n');
}

async function handle(raw, jid, sock, cfg, state, who) {
  const reply = (t) => sock.sendMessage(jid, { text: t }).catch((e) => console.log('[reply] failed:', e?.message));
  console.log(`[cmd] ${who}: ${raw.slice(0, 120)}`);

  const lower = raw.toLowerCase().trim();
  if (lower === 'help' || lower === '/help') return void reply(helpText(cfg));
  if (lower === '/new' || lower === '/reset' || lower === 'new chat') {
    state.started = false;
    return void reply('🆕 Started a fresh conversation. Send your next message.');
  }

  const isShell = cfg.shell && (raw.startsWith('!') || lower.startsWith('sh '));
  let out;
  if (isShell) {
    const cmd = raw.startsWith('!') ? raw.slice(1).trim() : raw.slice(3).trim();
    out = await runShell(cmd, cfg);
  } else {
    out = await runClaude(raw, cfg, { continue: cfg.continueConversation && state.started });
    state.started = true;
  }
  if (out.length > cfg.replyChunk) out = out.slice(0, cfg.replyChunk) + `\n…(+${out.length - cfg.replyChunk} more chars)`;
  await reply(isShell ? '```\n' + out + '\n```' : out);
}

function isConsole(jid, cfg, state) {
  if (cfg.anyChat) return true;
  const n = jidNormalizedUser(jid);
  if (cfg.chatJid && n === jidNormalizedUser(cfg.chatJid)) return true;
  if (state.selfIds.has(n)) return true;
  if (state.boundJid && n === state.boundJid) return true;
  return false;
}

async function onMessage(m, sock, cfg, state) {
  const ts = Number(m.messageTimestamp || 0);
  if (ts && Date.now() / 1000 - ts > 120) return;            // skip history / stale on reconnect
  const id = m.key?.id;
  if (id && seen.has(id)) return;                            // de-dupe
  const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
  if (!text) return;
  const fromMe = Boolean(m.key?.fromMe);
  const jid = m.key?.remoteJid || '';
  const num = jid.split('@')[0];

  if (cfg.requirePin) {
    // PIN MODE — exact prefix, self or allow-listed numbers, any chat.
    if (!text.startsWith(cfg.pin + ' ')) return;
    if (!fromMe && !cfg.allow.includes(num)) return;
    const raw = text.slice(cfg.pin.length + 1).trim();
    if (!raw) return;
    markSeen(id);
    return handle(raw, jid, sock, cfg, state, fromMe ? 'self' : num);
  }

  // OPEN MODE — no PIN; only the console (self) chat, or allow-listed numbers.
  if (!fromMe && !cfg.allow.includes(num)) return;

  let console_ = isConsole(jid, cfg, state);
  // Fallback: if the self-chat couldn't be auto-detected (no lid from WhatsApp)
  // and nothing else is configured, bind the first chat we hear from as console.
  if (!console_ && fromMe && !state.hasLid && !state.boundJid && !cfg.chatJid && !cfg.anyChat) {
    state.boundJid = jidNormalizedUser(jid);
    saveBoundJid(state.boundJid);
    console.log('[bind] open-mode console bound to:', state.boundJid);
    console_ = true;
  }
  if (!console_) return;

  markSeen(id);
  return handle(text, jid, sock, cfg, state, fromMe ? 'self' : num);
}

export async function startBridge(cfg) {
  if (!existsSync(cfg.authDir)) mkdirSync(cfg.authDir, { recursive: true });

  if (!cfg.readOnly && !isTrusted(cfg.workdir)) {
    console.log(`\n⚠  Claude Code is not yet trusted for: ${cfg.workdir}`);
    console.log('   Action mode (edits/shell) may be refused until you trust it.');
    console.log('   Fix: run  claude-wa --accept-trust  once (or open `claude` there and accept the dialog).\n');
  }

  const logger = pino({ level: 'silent' });
  const state = { selfIds: new Set(), hasLid: false, boundJid: cfg.boundJid || null, started: false };

  async function connect() {
    const { state: auth, saveCreds } = await useMultiFileAuthState(cfg.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth, logger, browser: ['claude-wa', 'Chrome', '1.0.0'] });

    if (cfg.pair && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(String(cfg.pair).replace(/[^0-9]/g, ''));
          const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('\n===========  WHATSAPP PAIRING CODE  ===========');
          console.log(`  Number : +${cfg.pair}`);
          console.log(`  Code   : ${pretty}`);
          console.log('  WhatsApp > Linked Devices > Link a device > "Link with phone number instead"');
          console.log('===============================================\n');
        } catch (e) {
          console.log('[pair] requestPairingCode failed:', e?.message);
        }
      }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !cfg.pair) {
        console.log('\n=============  SCAN THIS QR WITH WHATSAPP  =============\n');
        qrcode.generate(qr, { small: true });
        console.log('\n  WhatsApp > Settings > Linked Devices > Link a device\n');
      }
      if (connection === 'open') {
        const me = sock.user || {};
        state.selfIds = new Set([me.id, me.lid].filter(Boolean).map(jidNormalizedUser));
        state.hasLid = Boolean(me.lid);
        console.log('\n✅  Connected. Your WhatsApp is now a Claude Code remote.');
        if (cfg.requirePin) {
          console.log(`   Text:  ${cfg.pin} <message>   from this account.`);
        } else {
          console.log('   Just message your "Message yourself" chat — every message goes to Claude.');
          console.log('   ("/new" = fresh conversation · "help" = menu)');
        }
        console.log(`   Mode: ${cfg.readOnly ? 'READ-ONLY' : 'ACTION (edits + shell)'}${cfg.continueConversation ? ' · remembers context' : ''} · dir: ${cfg.workdir}\n`);
      }
      if (connection === 'close') {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log(`Connection closed (code ${code}). ${loggedOut ? 'Logged out — delete the auth dir and re-run to re-link.' : 'Reconnecting…'}`);
        if (!loggedOut) connect();
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const m of messages) {
        try { await onMessage(m, sock, cfg, state); }
        catch (e) { console.log('[handler] error:', e?.message); }
      }
    });
  }

  await connect();
}
