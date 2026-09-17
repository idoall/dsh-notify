<h1 align="center">DSH Notify</h1>

<p align="center">In-page task notifications for DeepSeek Harness: a toast stack, a sound, and a flashing tab title. Live delivery only — nothing is stored.</p>

<p align="center">
  <a href="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0F172A" alt="MIT"></a>
  <img src="https://img.shields.io/badge/DSH-0.1.6--alpha.1-4B6BFB" alt="DSH 0.1.6-alpha.1">
</p>

<p align="center">English | <a href="README.zh.md">中文</a></p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#compatibility">Compatibility</a> ·
  <a href="#uninstall">Uninstall</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

> DSH Notify is a DeepSeek Harness community plugin. It sits in the official sidebar action row and settings section, and does not modify DSH source.

When a session **really stops**, fails, asks a question, or needs approval, a card appears in the top-right corner of the current page. Intermediate goal rounds and queued follow-up turns stay silent. Clicking a card jumps to the session (and the exact turn) that produced it; questions and approvals are answered straight from the card. When you are done with a notification you close it, and it is gone — there is no history list behind it.

Everything happens **inside the page you already have open**. There is no service worker, no web push, no host-side OS notification, and no extra app to install: browser and operating-system notification matrices were removed on purpose, because they fail invisibly (submitted, never seen) and cannot be made reliable across platforms.

<p align="center">
  <img src="./assets/toast.png" width="70%" alt="Notification cards in the top-right corner: icon, title, body text and a close button">
</p>

## What it does

- **Toast on the page**: a stack in the top-right corner, newest on top. Each card carries the title, body, session name, a tone colour per kind and a close button. Click the body to jump to the session; click the answers to reply without leaving the page, and the card reports the answer as loading until the host confirms (then ✓ 已完成 or ✗ with a 重试 button). Nothing expires on a clock: a card stays until you close it, open its session, or answer it — and a card whose record the Host has dropped leaves with it.
- **Stacked, then collapsed**: up to three cards lie flat, each one pushing the older ones down with a smooth transform. Past three the stack collapses into the front card plus a `+N` count, with the rest peeking out beneath it; hover (or click the count) to expand them all.
- **Answer in the toast**: a pending question or approval renders the same options as the composer. Answering here and answering in the composer act on the same pending interaction, so the two stay in sync.
- **Jump to the exact turn**: clicking a card opens its session and scrolls to (and briefly highlights) the turn the notification came from.
- **Sound that survives being in the background**: synthesised in-page with WebAudio (no audio files shipped), plus uploadable custom sounds. It plays **even when the page is hidden** — that is the only way to reach you when the browser is behind another app.
- **Flashing tab title**: while the tab is in the background and a card arrived that you have not looked at, the title gets a 🔔 prefix and the favicon alternates to a red dot. It stops the moment you look at the tab.
- **Opt-in noise**: subtask and background-job completion notifications are **off by default** (they fire for every subagent and job, which gets noisy fast).
- **Live only — there is no history**: the least surprising thing a notification can do is stop existing once you have dealt with it, so the plugin stores nothing. A page is told about what happens while it is open; nothing is kept to catch up on later, and a page that was not connected never learns about it. That is the trade for having no queue, no read state and no panel to reconcile.

<p align="center">
  <img src="./assets/panel.png" width="46%" alt="Five notifications collapse into the front card plus a count, with the rest peeking out beneath it">
</p>

## Quick start

Requirements:

- DeepSeek Harness with a Web profile
- Node.js 20 or newer
- Verified DSH version: `0.1.6-alpha.1` (plugin `0.1.2`)

Install from GitHub into your Web profile:

```sh
dsh plugin --profile web add "github:idoall/dsh-notify"
```

From a local clone (what this repository is developed against):

```sh
git clone https://github.com/idoall/dsh-notify.git
cd dsh-notify
npm install
npm run build
dsh plugin --profile web add "link:$(pwd)"
```

Restart DSH and refresh the Web UI. The client half registers the settings card in `settings.section` and the toast in `shell.overlay`; the host half mounts through `cordis.patch.yml`.

> **Name note:** the npm package `dsh-notify` belongs to a **different** author (a Windows tray/toast plugin). This plugin is not published on npm — install it from GitHub or from a local clone exactly as shown above, so a plain `dsh plugin add dsh-notify` cannot pull the wrong plugin.

## Usage

1. Run a task. When the task **stops**, fails, or asks something, a card appears in the top-right corner.
2. Click the toast to open the session it came from; click an answer button to answer in place; click **×** to dismiss (that marks it seen).
3. Click a card to jump to its session and turn, click **×** to dismiss it, or answer a question without leaving the page.
4. Switch to another tab and keep working: the title flashes for pending work or for something that arrived while you were away, and the sound plays even though the DSH page is in the background.
5. Everything is remembered per profile, so a reload does not lose the history.

## Settings

**Settings → Notifications**:

<p align="center">
  <img src="./assets/settings.png" width="60%" alt="Notification settings: toast position, subtask notifications, the one remaining self-test and the sound card">
</p>

| Setting | Default | What it does |
| --- | --- | --- |
| Read retention | keep forever | Hides older **read** entries from the read list (1 / 7 / 30 days). Unread entries are never hidden; the host still evicts the oldest read records by capacity. |
| Toast position | conversation column, top-right | Anchors the toast to the chat column, so it follows the conversation pane when the right sidebar is open or closed. |
| Subtask / background job notifications | **off** | Each subagent and each background job would otherwise record an entry (titles often being raw commands). |
| In-page sound | **on** | WebAudio cue on every new toast, **including while the page is hidden**. Built-ins: chime, ping, alert, silent — plus custom uploads. |
| Self-test | — | One card for the only channel (in-page), plus an advanced section (persisted history, navigation and unread, storage round-trip, deduplication). Tests never fire on page load. |

Custom sounds are uploaded to `<dataDir>/sounds/` in the profile data directory (not the plugin install directory), so reinstalling the plugin keeps them. Uploads are limited to 1 MB and to `mp3 / m4a / aac / wav / ogg / flac`; the file name must be a single path segment (no `../`, no subdirectories).

## Compatibility

Current release: plugin **`0.1.2`** is verified against DeepSeek Harness **`0.1.6-alpha.1`**.

| Plugin | Verified DeepSeek Harness |
| --- | --- |
| `0.1.2` | `0.1.6-alpha.1` |
| `0.1.1` | `0.1.5-rc.1` |
| `0.1.0` | `0.1.5-rc.1` |

Newer DSH releases are not auto-declared compatible. If a future DSH breaks the plugin, disable or uninstall it — do not patch DSH core.

Verified on macOS (Chrome and the DSH desktop shell) and remotely through a phone browser on the same Host. The layout adapts to narrow viewports: the stack becomes full-width, and it is promoted to the browser top layer so a fixed mobile sidebar cannot cover it.

<p align="center">
  <img src="./assets/mobile.png" width="34%" alt="Notification cards on a 390 px phone viewport: full width, drawn above the mobile sidebar">
</p>

## Uninstall

```sh
dsh plugin --profile web remove dsh-notify
```

Uninstalling does not delete the notification history or the uploaded sounds; they live in the data directory your profile patch owns (`config.dataDir`). Delete that directory to wipe them.

## Development

```sh
npm install
npm run verify     # typecheck + tests + build + package check
npm run test       # node --test test/*.test.js
npm run build      # dist/index.js, dist/client.js
```

The repository keeps the host half (`src/index.js`, `src/core.js`, `src/storage.js`, `src/sounds.js`), the client half (`src/client.js`), and a dependency-free test suite (`test/`). `dist/` is build output and is not committed.

## License

MIT. See [LICENSE](LICENSE).
