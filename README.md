# Switchback

English | [中文](README.zh-CN.md)

> A relay workbench for native coding agents.

**When one agent gets stuck, hand the work to the next.**

Carry one piece of work across Claude Code, Codex, Kimi Code, Grok, DSH, and Antigravity. Switchback keeps the goal,
the worktree, each engine's native session handle, and the paths to whatever raw logs the engine exposes,
all on one work line. Every engine still runs its own native process, with its own login, models,
configuration, and tools. When you switch, Switchback doesn't write a prompt for you, and it doesn't slip a
summary of its own into the model's context.

You can also switch back: the previous engine keeps its native session handle. Switchback looks after the
continuity of one piece of work. It does not turn several agents into an automated team.

Six engines are built in: Codex, Claude Code, Kimi Code, Grok, DSH, and Antigravity. Any other engine that speaks ACP
can be registered.

![How a relay works: one work line moves from Claude Code to Codex to Kimi Code and back to Claude Code, over the same workspace](docs/assets/relay.svg)

## Why relay

Coding agents have different strengths, and each runs into its own problems:

- One gets stuck on an error, and you want another to take a fresh look
- You work out the plan with one, and want another to implement it
- The current engine is out of quota, having an outage, or wrong for the stage you're in
- You want another engine to try from scratch while keeping the first result

Usually that means opening another window, picking the project again, and working out where the last agent left
off. Switchback keeps the same workspace, the history in its UI, and every engine's native handle. When the new
engine needs to read the previous segment verbatim, take the log path that engine really provides from the
timeline, and tell it to read the file itself.

## How a relay works

A relay doesn't translate one model's context into another vendor's private session format.

By default, the first message to the new engine starts with a short handoff note that only states facts: which
engine ran which turns, where Switchback's transcript and each segment's raw logs are, and what format those logs
are in. It gives no instructions, makes no judgment, and shows up verbatim in the transcript. You can turn it off
under Settings → General → Automatic handoff.

| Kept | Never pushed into the new engine's context |
| --- | --- |
| The same workspace and the real files on disk | Summaries, prompts, or reminders written by Switchback |
| The full work line in the Switchback UI | Another engine's hidden reasoning or private model context |
| Each engine's own native session handle | Credentials and login state |
| Raw log paths the engine really exposes, if any | State that Switchback has guessed |

The workspace is the source of truth. After a switch you can simply give the next instruction, or point the engine
at paths from the timeline so it can check the original record and the code for itself.

## Three ways to switch

1. **Start with the right engine.** Pick the engine when you start new work.
2. **Hand off to another engine.** Choose the next engine; the switch happens when you send your next message.
   The original work line and every engine's handle are kept.
3. **Retry from scratch with another engine.** Keep the original result and open a branch on the same workspace.
   Across engines, no goal or summary is injected.

When it's the same engine and that engine offers a native fork, the third option copies its own real context.
With a different engine, Switchback can only honestly open a blank branch, without a list of files already
changed; otherwise the other engine would think the work was half done. Two related branches can be compared side
by side from the top bar or with `/compare`: first each side's reported files, open items, and final conclusion,
then the raw records of both columns if you want to dig in. Both branches still share one workspace, so the engine
that runs second sees the changes of the first, and the UI says plainly that this is not an isolated experiment.

## What "native" means

Switchback launches the coding agents you have already installed and signed in to on your machine:

- **No credentials of its own.** There is no Switchback API key, OAuth flow, or token store.
- **No proxying of model requests.** Each native process sends its own requests.
- **No rewritten agent loop, prompts, or tools.** Upstream updates carry over unchanged.
- **No guessing about capabilities or state.** The UI shows what the engine reports; when it can't tell, it says so.
- **No access to credential stores.** It doesn't read credential files such as `.credentials.json` or `auth.json`,
  and it doesn't touch the Keychain. Switchback parses each engine's configuration to show which hooks are active,
  and keeps only the hook-related fields; see [Local data and network](#local-data-and-network) for exactly which
  files.

The repository contains no engine binaries. The full Claude build uses the platform executable that comes with the
official Agent SDK; the thin build uses the `claude` already on your `PATH`.

If you're looking for a unified model gateway, an agent harness of your own, or automatic multi-agent
orchestration, Switchback is not that product.

## What's on a work line

- **One session view**: text, plans, tool calls, usage, errors, and engine status, presented the same way for every
  engine
- **Approvals and trust tiers**: each engine's native approvals go through one traceable human decision
- **Real changes**: change summaries and a review panel built from the git worktree, not just the engine's own edit
  reports; stage and commit right there (commits can be undone, stay local, and are never pushed)
- **Project and environment**: branch, worktree status, project instructions, and each engine's native hooks
- **Pick up where you left off**: events on disk, native handles restored, full-text search, and history across
  sessions
- **Remote**: from your phone or a browser, follow progress, keep talking, handle approvals and structured
  questions, and get notifications

## Who it's for

Switchback is for developers who use two or more native coding agents, want to keep each vendor's subscription
and configuration, and don't want to explain the work again every time they switch.

It isn't for people who need a unified model API, a cloud IDE, an automatic team of parallel agents, or a pure
command-line workflow. Switchback's only user interface is the GUI; the command line is only for development and
packaging.

## Supported engines

| Engine | Native entry point | Status |
| --- | --- | --- |
| Codex | `codex app-server --stdio` | Built in |
| Claude Code | Agent SDK | Built in |
| Kimi Code | `kimi web`, REST + WebSocket | Built in |
| Grok | ACP | Built in |
| DSH | `dsh --profile <profile>` (ACP) | Built in; choose a profile's plugin assembly and confirm it |
| Antigravity | `agy` stream-json, one process per turn | Built in; text only, and no Read only tier |
| Other ACP engines | One click from the official ACP registry, or point at an executable | Connected according to what the engine reports; signs in its own way |

Built-in engines show their real probe status. The DSH settings page reads each profile's `package.json` to show
the bundle load order, the profile's direct dependencies, and their patch status. DSH joins the engine list only
after you confirm the current profile's native configuration. A session remembers the profile it was created with,
so switching the default assembly later never sends an old handle into a different plugin tree. New models,
commands, and session capabilities that plugins report through ACP are handled by the generic driver; ACP engines
you configure yourself appear only after you register them.

Third-party ACP engines are added under Settings → Install & connect:

- **From the ACP registry**: lists the launch methods each vendor registered in the
  [official ACP registry](https://agentclientprotocol.com/registry) (Gemini CLI, GitHub Copilot, goose, OpenCode,
  Qwen Code, and more). Clicking connect first shows the command it will run, or the package it will download and
  its checksum. Once you confirm, it installs the engine, tries the handshake, and writes it into `engines.json`,
  with no restart. When the registry has a newer version, you get an upgrade button.
- **Manually**: for anything not in the registry, point at an executable; it's accepted only if it completes the
  ACP handshake.
- **Sign-in**: the trial connection lists the sign-in methods the engine reports. Browser sign-in is handled by the
  engine itself (Switchback only relays one `authenticate` call); terminal sign-in runs the engine's own login in
  the system Terminal. If a session says it needs you to sign in first, the UI shows that and points you to where
  you can do it.

## Getting started

Development environment:

- macOS. This is the target platform; Linux and Windows only run type checks and engine package tests in CI.
- Node **22.23.2** (see `.node-version`).
- pnpm **11.18.0**. After `corepack enable`, the version in `packageManager` in `package.json` is used
  automatically.
- The first test run or dev session downloads the Electron runtime from GitHub (about 130 MB).

```sh
corepack enable
pnpm install
pnpm dev          # development mode
pnpm check        # typecheck, lint, architecture and changelog guards, tests
pnpm dist         # full .dmg, with the Claude platform executable bundled
pnpm dist:thin    # thin .dmg, uses the claude on your PATH
pnpm dist:all     # both at once
pnpm test:live    # real-engine tests, off by default; needs the engines installed and signed in
```

The interface starts in Chinese. To switch it to English, open 设置 → 通用 → 外观 → 语言 (Settings → General →
Appearance → Language) and choose English; it applies right away, and the phone and browser clients follow the
desktop. The rest of this README uses the English labels.

Before you use it, install the native agents you want (`codex`, `kimi`, `grok`, `dsh`, `agy`) and sign in to each the way
its vendor describes. The full Claude build bundles the platform executable that matches the SDK; the thin build
needs `claude --version` to work.

DSH also needs a provider, model, and API credentials set up under Models in DSH Web, and the selected profile has
to complete the ACP handshake. Then choose the profile under Settings → Engines → DSH and confirm it. Profiles, credentials, and plugin versions stay managed by DSH. While the official automation-only ACP
doesn't report that it can resume, Switchback refuses to resume an old session instead of quietly starting an empty
one and pretending it reconnected. For now it also only receives the final assistant text over ACP; reasoning and
tool activity stay in DSH's own session log. So Switchback's transcript doesn't make up the missing tool rows, and
the final file changes are still checked against the worktree baseline and the review panel.

Antigravity runs through `agy`'s own headless stream-json mode: one process per turn, resumed by its conversation
ID, text only for now. Actions that need approval are refused by the CLI itself, because that mode has no way to
ask, so set permissions in its native settings. Its plan mode isn't a read-only permission, so the Read only tier
isn't offered. Google's [FAQ](https://antigravity.google/docs/faq/) says personal subscriptions don't support using
the CLI inside third-party apps, and connecting it to Switchback doesn't lift any account, region, or plan limit.

Switchback uses each engine's own native sign-in; there are no extra keys to configure.

Builds are currently unsigned (`identity: null`). On first launch, allow the app under
System Settings → Privacy & Security, or run:

```sh
xattr -dr com.apple.quarantine /Applications/Switchback.app
```

Pairing, tunnels, and revoking devices for remote access are described in
[`docs/远程访问设置.md`](docs/远程访问设置.md) (in Chinese).

## Local data and network

### Files from other tools that Switchback reads

These files are only used on your machine; Switchback never sends them anywhere.

| What it reads | Why | What it keeps |
| --- | --- | --- |
| Configuration and hooks in `~/.claude/settings.json`, `~/.codex/config.toml`, `~/.kimi-code/config.toml`, `~/.grok/`, and the files of the same names in your project | To list the hooks in effect on the Environment page | Only the hook-related fields. A provider key written in those files is parsed along with the rest of the file, but never kept |
| Session records under `~/.claude/projects/` | To list and take over Claude's past sessions | When taking over, the latest records are written into Switchback's own session log |
| `~/.claude.json` | Only when the SDK can't provide account details, to show who is signed in | The name, email, and plan in `oauthAccount` |
| The directory layout of `~/.kimi-code/session_index.jsonl` and `~/.grok/sessions/` | To show the paths of the engine's raw logs on the timeline | Only the paths; record contents aren't read |
| `~/.dsh/profiles/*/package.json` | To show how each DSH profile is assembled | The bundle order and dependency versions |
| `AGENTS.md` and `CLAUDE.md` in your project | To tell whether project instructions exist | Only whether the files exist |

- **Accounts and quotas** come from each engine's own interface first: the Claude Agent SDK, `codex app-server`,
  and the local API of `kimi web`.
- **Kimi's local session token** comes from the output of the `kimi web` process that Switchback starts. It stays
  in memory and is only sent to the loopback address.
- **Environment variables and PATH**: engine processes inherit your environment. At startup, Switchback reads
  `PATH` once from a login shell, which runs your shell profile.

### What Switchback stores

The data directory is `~/Library/Application Support/Switchback`. It holds:

- Settings, approval rules, and pasted images
- The session event stream, including full prompts, replies, and tool output
- Logs, with anything that looks like a credential scrubbed
- `engines.json`; values written under its `env` are stored in plain text
- `agents/`: binary engines connected from the ACP registry, one directory per engine and version; old versions
  nobody uses are cleaned up
- `acp-registry.json`: a local cache of the ACP registry
- The remote device list; tokens are stored only as hashes

Conversations that don't belong to a project get a directory under `~/Documents/Switchback/`.

### Network

Switchback has no telemetry, analytics, or crash reporting; crash dumps stay on your machine. The only network
requests Switchback makes itself are these:

- **Engine version checks**, about 8 seconds after launch: `npm view` for codex and kimi installed globally with
  npm, and `grok update --check` when grok is installed.
- **App update checks**: `updateFeed` in `apps/desktop/package.json` is empty by default, which turns the feature
  off entirely.
- **The ACP registry**: when you open Settings → Install & connect and the local cache is more than
  an hour old, the registry is fetched once from `cdn.agentclientprotocol.com` (about 60 KB); refreshing fetches it
  too.
- **When you connect or upgrade an engine** there: engines distributed through npx or uvx are downloaded by those
  tools using your own npm or uv configuration; binary distributions are downloaded by Switchback from the address
  in the registry and verified against the sha256 the registry gives.
- **When you choose a sign-in method**: the engine itself goes online, usually by opening the browser; Switchback
  only relays your choice.
- **Remote access** is off by default. When it's on, it only listens on `127.0.0.1` and is exposed through your own
  tunnel. With notifications enabled, it sends encrypted messages to the browser's push service.
- **When you install or update an engine** in Settings: the matching install command runs.

Model requests, sign-in, and each engine's own updates are all sent by the native processes themselves.

## Architecture and development

![Switchback architecture: the desktop window and web client talk to the main process; packages are layered from protocol up to host; native engines run as separate processes and call their own model providers](docs/assets/architecture.svg)

```
packages/
  protocol/   domain model: thread, turn, item (no dependencies, types only)
  i18n/       interface languages and message catalog types (no dependencies, no IO)
  approval/   trust tiers, red lines, and the decision function (pure, no IO)
  store/      pure reducer from the event stream to view state
  wire/       sequence numbers, replay, chunking, and gap filling
  link/       remote transport that reconnects and resumes where it stopped
  engine/     native engine drivers: acp, antigravity, codex, claude, kimi
  worksite/   workspace safety: git guard, write scope
  journal/    persistence, checkpoints, recovery
  handoff/    run summaries and branch comparison (never sent to an engine)
  host/       session orchestration and process lifecycle
apps/
  desktop/    Electron shell and React renderer
  web/        the remote browser client
```

The exact dependency edges are enforced by `pnpm arch`; adding or removing a dependency means updating the source of
truth as well:

<!-- package-graph:start -->
```text
protocol ← ∅
approval ← i18n + protocol
store ← protocol
wire ← protocol
link ← protocol + wire + i18n
worksite ← ∅
i18n ← ∅
journal ← protocol
handoff ← protocol + i18n
engine ← protocol + approval + i18n
host ← protocol + approval + engine + store + journal + handoff + i18n
desktop ← protocol + engine + handoff + host + i18n + journal + link + store + wire + worksite
web ← i18n + link + protocol + store + wire
```
<!-- package-graph:end -->

```sh
pnpm check       # must be green before every commit
pnpm test:watch
```

The engineering rules are in [`AGENTS.md`](AGENTS.md) (in Chinese). The name comes from a switchback, the zigzag
turn of a mountain trail: when the slope gets too steep, you turn and keep climbing. It also means what it says:
after a relay, you can always switch back to the previous engine.

## License and trademarks

Switchback's source code is released under the [Apache License 2.0](LICENSE).

- **The Claude Agent SDK is not covered.** `@anthropic-ai/claude-agent-sdk` and its platform executables are
  Anthropic's proprietary software, used under Anthropic's terms.
  - The repository only depends on it through npm.
  - The full build from `pnpm dist` bundles the SDK and the platform executable into the installer.
  - The thin build only includes the SDK's JavaScript, without the platform executable.
  - Before distributing an installer yourself, make sure you comply with Anthropic's terms.
- **Not affiliated with any vendor.** Switchback is an independent personal project. It is not affiliated with,
  endorsed by, or sponsored by Anthropic, OpenAI, Moonshot AI, xAI, DeepSeek, or the provider of any other engine.
  Claude, Claude Code, Codex, Kimi, Grok, DSH, and other names and trademarks belong to their respective owners and
  are mentioned here only to describe which engines Switchback can drive.
