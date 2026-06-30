# claude-wa

**Talk to [Claude Code](https://claude.com/claude-code) from WhatsApp.** Install,
scan a QR with your phone, and your WhatsApp number becomes a remote for Claude
Code — ask questions, edit code, run shell, deploy, all from a text.

```
You (WhatsApp):  5b824a4a fix the failing test in api/auth and push
claude-wa:       ✅ Fixed the off-by-one in verifyToken, tests green, pushed abc123.
```

No browser, no phone app to install on the server — one Node process that links to
WhatsApp via the multi-device protocol ([Baileys](https://github.com/WhiskeySockets/Baileys))
and pipes your messages to the `claude` CLI.

---

## Install & run

You need [Claude Code](https://claude.com/claude-code) installed and logged in on
the machine (the `claude` command on `PATH`).

```bash
# one-off
npx claude-wa

# or install globally
npm i -g claude-wa
claude-wa
```

On first run it prints a **QR code** in your terminal. On your phone:
**WhatsApp → Settings → Linked Devices → Link a device** → scan it.

It also prints (and saves) a random **PIN**. From that WhatsApp account — the
simplest is the **"Message yourself"** chat — send:

```
<PIN> hi
```

…and Claude replies right in the chat. Every message **must** start with the PIN.

## What you can send

| Text | Does |
|------|------|
| `<PIN> hi` | chat with Claude Code |
| `<PIN> add a /health endpoint and run the tests` | Claude edits & acts (action mode) |
| `<PIN> !docker ps` | run a raw shell command |
| `<PIN> sh git log --oneline -5` | same, alternate syntax |
| `<PIN> help` | show the menu |

Messages without the PIN are ignored.

## Options

```
claude-wa [options]

  --read-only          Claude can read & answer but not edit or run shell
  --pin <pin>          Set the access PIN (default: auto-generated & saved)
  --allow <nums>       Extra allowed sender numbers, comma-separated
  --workdir <dir>      Directory Claude runs in (default: current directory)
  --claude-bin <path>  Path to the claude binary (default: claude on PATH)
  --no-shell           Disable the  !cmd / sh  raw-shell shortcuts
  --pair <phone>       Link via pairing code instead of QR (digits only)
  --accept-trust       Trust Claude Code for the workdir, then exit (run once)
  -h, --help           Show help
  -v, --version        Show version
```

Everything is also configurable via env (`CLAUDE_WA_PIN`, `CLAUDE_WA_ALLOW`,
`CLAUDE_WA_WORKDIR`, `CLAUDE_WA_READONLY=1`, `CLAUDE_WA_CLAUDE_BIN`,
`CLAUDE_WA_TIMEOUT_MS`) and persisted to `~/.claude-wa/config.json`. WhatsApp
auth lives in `~/.claude-wa/auth/`.

## Read-only mode

Not ready to let a text edit your code? Start with:

```bash
claude-wa --read-only
```

Claude can read files and answer, but the Edit/Write/Bash tools are not granted —
nothing on the machine changes.

## Trust

Claude Code refuses to act in an "untrusted" workspace. The first time, run:

```bash
claude-wa --accept-trust --workdir /path/to/project
```

(or just open `claude` in that directory once and accept the dialog), then start
`claude-wa`.

## Security

This is a powerful tool. **In action mode, anyone who can post the PIN from an
allowed account can run Claude Code — including shell — on this machine.**

- The **PIN is the gate.** Keep it secret. Rotate it with `--pin` anytime.
- Only your own (`fromMe`) messages and numbers in `--allow` are accepted.
- Use `--read-only` if you don't fully trust the channel.
- Run in a dedicated `--workdir`, ideally as a non-root user, ideally on a box you
  don't mind being driven remotely.
- Long jobs (> ~150s) get the `claude` process killed by the timeout — use a real
  session for big multi-step work; texts are best for quick asks and fixes.

## Troubleshooting

- **No reply after texting?** Make sure the message starts with the **exact** PIN
  plus a space. A single dropped character silently fails the match.
- **Connection keeps dropping / "failed to decrypt"** right after linking: restart
  `claude-wa` once — a fresh link heals the WhatsApp/Signal session, and the next
  message decrypts.
- **`claude binary not found`**: install Claude Code, or pass `--claude-bin
  /full/path/to/claude`.
- **"workspace has not been trusted"**: run `claude-wa --accept-trust` (see Trust).

## How it works

```
WhatsApp  ──(Baileys multi-device)──►  claude-wa  ──spawn──►  claude -p
   ▲                                       │
   └────────────── reply ◄─────────────────┘
```

`claude` runs headless with `--permission-mode acceptEdits --allowedTools …`
(not `--dangerously-skip-permissions`, which the CLI blocks under root), and the
prompt is fed on stdin.

## License

MIT © Dark Lord
