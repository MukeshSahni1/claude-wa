# claude-wa

**Talk to [Claude Code](https://claude.com/claude-code) from WhatsApp.** Install,
scan a QR with your phone, and your **"Message yourself"** chat becomes a live
Claude Code console — type a message, Claude reads it and does it, and it
remembers the conversation. No PIN, no app on the server, no friction.

```
You (Message yourself):  add a /health endpoint and run the tests
claude-wa:               ✅ Added GET /health, tests green (12 passed).
You:                     now commit and push it
claude-wa:               Pushed abc123 to main. ✅      ← remembers context
```

One Node process links to WhatsApp via the multi-device protocol
([Baileys](https://github.com/WhiskeySockets/Baileys)) and pipes your messages to
the `claude` CLI.

---

## Install & run

You need [Claude Code](https://claude.com/claude-code) installed and logged in on
the machine (the `claude` command on `PATH`).

```bash
npx claude-wa                 # one-off
# or
npm i -g claude-wa && claude-wa
```

First run prints a **QR code**. On your phone:
**WhatsApp → Settings → Linked Devices → Link a device** → scan it.

That's it. Open your **"Message yourself"** chat and type anything — it goes
straight to Claude Code. No prefix needed.

## What you can send

| Message | Does |
|---------|------|
| `what's failing in the auth tests?` | Claude investigates & answers |
| `fix it and run the tests` | Claude edits & acts (remembers the previous message) |
| `!docker ps` | run a raw shell command |
| `/new` | start a fresh conversation (clears memory) |
| `help` | show the menu |

Only your **"Message yourself"** chat is wired up — Claude never touches your
other WhatsApp conversations.

## Modes

**Open (default)** — no PIN, self-chat is the console, conversation memory on.

**Read-only** — `claude-wa --read-only`. Claude can read & answer but the
Edit/Write/Bash tools aren't granted; nothing on the machine changes.

**PIN** — `claude-wa --pin`. Restores the `"<PIN> <message>"` prefix and lets you
drive from allow-listed chats too (`--allow 9199...`). Use this if the number is
shared or you want a second factor.

## Options

```
--read-only          Read & answer only — no edits, no shell
--no-continue        Each message is a fresh, standalone prompt (no memory)
--pin [value]        Opt into PIN mode (value optional; auto-generated if omitted)
--allow <nums>       Also accept these numbers (comma-separated)
--chat <number>      Bind the console to a specific chat instead of self-chat
--any-chat           Accept ANY chat (⚠ Claude replies everywhere)
--workdir <dir>      Directory Claude runs in (default: current dir)
--claude-bin <path>  Path to the claude binary (default: claude on PATH)
--no-shell           Disable the  !cmd  shortcut
--pair <phone>       Link via pairing code instead of QR (digits only)
--accept-trust       Trust Claude Code for the workdir, then exit (run once)
-h, --help · -v, --version
```

Also configurable via env (`CLAUDE_WA_READONLY=1`, `CLAUDE_WA_PIN`,
`CLAUDE_WA_ALLOW`, `CLAUDE_WA_WORKDIR`, `CLAUDE_WA_NO_CONTINUE=1`, …) and
persisted to `~/.claude-wa/config.json`. WhatsApp auth lives in
`~/.claude-wa/auth/`.

## Trust

Claude Code refuses to act in an "untrusted" workspace. The first time, run:

```bash
claude-wa --accept-trust --workdir /path/to/project
```

(or open `claude` in that directory once and accept the dialog), then start
`claude-wa`.

## Security

In action mode, **anyone who can send to the wired-up chat can run Claude Code —
including shell — on this machine.** In open mode the gate is simply access to
your WhatsApp.

- Run in a dedicated `--workdir`, ideally as a non-root user.
- Use `--read-only` if you don't want a text to change anything.
- Use `--pin` to add a secret second factor (and to drive from other chats).
- Long jobs (> ~150s) get the `claude` process killed by the timeout — use a real
  session for big multi-step work; texts are best for quick asks and fixes.

## Troubleshooting

- **No reply after texting?** In open mode, make sure you're texting your own
  **"Message yourself"** chat. The console logs each linked identity on connect;
  if the self-chat isn't auto-detected it binds to the first chat you message.
- **Connection drops / "failed to decrypt"** right after linking: restart
  `claude-wa` once — a fresh link heals the WhatsApp/Signal session.
- **`claude binary not found`**: install Claude Code or pass `--claude-bin
  /full/path/to/claude`.
- **"workspace has not been trusted"**: run `claude-wa --accept-trust`.

## How it works

```
WhatsApp  ──(Baileys multi-device)──►  claude-wa  ──spawn──►  claude -p [--continue]
   ▲                                       │
   └────────────── reply ◄─────────────────┘
```

`claude` runs headless with `--permission-mode acceptEdits --allowedTools …`
(not `--dangerously-skip-permissions`, which the CLI blocks under root), the
prompt is fed on stdin, and `--continue` is added after the first message so the
conversation has memory.

## License

MIT © Dark Lord
