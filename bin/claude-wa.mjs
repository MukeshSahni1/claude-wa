#!/usr/bin/env node
// claude-wa — talk to Claude Code from WhatsApp.
// First run prints a QR; scan it, then text "<PIN> <message>" from that account.

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

Options:
  --read-only          Claude can read & answer but not edit or run shell
  --pin <pin>          Set the access PIN (default: auto-generated & saved)
  --allow <nums>       Extra allowed sender numbers, comma-separated
  --workdir <dir>      Directory Claude runs in (default: current directory)
  --claude-bin <path>  Path to the claude binary (default: claude on PATH)
  --no-shell           Disable the  !cmd  /  sh  raw-shell shortcuts
  --pair <phone>       Link via pairing code instead of QR (digits only)
  --accept-trust       Trust Claude Code for the workdir, then exit (run once)
  -h, --help           Show this help
  -v, --version        Show version

First run prints a QR — scan it in WhatsApp > Linked Devices.
Then, from that account, text:   <PIN> <message>

Security: anyone who can post the PIN from an allowed account can drive Claude
Code (and shell, in action mode) on this machine. Keep the PIN secret; use
--read-only if you're unsure, and run in a dedicated --workdir.`);
}

if (has('--help') || has('-h')) { printHelp(); process.exit(0); }
if (has('--version') || has('-v')) { console.log(pkg.version); process.exit(0); }

const cfg = loadConfig({
  readOnly: has('--read-only'),
  pin: get('--pin'),
  allow: get('--allow'),
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
console.log(`  PIN     : ${cfg.pin}${cfg.generatedPin ? '   (auto-generated — saved to ' + cfg.configFile + ')' : ''}`);
console.log(`  Mode    : ${cfg.readOnly ? 'READ-ONLY' : 'ACTION (edits + shell)'}`);
console.log(`  Workdir : ${cfg.workdir}`);
console.log(`  Allowed : self${cfg.allow.length ? ' + ' + cfg.allow.join(', ') : ' only'}`);
console.log(`  Claude  : ${cfg.claudeBin}\n`);

startBridge(cfg).catch((e) => {
  console.error('fatal:', e?.message || e);
  process.exit(1);
});
