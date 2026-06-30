// Runs Claude Code (and optional raw shell) for an inbound message.
//
// Why not `--dangerously-skip-permissions`? The CLI hard-blocks that flag when
// running as root. Instead we use `--permission-mode acceptEdits` plus an
// explicit `--allowedTools` grant, which gives full headless action with no
// permission prompts and no root block. The prompt is fed on STDIN to avoid the
// ~3s "no stdin" wait and any positional-argument ambiguity.
//
// `opts.continue` adds `--continue` so successive WhatsApp messages share one
// growing conversation (memory across messages) instead of starting fresh.

import { spawn, exec } from 'node:child_process';

export function runClaude(prompt, cfg, opts = {}) {
  return new Promise((resolve) => {
    const args = ['-p'];
    if (opts.continue) args.push('--continue');
    if (cfg.permissionMode) args.push('--permission-mode', cfg.permissionMode);
    if (cfg.allowedTools && cfg.allowedTools.length) args.push('--allowedTools', ...cfg.allowedTools);

    let child;
    try {
      child = spawn(cfg.claudeBin, args, { cwd: cfg.workdir, env: process.env, timeout: cfg.timeoutMs });
    } catch (e) {
      return resolve(`✖ failed to launch claude: ${e.message}`);
    }

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      resolve(`✖ ${e.code === 'ENOENT' ? `claude binary not found (${cfg.claudeBin}). Install Claude Code or set --claude-bin.` : e.message}`);
    });
    child.on('close', (code, signal) => {
      let t = out.trim();
      if (!t) t = signal ? '✖ timed out' : (err.trim() || '(no output)');
      resolve(t);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function runShell(cmd, cfg) {
  return new Promise((resolve) => {
    exec(cmd, {
      timeout: cfg.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      shell: '/bin/bash',
      cwd: cfg.workdir,
      env: process.env,
    }, (err, out, errOut) => {
      let t = `${out || ''}${errOut ? `\n[stderr] ${errOut}` : ''}`.trim();
      if (err && !t) t = `✖ ${err.killed ? 'timed out' : err.message}`;
      resolve(t || '(no output)');
    });
  });
}
