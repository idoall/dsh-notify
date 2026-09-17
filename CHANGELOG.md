# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). GitHub Releases use the same bilingual layout as [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1).

## [Unreleased]

Notifications are delivered live and nothing is stored: the stack in the top-right corner is the whole feature, so the sidebar bell, the history list and the store behind them are gone.

### Added

- **A toast stack.** Up to five notifications live in the top-right corner, newest on top; each new one takes the first slot and pushes the older ones down, animated by a measured `transform` rather than a re-flow. Cards enter with a spring scale + fade and leave by sliding out to the right.
- **Every card carries its own time.** The arrival time leads the card, to the second (`00:33:08`), because parallel tasks finish seconds apart and "which one was this" is exactly the question a stack of similar cards raises. It shares the metadata row the session name already used, so it costs the card no height and five cards still fit the same window; a record that is not from today falls back to `02-14 09:05`, and the full local date and time always sits in the tooltip. The clock leads rather than trails that row because the `+N` count is pinned to the corner and would otherwise sit on top of it; fixed-width digits keep the clocks in one column either way. The self-test group is spread over the previous half-minute so a burst shows distinct moments instead of eight identical ones.
- **A window, not a pile.** The corner is exactly five cards tall. A sixth notification takes its place below them, where the window scrolls to it (the wheel, or the count button, which jumps between the two ends of the queue); a sliver of the next card under the window edge is what makes the rest look reachable. The count is the whole queue — eight notifications show `+8`, whether five of them are on screen or not — and it is pinned to the corner outside the scroll box, so it neither scrolls away nor means something different once you have scrolled.
- **Action state on the card.** Answering a question or a plan review from a card reports itself: the icon spins while the answer is in flight, the buttons disable, and the card settles on a green check plus 已完成 (then retires on its own) or on a red error with the host message and a 重试 button.
- The settings self-test can fire a window-sized group (**测试 5 条**) and an overflowing one (**测试 8 条**), so what happens past the window — the count, the scroll and the card that waits below the fold — can be looked at without waiting for eight real notifications.
- **`src/buffer.js`**: a bounded in-memory delivery buffer, plus the one thing that does persist — the user own preferences. A page asks `/pull?since=<seq>` for whatever it has not seen, and the first poll of a page is treated as history it was not there for: it is never replayed as a pile of old cards.

### Changed

- **The corner is a window onto a page-scoped queue.** Five cards fit — always including anything waiting on the user, which is ordered first — and everything older keeps its slot below the fold instead of being dropped, one wheel-scroll away. Nothing about the stack depends on the pointer any more, and a card on its way out no longer counts towards the window while it slides away. A refresh still clears everything: nothing is stored, here or on the host.


- **A card leaves when the user says so.** No countdown bar and no clock: a notification stays until it is closed with **×**, opened by clicking the body, or answered successfully from the card itself. A record that arrives again because the host settled it (an approval, asked and then decided) updates its card in place instead of stacking a second one, and retires it.
- **Nothing is stored.** The profile keeps `settings.json` (sound, toast position, subtask noise) and nothing else. Records do not survive a restart, there is no read state anywhere, and no page is brought up to date on work it was not there for.

### Removed

- The sidebar bell with its badge, the pending/history panel, paging, mark-all-read, 已处理 and the batch delete behind **Select…** — along with `/ack`, `/settle`, `/clear`, `/delete`, `/open` and the host self-test suite that existed to exercise them. The plugin registers two seats instead of three.
- `src/storage.js` (394 lines): the epoch/cursor protocol, the change log, capacity eviction, the JSON documents and their schema validation and recovery. Every bug fixed in this release lived in that bookkeeping, and it was the only reason a full store could go silent.

### Fixed

- The corner could paint as a sliver of overlapping card edges before the cards appeared. A batch is created in a single commit, and the cards are measured in that commit's ref callbacks — while the frame is still `display:none`, because a `popover` that has not been shown yet is not laid out. Every card honestly reported a height of 0, and the window was built out of those zeros: five slots twelve pixels apart, clipped to one card-tall sliver. It then stayed that way until an unrelated re-render (the next poll, a resize) measured it again, which is the one-to-two seconds of "top borders with no content". The frame is now promoted to the top layer and re-measured in a layout effect, so the first painted frame is the finished one; the suite fakes the hidden-frame condition (a card height of 0 until the popover is shown) and asserts a measured window in the same flush, and both new tests fail against the old code.
- A burst of notifications trickled in one card per poll. The toast effect served only the *next* un-toasted record, which was right when a poll carried a single event; now that a poll returns everything after a sequence, several tasks finishing together appeared one card every 1.5 seconds. Every record delivered since the last poll is now presented in one pass, oldest first so the newest still lands on top.
- The stack flickered when the pointer crossed the gap between two cards. Hovering used to resize it — a card listening for its own pointer left the stack at the 12px gap, which collapsed it, which slid the cards back under the cursor and expanded it again. The window is now a fixed size and the queue is below the fold, so the pointer cannot move anything; the suite fires every boundary event a browser sends while the pointer crosses the stack and asserts that nothing — height, content, transforms, order — has changed.
- A card could flash and vanish a moment after it appeared. A record already on screen was treated as "the host has settled it" whenever it arrived again, so a host that re-sends what it has already delivered — an older host answering the old cursor protocol, or any duplicate delivery — closed every card on the next poll. Only a record that was **waiting on the user** and has since been settled retires its card now; every other repeat is the same notification and is ignored. The suite covers both a legacy host and a host whose sequence never advances.
- A notification that arrived once the store held its 300-record cap was delivered as a full-snapshot `reset`, and a reset pull is history rather than news — so it never raised a toast, while the background tab kept flashing about it. With no store there is no cap to reach, no epoch to advance and no reset to swallow.

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
