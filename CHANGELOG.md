# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). GitHub Releases use the same bilingual layout as [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1).

## [0.1.2] - 2026-09-16

The sidebar badge could pin itself at 1 and refuse to go away. A notification left pending by an interrupted interaction is now resolved where it is created, when its session is rebuilt, and when the host starts.

### Fixed

- An interrupted approval (“需要审批” whose turn was stopped before any `approval/decided`) came back to the sidebar badge on every session reload and could not be dismissed: 已处理 cleared it, reopening the session put it straight back. DSH’s `approval/asked` payload carries no `turn`, so restart healing — which only expires a record from a turn that already ended — left every approval alone, and the history replay re-applied `phase: 'open'` on top of a record the user had already settled. An approval now records the turn its `tool/call` belonged to (live and during the rebuild), and a replayed ask never reopens a record that is already settled or expired.
- A pending record inherited from a previous host process is expired at boot, so a leftover in a session that is never reopened can no longer pin the badge across restarts: per-session healing only runs when that session is created again. A cordis re-activation inside a running host is not a boot and never clears a genuinely pending interaction.

## [0.1.1] - 2026-09-15

Notify when the **task** is done, not when a **turn** is done. The sidebar badge now counts only work that still waits on you.

### Added

- Quiet **已处理** action on pending rows, plus batch **标记已处理**. Host `POST /settle` ends pending state (idempotent, same-origin + auth). Distinct from `/ack`, which only means “seen”.
- Plugin config `completionGraceMs` (default `8000`). Set to `0` to restore “notify on every finished turn”.

### Changed

- Sidebar badge and aria-label count `phase: open` only. Finished work never inflates the number.
- History panel tabs are **待处理 / 历史**, matching the badge. Rows still dim once seen; read retention trims the history tab.
- Toast **×** marks every kind as read, including an open question (the composer still holds the answer).
- Tab flash fires for pending work, or for unread that arrived while the tab was hidden — never for a stale backlog.
- A notifiable `turn/end` is deferred: a `turn/start` or `tool/call` inside the grace window cancels it; an engaged goal holds it until `goal/activation-changed` reports the goal is gone.

### Fixed

- One unanswered `open` record no longer starves later toasts.
- Answering a question in the composer (or elsewhere) closes the live toast and marks it read.
- `/ack` is idempotent; a duplicate ack no longer skips the next one.
- Listeners are bounded so a stuck write cannot wedge DSH HTTP, session creation, or other plugins.
- Startup rebuild expires leftovers whose turn already ended; a live question in a turn that has not ended is left alone.
- A settle the host did not accept is reported as a failure, not as success.

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

[0.1.2]: https://github.com/idoall/dsh-notify/releases/tag/v0.1.2
[0.1.1]: https://github.com/idoall/dsh-notify/releases/tag/v0.1.1
[0.1.0]: https://github.com/idoall/dsh-notify/releases/tag/v0.1.0
