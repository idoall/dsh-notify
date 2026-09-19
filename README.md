<h1 align="center">DSH Notify</h1>

<p align="center">In-page task notifications for DeepSeek Harness: a toast stack, a sound, and a flashing tab title. Live delivery only — nothing is stored.</p>

<p align="center">
  <a href="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml"><img src="https://github.com/idoall/dsh-notify/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@idoall/dsh-notify"><img src="https://img.shields.io/npm/v/@idoall/dsh-notify?label=npm&color=CB3837" alt="npm version"></a>
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

> DSH Notify is a DeepSeek Harness community plugin. It registers exactly two seats — the settings section and the in-page overlay — and does not modify DSH source.

When a session **really stops**, fails, asks a question, or needs approval, a card appears in the top-right corner of the current page. Intermediate goal rounds and queued follow-up turns stay silent. Clicking a card jumps to the session (and the exact turn) that produced it — or the card stays put and says why it could not; questions and approvals are answered straight from the card. When you are done with a notification you close it, and it is gone — there is no history list behind it.

Everything happens **inside the page you already have open**. There is no service worker, no web push, no host-side OS notification, and no extra app to install: browser and operating-system notification matrices were removed on purpose, because they fail invisibly (submitted, never seen) and cannot be made reliable across platforms.

<p align="center">
  <img src="./assets/toast.png" width="70%" alt="Notification cards in the top-right corner: arrival time, session name, title, body text and a close button">
</p>

## What it does

- **Toast on the page**: a stack in the top-right corner, newest on top. Each card carries the arrival time to the second (`00:33:08`, or `02-14 09:05` when it is not from today; the full date is in its tooltip), the session name, the title, the body, a tone colour per kind and a close button. Click the body to jump to the session; click the answers to reply without leaving the page, and the card reports the answer as loading until the host confirms (then ✓ 已完成 or ✗ with a 重试 button). Nothing expires on a clock: a card stays until you close it, open its session, or answer it — and a card whose record the Host has dropped leaves with it.
- **A window onto the queue, not a folded pile**: one through five cards (three on a narrow, touch viewport) are **all fully visible** — they never overlap, whether they arrived together or one by one. The **sixth** card is the first that sits below the fold, one scroll (or one swipe) away, with a sliver of the next card under the window edge. The count on the corner is the whole queue the page is holding (`+8`), not just what is out of sight; click or tap it to jump between the two ends. Nothing is thrown away while the page is open; a refresh clears it.
- **Answer in the toast**: a pending question or approval renders the same options as the composer. Answering here and answering in the composer act on the same pending interaction, so the two stay in sync.
- **Jump to the exact turn**: clicking a card opens its session (through the host's `uiWorkspace.openSession` on current DSH, with the older `sessions.open` still accepted) and scrolls to (and briefly highlights) the turn the notification came from. The card is dismissed only once that really happened, so a jump that could not happen is not silently swallowed: a session that is gone (deleted, archived, or not in this page's list) leaves the card in place reading 这个会话已经不在了，无法打开, a jump that merely failed says 没能打开这个会话，再点一次试试 and clicking again retries, and a self-test card — which has no session on purpose — just closes.
- **One card per ask**: a plan review or a question is one notification even when the host emits it twice — the live `tool/call` and the in-page question waterfall. The corner will not stack two 「计划待审」 cards for the same session.
- **Sound that survives being in the background**: synthesised in-page with WebAudio (no audio files shipped), plus uploadable custom sounds. It plays **even when the page is hidden** — that is the only way to reach you when the browser is behind another app.
- **Flashing tab title**: while the tab is in the background and a card arrived that you have not looked at, the title gets a 🔔 prefix and the favicon alternates to a red dot. It stops the moment you look at the tab.
- **Opt-in noise**: subtask, background-job and workflow completion notifications are **off by default** (they fire for every subagent, every job and every workflow run, which gets noisy fast).
- **Live only — there is no history**: the least surprising thing a notification can do is stop existing once you have dealt with it, so the plugin stores nothing. A page is told about what happens while it is open; nothing is kept to catch up on later, and a page that was not connected never learns about it. That is the trade for having no queue, no read state and no panel to reconcile.

<p align="center">
  <img src="./assets/panel.png" width="46%" alt="Eight notifications in a window five cards tall: the count reads +8 and the sixth card shows its edge below the window">
</p>

## Quick start

Requirements:

- DeepSeek Harness with a Web profile
- Node.js 20 or newer
- Verified DSH version: `0.1.6-alpha.1` (plugin `0.2.2`)

Install from npm into your Web profile:

```sh
dsh plugin --profile web add @idoall/dsh-notify@latest
```

Install from GitHub:

```sh
dsh plugin --profile web add "github:idoall/dsh-notify"
```

From a local clone (what this repository is developed against):

```sh
git clone https://github.com/idoall/dsh-notify.git
cd dsh-notify
npm install
dsh plugin --profile web add "link:$(pwd)"
```

Restart DSH and refresh the Web UI. The client half registers the settings card in `settings.section` and the toast in `shell.overlay`; the host half mounts through `cordis.patch.yml`.

> **Name note:** the unscoped npm name `dsh-notify` belongs to a **different** author (a Windows tray/toast plugin). This plugin is published as **`@idoall/dsh-notify`** — always install it with the scope, because a bare `dsh plugin add dsh-notify` would pull the other plugin.
>
> Only the published package name is scoped. The plugin's internal identity — cordis name, the `dsh-notify` mount id and the `/plugins/dsh-notify/*` routes — keeps its short spelling, so profile config and settings are unaffected.

## Usage

1. Run a task. When the task **stops**, fails, or asks something, a card appears in the top-right corner carrying the time it arrived.
2. Click the card to jump to its session and the exact turn it came from, click an answer button to answer in place, or click **×** to dismiss it. A card that cannot go anywhere says so and waits for you instead of vanishing.
3. Switch to another tab and keep working: while a card is waiting to be looked at, the title gets a 🔔 prefix and the favicon alternates to a red dot, and the sound plays even though the DSH page is in the background.
4. A refresh clears the corner. Nothing is stored — not here, not on the host — so what this page saw while it was open is all there is, and a page that was not open never learns about it at all.

## Settings

**Settings → Notifications**:

<p align="center">
  <img src="./assets/settings.png" width="60%" alt="Notification settings: toast position, subtask notifications, the three self-test buttons and the sound card">
</p>

| Setting | Default | What it does |
| --- | --- | --- |
| Toast position | conversation column, top-right | Anchors the toast to the chat column's top-right. Opening or closing either sidebar (the session list or the right pane) moves the stack with the conversation edge, including through the grid-column animation. |
| Subtask / background job notifications | **off** | Each subagent, each background job and each workflow run would otherwise record an entry (titles often being raw commands). |
| In-page sound | **on** | WebAudio cue on every new toast, **including while the page is hidden**. Built-ins: chime, ping, alert, silent — plus custom uploads. |
| Self-test | — | There is one channel, so there is one test surface: **测试一条**, **测试 5 条** (exactly fills the corner window) and **测试 8 条** (three past it, which is where the count, the window edge and the scrolling show up). Tests never fire on page load. |

Custom sounds are uploaded to `<dataDir>/sounds/` in the profile data directory (not the plugin install directory), so reinstalling the plugin keeps them. Uploads are limited to 1 MB and to `mp3 / m4a / aac / wav / ogg / flac`; the file name must be a single path segment (no `../`, no subdirectories).

## Compatibility

Current release: plugin **`0.2.2`** is verified against DeepSeek Harness **`0.1.6-alpha.1`**.

| Plugin | Verified DeepSeek Harness |
| --- | --- |
| `0.2.2` | `0.1.6-alpha.1` |
| `0.2.1` | `0.1.6-alpha.1` |
| `0.2.0` | `0.1.6-alpha.1` |
| `0.1.2` | `0.1.6-alpha.1` |
| `0.1.1` | `0.1.5-rc.1` |
| `0.1.0` | `0.1.5-rc.1` |

Newer DSH releases are not auto-declared compatible. If a future DSH breaks the plugin, disable or uninstall it — do not patch DSH core.

Verified on macOS (Chrome and the DSH desktop shell) and remotely through a phone browser on the same Host. The layout adapts to narrow viewports: the corner holds three cards instead of five, the stack becomes full-width, and it is promoted to the browser top layer so a fixed mobile sidebar cannot cover it.

<p align="center">
  <img src="./assets/mobile.png" width="34%" alt="Notification cards on a 390 px phone viewport: full width, drawn above the mobile sidebar">
</p>

## Uninstall

```sh
dsh plugin --profile web remove @idoall/dsh-notify
```

Uninstalling deletes nothing that persists: the uploaded sounds and `settings.json` (sound, toast position, subtask noise) live in the data directory your profile patch owns (`config.dataDir`). Delete that directory to wipe them. Notification records never reach the disk, so there is no history to clean up.

## Development

```sh
npm install
npm run verify     # typecheck + tests + build + package check
npm run test       # node --test test/*.test.js
npm run build      # dist/index.js, dist/client.js
npm run pack:check # publish preconditions + the exact client registration
```

The repository keeps the host half (`src/index.js`, `src/core.js`, `src/buffer.js`, `src/sounds.js`, `src/sound-choices.js`), the client half (`src/client.js`), and a dependency-free test suite (`test/`). `dist/` is build output and is not committed.

### Releasing

Releases are tag-driven. Bump `version` in `package.json`, move the CHANGELOG entry out of `Unreleased`, write bilingual notes in `release-notes/v<version>.md`, then push the tag:

```sh
git tag v0.2.2
git push origin v0.2.2
```

`.github/workflows/release.yml` then gates the tag against `package.json`, runs `npm run verify`, packs the plugin, publishes to npm through GitHub Actions OIDC (no long-lived token, `repository.url` must match this repository, and an already-published version is skipped instead of failing), and creates the GitHub Release with the tarball and its sha256.

Publishing needs a **trusted publisher** on npmjs.com for `@idoall/dsh-notify` naming this repository and the exact workflow filename `release.yml`, with a direct `npm publish` allowed (connections created after 2026-09-03 default to staged publishing only).

## License

MIT. See [LICENSE](LICENSE).
