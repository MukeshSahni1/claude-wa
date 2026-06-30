// Configuration: merges CLI flags > env vars > saved config file > defaults.
// On first run, generates a random PIN and persists it so it stays stable and
// discoverable. Also holds the Claude Code "trust" helpers.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const HOME = homedir();
const CONFIG_DIR = process.env.CLAUDE_WA_DIR || join(HOME, '.claude-wa');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Tools Claude may use headlessly, per mode. Action mode auto-accepts edits and
// allows shell; read-only can investigate/answer but never change anything.
const ACTION_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'Read', 'Glob', 'Grep', 'WebFetch'];
const READONLY_TOOLS = ['Read', 'Glob', 'Grep'];

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadConfig(cli = {}) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const file = readJSON(CONFIG_FILE) || {};

  // PIN: cli > env > file > generate-and-save
  let pin = cli.pin || process.env.CLAUDE_WA_PIN || file.pin;
  let generatedPin = false;
  if (!pin) { pin = randomBytes(4).toString('hex'); generatedPin = true; }

  let readOnly = false;
  if (cli.readOnly) readOnly = true;
  else if (process.env.CLAUDE_WA_READONLY === '1') readOnly = true;
  else if (file.readOnly) readOnly = true;

  const allowRaw = cli.allow || process.env.CLAUDE_WA_ALLOW || (file.allow || []).join(',');
  const allow = String(allowRaw).split(',').map((s) => s.replace(/[^0-9]/g, '')).filter(Boolean);

  const cfg = {
    pin: String(pin),
    readOnly,
    permissionMode: readOnly ? 'default' : 'acceptEdits',
    allowedTools: readOnly ? READONLY_TOOLS : ACTION_TOOLS,
    allow,
    shell: cli.noShell ? false : (file.shell !== false) && !readOnly,
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

  // Persist the durable bits so the PIN survives restarts and is discoverable.
  const toSave = {
    pin: cfg.pin,
    readOnly: cfg.readOnly,
    allow: cfg.allow,
    shell: cfg.shell,
    claudeBin: cfg.claudeBin,
    workdir: cfg.workdir,
    timeoutMs: cfg.timeoutMs,
  };
  try { writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2)); } catch { /* best-effort */ }

  return cfg;
}

// ── Claude Code workspace trust ──────────────────────────────────────────────
// Headless Claude refuses to act in an "untrusted" workspace. These let the user
// trust the working directory explicitly (via `claude-wa --accept-trust`).
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
