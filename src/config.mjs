// Configuration: merges CLI flags > env vars > saved config file > defaults.
//
// Default is OPEN mode: no PIN — your WhatsApp "Message yourself" chat becomes
// the Claude Code console; every message there is read and executed, with
// conversation memory across messages. PIN mode (opt-in) restores the
// "<PIN> <message>" prefix and works across allow-listed chats.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PERSONA_TEMPLATE } from './fans.mjs';

const HOME = homedir();
const CONFIG_DIR = process.env.CLAUDE_WA_DIR || join(HOME, '.claude-wa');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const ACTION_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Glob', 'Grep', 'WebFetch'];
const READONLY_TOOLS = ['Read', 'Glob', 'Grep'];
// Fan mode is chat-only: nothing is allowed, and the dangerous ones are
// explicitly disallowed as a second lock.
const FAN_DISALLOWED = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task'];

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadConfig(cli = {}) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const file = readJSON(CONFIG_FILE) || {};

  // PIN mode is opt-in: --pin flag, CLAUDE_WA_PIN env, or saved requirePin.
  const requirePin = Boolean(cli.pinFlag) || Boolean(process.env.CLAUDE_WA_PIN) || Boolean(file.requirePin);
  let pin = cli.pin || process.env.CLAUDE_WA_PIN || file.pin || null;
  let generatedPin = false;
  if (requirePin && !pin) { pin = randomBytes(4).toString('hex'); generatedPin = true; }

  let readOnly = false;
  if (cli.readOnly) readOnly = true;
  else if (process.env.CLAUDE_WA_READONLY === '1') readOnly = true;
  else if (file.readOnly) readOnly = true;

  // Conversation memory across messages (claude --continue). Default on.
  let continueConversation = true;
  if (cli.noContinue) continueConversation = false;
  else if (process.env.CLAUDE_WA_NO_CONTINUE === '1') continueConversation = false;
  else if (file.continueConversation === false) continueConversation = false;

  const anyChat = Boolean(cli.anyChat) || process.env.CLAUDE_WA_ANY_CHAT === '1' || Boolean(file.anyChat);

  const chatRaw = cli.chat || process.env.CLAUDE_WA_CHAT || file.chat || null;
  const chatJid = chatRaw
    ? (String(chatRaw).includes('@') ? String(chatRaw) : `${String(chatRaw).replace(/[^0-9]/g, '')}@s.whatsapp.net`)
    : null;

  const allowRaw = cli.allow || process.env.CLAUDE_WA_ALLOW || (file.allow || []).join(',');
  const allow = String(allowRaw).split(',').map((s) => s.replace(/[^0-9]/g, '')).filter(Boolean);

  // Fan mode: the number becomes a public AI persona (chat-only, no tools).
  const fans = Boolean(cli.fans) || process.env.CLAUDE_WA_FANS === '1' || Boolean(file.fans);
  const personaFile = cli.persona || process.env.CLAUDE_WA_PERSONA || file.personaFile || join(CONFIG_DIR, 'persona.md');
  let persona = null;
  if (fans) {
    if (!existsSync(personaFile)) {
      // First run: drop the editable template so `--fans` works out of the box.
      try { writeFileSync(personaFile, PERSONA_TEMPLATE); } catch { /* best-effort */ }
    }
    try { persona = readFileSync(personaFile, 'utf8'); } catch { persona = null; }
  }

  const cfg = {
    requirePin,
    pin: pin ? String(pin) : null,
    readOnly,
    permissionMode: fans ? 'default' : (readOnly ? 'default' : 'acceptEdits'),
    allowedTools: fans ? [] : (readOnly ? READONLY_TOOLS : ACTION_TOOLS),
    disallowedTools: fans ? FAN_DISALLOWED : [],
    continueConversation,
    anyChat,
    chat: chatRaw,
    chatJid,
    boundJid: file.boundJid || null,
    allow,
    shell: cli.noShell || fans ? false : (file.shell !== false) && !readOnly,
    fans,
    persona,
    personaFile,
    fanModel: cli.fanModel || process.env.CLAUDE_WA_FAN_MODEL || file.fanModel || 'haiku',
    fanDailyCap: Number(process.env.CLAUDE_WA_FAN_DAILY_CAP || file.fanDailyCap || 40),
    fanGlobalCap: Number(process.env.CLAUDE_WA_FAN_GLOBAL_CAP || file.fanGlobalCap || 400),
    fanCapMessage: file.fanCapMessage || '⏳ I’ve hit my chat limit for today — catch you tomorrow! 💛',
    claudeBin: cli.claudeBin || process.env.CLAUDE_WA_CLAUDE_BIN || file.claudeBin || 'claude',
    workdir: cli.workdir || process.env.CLAUDE_WA_WORKDIR || file.workdir || process.cwd(),
    authDir: process.env.CLAUDE_WA_AUTH_DIR || join(CONFIG_DIR, 'auth'),
    timeoutMs: Number(process.env.CLAUDE_WA_TIMEOUT_MS || file.timeoutMs || 150000),
    replyChunk: Number(process.env.CLAUDE_WA_REPLY_CHUNK || 3500),
    pair: cli.pair || process.env.CLAUDE_WA_PAIR || null,
    configDir: CONFIG_DIR,
    configFile: CONFIG_FILE,
    generatedPin,
  };

  persist(cfg);
  return cfg;
}

function persist(cfg) {
  const toSave = {
    requirePin: cfg.requirePin,
    pin: cfg.pin,
    readOnly: cfg.readOnly,
    continueConversation: cfg.continueConversation,
    anyChat: cfg.anyChat,
    chat: cfg.chat,
    boundJid: cfg.boundJid,
    allow: cfg.allow,
    shell: cfg.shell,
    claudeBin: cfg.claudeBin,
    workdir: cfg.workdir,
    timeoutMs: cfg.timeoutMs,
    fans: cfg.fans,
    personaFile: cfg.personaFile,
    fanModel: cfg.fanModel,
    fanDailyCap: cfg.fanDailyCap,
    fanGlobalCap: cfg.fanGlobalCap,
    fanCapMessage: cfg.fanCapMessage,
  };
  try { writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2)); } catch { /* best-effort */ }
}

// Persist the auto-bound console chat (open-mode fallback when the self-chat
// can't be auto-detected) so it stays stable across restarts.
export function saveBoundJid(jid) {
  const file = readJSON(CONFIG_FILE) || {};
  file.boundJid = jid;
  try { writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2)); } catch { /* best-effort */ }
}

// ── Claude Code workspace trust ──────────────────────────────────────────────
const CLAUDE_JSON = join(HOME, '.claude.json');

export function isTrusted(workdir) {
  const d = readJSON(CLAUDE_JSON);
  return Boolean(d?.projects?.[workdir]?.hasTrustDialogAccepted);
}

export function acceptTrust(workdir) {
  const d = readJSON(CLAUDE_JSON) || {};
  d.projects = d.projects || {};
  d.projects[workdir] = d.projects[workdir] || {};
  d.projects[workdir].hasTrustDialogAccepted = true;
  writeFileSync(CLAUDE_JSON, JSON.stringify(d, null, 2));
}
