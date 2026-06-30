// The bridge: connect to WhatsApp (Baileys), print a QR to link, and route
// PIN-prefixed inbound messages to Claude Code (or raw shell), replying in chat.

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { existsSync, mkdirSync } from 'node:fs';
import { runClaude, runShell } from './claude.mjs';
import { isTrusted } from './config.mjs';

const seen = new Set(); // de-dupe processed message ids

function helpText(cfg) {
  return [
    'claude-wa — Claude Code over WhatsApp',
    '',
    `Send:  ${cfg.pin} <message>`,
    `  ${cfg.pin} hi                 → chat with Claude Code`,
    cfg.readOnly
      ? `  ${cfg.pin} what changed in X   → Claude reads & answers (read-only)`
      : `  ${cfg.pin} fix the bug in X    → Claude edits / acts`,
    cfg.shell ? `  ${cfg.pin} !uptime            → run a raw shell command` : null,
    cfg.shell ? `  ${cfg.pin} sh ls -la          → same, alt syntax` : null,
    `  ${cfg.pin} help               → this menu`,
    '',
    'Every message must start with the PIN. Messages without it are ignored.',
    `Mode: ${cfg.readOnly ? 'READ-ONLY' : 'ACTION'} · dir: ${cfg.workdir}`,
  ].filter(Boolean).join('\n');
}

async function onMessage(m, sock, cfg) {
  const ts = Number(m.messageTimestamp || 0);
  if (ts && Date.now() / 1000 - ts > 120) return;            // skip history / stale on reconnect
  const id = m.key?.id;
  if (id && seen.has(id)) return;                            // de-dupe
  const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').trim();
  if (!text || !text.startsWith(cfg.pin + ' ')) return;      // must lead with the exact PIN
  const fromMe = Boolean(m.key?.fromMe);
  const jid = m.key?.remoteJid || '';
  const num = jid.split('@')[0];
  if (!fromMe && !cfg.allow.includes(num)) return;           // owner-only unless allow-listed
  if (id) { seen.add(id); if (seen.size > 1000) seen.clear(); }

  const raw = text.slice(cfg.pin.length + 1).trim();
  if (!raw) return;
  const reply = (t) => sock.sendMessage(jid, { text: t }).catch((e) => console.log('[reply] failed:', e?.message));
  console.log(`[cmd] ${fromMe ? 'self' : num}: ${raw.slice(0, 120)}`);

  const lower = raw.toLowerCase();
  if (lower === 'help') return void reply(helpText(cfg));

  const isShell = cfg.shell && (raw.startsWith('!') || lower.startsWith('sh '));
  let out;
  if (isShell) {
    const cmd = raw.startsWith('!') ? raw.slice(1).trim() : raw.slice(3).trim();
    out = await runShell(cmd, cfg);
  } else {
    out = await runClaude(raw, cfg);
  }
  if (out.length > cfg.replyChunk) out = out.slice(0, cfg.replyChunk) + `\n…(+${out.length - cfg.replyChunk} more chars)`;
  await reply(isShell ? '```\n' + out + '\n```' : out);
}

export async function startBridge(cfg) {
  if (!existsSync(cfg.authDir)) mkdirSync(cfg.authDir, { recursive: true });

  if (!cfg.readOnly && !isTrusted(cfg.workdir)) {
    console.log(`\n⚠  Claude Code is not yet trusted for: ${cfg.workdir}`);
    console.log('   Action mode (edits/shell) may be refused until you trust it.');
    console.log('   Fix: run  claude-wa --accept-trust  once (or open `claude` there and accept the dialog).\n');
  }

  const logger = pino({ level: 'silent' });

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(cfg.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state, logger, browser: ['claude-wa', 'Chrome', '1.0.0'] });

    // Pairing-code linking (alternative to QR) when a phone number is configured.
    if (cfg.pair && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(String(cfg.pair).replace(/[^0-9]/g, ''));
          const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log(`\n===========  WHATSAPP PAIRING CODE  ===========`);
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
        console.log('\n✅  Connected. Your WhatsApp is now a Claude Code remote.');
        console.log(`   Text:  ${cfg.pin} <message>   from this account.`);
        console.log(`   Mode: ${cfg.readOnly ? 'READ-ONLY' : 'ACTION (edits + shell)'} · dir: ${cfg.workdir}\n`);
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
        try { await onMessage(m, sock, cfg); }
        catch (e) { console.log('[handler] error:', e?.message); }
      }
    });
  }

  await connect();
}
