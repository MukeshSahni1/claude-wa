#!/usr/bin/env node
// claude-wa — talk to Claude Code from WhatsApp.
// First run prints a QR; scan it, then just message your "Message yourself" chat.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, acceptTrust } from '../src/config.mjs';
import { startBridge } from '../src/bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const get = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : d;
};

function printHelp() {
  console.log(`claude-wa v${pkg.version} — talk to Claude Code from WhatsApp

Usage:
  claude-wa [options]

By default (open mode) there is NO PIN: your "Message yourself" chat becomes the
Claude Code console — every message is read and executed, with memory across
messages. Other chats are ignored.

Fan mode (--fans) flips the direction: the linked number becomes a public AI
persona. Anyone who DMs it (e.g. from a wa.me link pinned in an Instagram bio)
chats with your AI twin — chat only, zero tools, per-fan memory, daily caps.
Edit ~/.claude-wa/persona.md to shape the personality (edits apply live).

Options:
  --fans               Fan mode: public AI persona for anyone who DMs the number
  --persona <file>     Persona instructions for fan mode (default: ~/.claude-wa/persona.md)
  --fan-model <m>      Model for fan replies (default: haiku — fast & cheap)
  --read-only          Claude can read & answer but not edit or run shell
  --no-continue        Treat each message as a fresh, standalone prompt
  --pin [value]        Opt into PIN mode: messages must start with "<PIN> "
                       (value optional — auto-generated & saved if omitted)
  --allow <nums>       Also accept messages from these numbers (comma-separated)
  --chat <number>      Bind the console to a specific chat instead of self-chat
  --any-chat           Accept messages in ANY chat (⚠ Claude replies everywhere)
  --workdir <dir>      Directory Claude runs in (default: current directory)
  --claude-bin <path>  Path to the claude binary (default: claude on PATH)
  --no-shell           Disable the  !cmd  raw-shell shortcut
  --pair <phone>       Link via pairing code instead of QR (digits only)
  --accept-trust       Trust Claude Code for the workdir, then exit (run once)
  -h, --help           Show this help
  -v, --version        Show version

First run prints a QR — scan it in WhatsApp > Linked Devices, then message
yourself. Security: in open mode the gate is access to your WhatsApp; in action
mode messages can edit code and run shell. Use --read-only or --pin if unsure.`);
}

if (has('--help') || has('-h')) { printHelp(); process.exit(0); }
if (has('--version') || has('-v')) { console.log(pkg.version); process.exit(0); }

const cfg = loadConfig({
  fans: has('--fans'),
  persona: get('--persona'),
  fanModel: get('--fan-model'),
  readOnly: has('--read-only'),
  noContinue: has('--no-continue'),
  pinFlag: has('--pin'),
  pin: get('--pin'),
  allow: get('--allow'),
  chat: get('--chat'),
  anyChat: has('--any-chat'),
  workdir: get('--workdir'),
  claudeBin: get('--claude-bin'),
  noShell: has('--no-shell'),
  pair: get('--pair'),
});

if (has('--accept-trust')) {
  acceptTrust(cfg.workdir);
  console.log(`✅ Trusted Claude Code for: ${cfg.workdir}\n   Now run  claude-wa  to start.`);
  process.exit(0);
}

// Startup banner.
console.log(`\nclaude-wa v${pkg.version}`);
if (cfg.fans) {
  console.log('  Mode    : 🎭 FAN MODE — public AI persona (chat only, no tools)');
  console.log(`  Persona : ${cfg.personaFile}`);
  console.log(`  Caps    : ${cfg.fanDailyCap}/fan/day · ${cfg.fanGlobalCap} total/day · model: ${cfg.fanModel}`);
} else {
  console.log(`  Access  : ${cfg.requirePin ? `PIN  ${cfg.pin}${cfg.generatedPin ? '  (auto-generated, saved)' : ''}` : 'OPEN — message your self-chat, no PIN'}`);
  console.log(`  Mode    : ${cfg.readOnly ? 'READ-ONLY' : 'ACTION (edits + shell)'}${cfg.continueConversation ? ' · remembers context' : ''}`);
  console.log(`  Workdir : ${cfg.workdir}`);
}
if (cfg.anyChat) console.log('  Chats   : ⚠ ANY chat (Claude will reply everywhere)');
else if (cfg.chat) console.log(`  Chat    : bound to ${cfg.chat}`);
if (cfg.allow.length) console.log(`  Allow   : + ${cfg.allow.join(', ')}`);
console.log(`  Claude  : ${cfg.claudeBin}\n`);

startBridge(cfg).catch((e) => {
  console.error('fatal:', e?.message || e);
  process.exit(1);
});
