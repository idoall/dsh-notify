# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-14

First public release. Verified against DeepSeek Harness `0.1.5-rc.1`.

### Added

- In-page toast for completed turns, failures, questions, approvals, plan reviews and job/workflow ends: title, body, session name, kind tone, close button, countdown bar.
- Answering questions and approvals straight from the toast, sharing the same pending interaction as the composer.
- Sidebar bell with unread/read history, paging, "mark all read", and batch delete behind a **Select…** trigger.
- Jump to the session **and the exact turn** (`data-chat-turn`), with a brief highlight.
- WebAudio notification sound: synthesised built-ins (chime / ping / alert / silent), uploadable custom sounds with validation, and a preview button that also unlocks the audio context. Plays while the page is hidden.
- Background tab attention indicator: 🔔 title prefix and an alternating favicon dot, stopping when the tab is looked at or nothing is unread.
- Settings section: read retention, toast position, opt-in subtask/background-job notifications, sound, self-test.
- Self-test card plus advanced checks (persisted history, navigation/unread, storage round-trip, deduplication).
- Profile-owned persistence with recovery on corrupt documents and an epoch/cursor protocol for clients.

### Changed

- Read state is immediate in the bell count while the row fades in place; it only moves to the read list when the list is reopened.
- The narrow-layout history panel is capped to its flex container instead of a `dvh` guess, so it no longer overflows the top on phones.
- The history panel is promoted to the browser top layer so a fixed mobile sidebar cannot cover it.

### Removed

- Browser system notifications (channel B), host OS notifications (channel C) and web push / service worker (channel D), along with the `web-push` and `ipaddr.js` dependencies. Those channels failed invisibly (submitted but never seen) and could not be made reliable across browsers and operating systems.

[0.1.0]: https://github.com/idoall/dsh-notify/releases/tag/v0.1.0
