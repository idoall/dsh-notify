import test from 'node:test'; import assert from 'node:assert/strict';
import { createAttentionIndicator, createLocalSelfTestBatch, createSoundPlayer, installClientStyles, navigateNotificationRecord, queueCards, SELF_TEST_STEP_MS, TOAST_ATTENTION_MS, TOAST_STACK_COLLAPSED_PEEK, collapsedStackPlan, stackWindow, CLIENT_CSS, SETTINGS_CSS, layoutFor, revealSelectedSidebarSession, revealTurn, statusTone, resultTone, toastAnchor, toastAnchorWatchTargets, toastStackPlan, toastTime, toastTone, toastIcon, pendingInteractionFor, toastAnswer, answerBatch, sessionLabel } from '../src/client.js';
test('narrow layout keeps the coarse-pointer hit target', () => { assert.deepEqual(layoutFor({ width: 375, coarse: true }), { narrow: true, hitTarget: 44 }); });
test('settings status and self-test result tones drive the colour of one dot and one line', () => {
  assert.equal(statusTone('通知已连接'), 'ok'); assert.equal(statusTone('设置已保存'), 'ok'); assert.equal(statusTone('通知历史已清空'), 'ok');
  assert.equal(statusTone('持久化未配置'), 'warn'); assert.equal(statusTone('通知同步不可用'), 'warn');
  assert.equal(statusTone('设置保存失败'), 'error'); assert.equal(statusTone('清空失败，历史记录保持不变'), 'error');
  assert.equal(statusTone('正在加载…'), 'idle'); assert.equal(statusTone(), 'idle');
  assert.equal(resultTone('passed'), 'passed'); assert.equal(resultTone('failed'), 'failed');
  assert.equal(resultTone('running'), 'active'); assert.equal(resultTone('submitted'), 'active');
  assert.equal(resultTone('unsupported'), 'idle'); assert.equal(resultTone(undefined), 'idle');
});
test('toast anchors to the conversation column so it clears the right sidebar, never to 100vw', () => {
  // The stack container carries this anchor; the cards themselves are absolutely positioned inside it.
  const withScroll = (right) => ({ querySelector: (selector) => selector === '[data-conversation-scroll]' ? { getBoundingClientRect: () => ({ right, width: right - 280 }) } : null });
  assert.equal(toastAnchor({ document: withScroll(1906), innerWidth: 1908 }), 18, 'right sidebar closed: the toast sits at the window top-right');
  assert.equal(toastAnchor({ document: withScroll(1047), innerWidth: 1908 }), 877, 'right sidebar open: the toast clears the right pane instead of parking on top of it');
  assert.ok(1908 - toastAnchor({ document: withScroll(1047), innerWidth: 1908 }) <= 1049, 'the toast right edge must stay left of the right pane edge at 1049');
  assert.equal(toastAnchor({ document: { querySelector: () => null }, innerWidth: 1024 }), 168, 'the legacy centered-content guess remains the no-DOM-hook fallback');
  assert.equal(toastAnchor({ document: { querySelector: () => ({ getBoundingClientRect: () => ({ right: 40, width: 0 }) }) }, innerWidth: 1024 }), 168, 'a collapsed measurement falls back instead of anchoring off-screen');
  assert.equal(toastAnchor({ document: { querySelector: () => ({ getBoundingClientRect: () => ({ right: 5000, width: 100 }) }) }, innerWidth: 1024 }), 16, 'an out-of-viewport rect clamps to the 16px edge inset');
  const scroll = { id: 'scroll' }; const content = { id: 'content' }; const frame = { id: 'frame' };
  const col = { parentElement: frame };
  const layout = {
    querySelector: (selector) => {
      if (selector === '[data-conversation-scroll]') return scroll;
      if (selector === '[data-conversation-content]') return content;
      if (selector === '[data-rightbar-col]') return col;
      return null;
    },
  };
  assert.deepEqual(toastAnchorWatchTargets(layout), [scroll, content, frame], 'sidebar toggles resize the conversation and the grid frame, not the window');
});
test('toast tone maps every kind to one icon/progress colour family', () => {
  assert.equal(toastTone('completed'), 'success'); assert.equal(toastTone('failed'), 'error');
  assert.equal(toastTone('approval'), 'warning'); assert.equal(toastTone('question'), 'info'); assert.equal(toastTone('plan-review'), 'warning');
  assert.equal(toastTone('job-end'), 'neutral'); assert.equal(toastTone('test'), 'neutral'); assert.equal(toastTone('unknown-kind'), 'neutral');
  assert.equal(toastTone(undefined), 'neutral');
  for (const tone of ['success', 'error', 'warning', 'info', 'neutral']) assert.equal(typeof toastIcon(tone), 'object', `tone ${tone} needs an icon`);
});
test('a toast only offers answers it can honestly send, and uses the official batch shape', () => {
  const question = (over = {}) => ({ questions: [{ id: 'q1', options: [{ label: '批准' }, { label: '拒绝' }], ...over }], answer: async () => {} });
  const record = { kind: 'question', sessionId: 's1' };
  const simple = toastAnswer(record, question());
  assert.deepEqual(simple, { id: 'q1', options: [{ label: '批准', description: undefined }, { label: '拒绝', description: undefined }] });
  assert.deepEqual(answerBatch('q1', '批准'), { answers: [{ id: 'q1', selected: ['批准'] }] }, 'an option is selected by its label, exactly like the official composer');
  assert.equal(toastAnswer(record, question({ multiSelect: true })), null, 'multi-select needs the session UI');
  assert.equal(toastAnswer(record, question({ options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }] })), null, 'too many options for a toast');
  assert.equal(toastAnswer(record, question({ options: [] })), null);
  assert.equal(toastAnswer(record, { questions: [{ id: 'q1', options: [{ label: 'a' }] }, { id: 'q2', options: [{ label: 'b' }] }], answer: async () => {} }), null, 'multi-question batches must not be half-answered from a toast');
  assert.equal(toastAnswer({ kind: 'completed' }, question()), null, 'only question/plan-review notifications are answerable');
  assert.equal(toastAnswer(record, null), null); assert.equal(toastAnswer(record, { questions: [{ id: 'q1', options: [{ label: 'a' }] }] }), null, 'no answer() means no buttons');
  assert.equal(toastAnswer({ kind: 'plan-review' }, question()).id, 'q1', 'a plan review is answered the same way');
  const pending = new Map([['s1', { questions: [] }]]);
  assert.equal(pendingInteractionFor(pending, 's1').questions.length, 0);
  assert.equal(pendingInteractionFor(pending, 's2'), null); assert.equal(pendingInteractionFor(null, 's1'), null); assert.equal(pendingInteractionFor(pending, undefined), null);
});

test('every notification can name its session, and never goes anonymous', () => {
  const sessions = (byId) => ({ list: { getSnapshot: () => ({ ids: Object.keys(byId), byId }) } });
  assert.equal(sessionLabel(sessions({ s1: { id: 's1', displayTitle: '修复插件本机访问布局问题' } }), 's1'), '修复插件本机访问布局问题');
  assert.equal(sessionLabel(sessions({ s1: { id: 's1', displayTitle: '  ' } }), 's1'), 's1', 'an untitled session still identifies itself');
  assert.equal(sessionLabel(sessions({ s1: { id: 's1', blank: true, displayTitle: '不该用' } }), 's1'), 's1', 'a blank row has no stored title yet');
  assert.equal(sessionLabel(sessions({}), 'session-1234567890abcdef'), 'session-…', 'a missing summary degrades to a short id');
  assert.equal(sessionLabel(undefined, 's1'), 's1'); assert.equal(sessionLabel(sessions({}), ''), null); assert.equal(sessionLabel(sessions({}), undefined), null);
  assert.equal(sessionLabel({ list: { getSnapshot() { throw new Error('boom'); } } }, 's1'), 's1', 'a broken service must not break the toast');
});

test('the sound player synthesises built-ins, plays uploads, and reports a locked context honestly', async () => {
  const started = []; const gains = [];
  class FakeContext {
    state = 'running'; currentTime = 1; destination = {};
    createOscillator() { const node = { type: '', frequency: { value: 0 }, connect() {}, start(at) { started.push({ freq: node.frequency.value, at }); }, stop() {} }; return node; }
    createGain() { const node = { gain: { setValueAtTime() {}, linearRampToValueAtTime(value) { gains.push(value); }, exponentialRampToValueAtTime() {} }, connect() {} }; return node; }
  }
  const played = []; const elements = [];
  class FakeAudio { constructor(src) { this.src = src; elements.push(src); } addEventListener() {} play() { played.push(this.src); return Promise.resolve(); } pause() {} }
  const player = createSoundPlayer({ audio: { document: { hidden: false } }, AudioContextClass: FakeContext, AudioElementClass: FakeAudio });
  assert.deepEqual(await player.play('none'), { played: false, reason: 'silent' });
  assert.deepEqual(await player.play('chime'), { played: true, reason: 'played' });
  assert.equal(started.length, 2, 'chime is a two-note cue'); assert.deepEqual(started.map((note) => note.freq), [880, 1318.5]);
  assert.deepEqual(await player.play('custom:Ding.mp3'), { played: true, reason: 'played' });
  assert.deepEqual(elements, ['/plugins/dsh-notify/sound?name=Ding.mp3'], 'uploads play through the exact Host route');
  assert.deepEqual(await player.play('chime', { enabled: false }), { played: false, reason: 'disabled' });
  assert.deepEqual(await player.play('chime', { hidden: true }), { played: true, reason: 'played' }, 'a hidden page still plays: a browser hidden behind another app is exactly the case the cue exists for');

  const locked = createSoundPlayer({ audio: { document: { hidden: false } }, AudioContextClass: class { state = 'suspended'; createOscillator() { throw new Error('must not synth while suspended'); } }, AudioElementClass: undefined });
  assert.deepEqual(await locked.play('ping'), { played: false, reason: 'locked' }, 'a suspended context is reported, never faked');
  const unsupported = createSoundPlayer({ audio: { document: { hidden: false } }, AudioContextClass: undefined, AudioElementClass: undefined });
  assert.deepEqual(await unsupported.play('ping'), { played: false, reason: 'unsupported' });
});

test('a notification that knows its turn reveals exactly that turn, and gives up quietly', async () => {
  const scrolled = []; const attributes = [];
  const element = { scrollIntoView: (options) => scrolled.push(options), setAttribute: (k, v) => attributes.push(['set', k, v]), removeAttribute: (k) => attributes.push(['remove', k]) };
  let found = null;
  const doc = { querySelector: (selector) => { found = selector; return found === null ? null : element; } };
  const timers = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} };
  const stop = revealTurn(7, { document: doc, timers });
  assert.equal(typeof stop, 'function');
  assert.equal(found, '[data-chat-turn="7"]', 'the semantic turn hook is the selector');
  assert.deepEqual(scrolled, [{ block: 'center', behavior: 'smooth' }]);
  assert.deepEqual(attributes[0], ['set', 'data-dsh-notify-turn', 'highlight']);

  // Nothing there (wrong session, old history): attempt, then stop without throwing.
  let calls = 0;
  const schedule = [];
  const empty = { querySelector: () => { calls += 1; return null; } };
  revealTurn(3, { document: empty, attempts: 2, intervalMs: 5, timers: { setTimeout: (fn) => { schedule.push(fn); return schedule.length; }, clearTimeout: () => {} } });
  schedule.shift()?.();
  assert.equal(calls, 1);
  schedule.shift()?.();
  assert.equal(calls, 2); schedule.shift()?.();
  assert.equal(calls, 2, 'it stops after the attempt budget instead of polling forever');
  assert.equal(revealTurn(0, { document: empty })(), undefined, 'a record without a turn is a no-op');
  assert.equal(revealTurn(undefined, { document: empty })(), undefined);
});

test('a notification navigation reveals the selected session in the host-owned sidebar after its render commits', () => {
  const scrolled = []; const scheduled = [];
  let selected = null;
  const doc = { querySelector: (selector) => { assert.equal(selector, '[role="treeitem"][aria-selected="true"]'); return selected; } };
  const stop = revealSelectedSidebarSession({ document: doc, attempts: 3, intervalMs: 5, setTimer: (fn) => { scheduled.push(fn); return scheduled.length; }, clearTimer: () => {} });
  assert.equal(typeof stop, 'function');
  scheduled.shift()();
  assert.equal(scheduled.length, 1, 'it waits for the host to commit the new selected row');
  selected = { scrollIntoView: (options) => scrolled.push(options) };
  scheduled.shift()();
  assert.deepEqual(scrolled, [{ block: 'center', inline: 'nearest', behavior: 'smooth' }]);
  stop();
  const cancelled = []; const later = revealSelectedSidebarSession({ document: doc, setTimer: (fn) => { cancelled.push(fn); return 9; }, clearTimer: () => {} });
  later(); cancelled.shift()();
  assert.equal(scrolled.length, 1, 'cancelling before commit does not scroll a stale sidebar row');
});

test('the tab attention indicator flashes only for a background tab with unread records, and restores everything', () => {
  let ticks = null; const cleared = [];
  const icon = { href: 'https://dsh.test/favicon.ico', getAttribute: () => 'https://dsh.test/favicon.ico' };
  const doc = { title: '修复插件 — DeepSeek Harness', querySelector: (selector) => selector.includes('icon') ? icon : null };
  const indicator = createAttentionIndicator({ document: doc, timers: { setInterval: (fn) => { ticks = fn; return 7; }, clearInterval: (id) => cleared.push(id) }, intervalMs: 900, reducedMotion: false });
  assert.equal(indicator.active, false);

  indicator.update({ unread: 0, visible: false });
  assert.equal(indicator.active, false, 'nothing unread means no flashing');
  indicator.update({ unread: 3, visible: true });
  assert.equal(indicator.active, false, 'a visible tab does not need a flashing title');
  assert.equal(doc.title, '修复插件 — DeepSeek Harness');

  indicator.update({ unread: 3, visible: false });
  assert.equal(indicator.active, true);
  assert.equal(doc.title, '🔔 修复插件 — DeepSeek Harness');
  assert.equal(icon.href.startsWith('data:image/svg+xml'), true, 'the favicon alternates to a dot');
  ticks();
  assert.equal(doc.title, '修复插件 — DeepSeek Harness', 'and then back, so it reads as a flash');
  ticks();
  assert.equal(doc.title, '🔔 修复插件 — DeepSeek Harness');

  indicator.update({ unread: 0, visible: false });
  assert.equal(indicator.active, false); assert.deepEqual(cleared, [7]);
  assert.equal(doc.title, '修复插件 — DeepSeek Harness');
  assert.equal(icon.href, 'https://dsh.test/favicon.ico', 'the original favicon comes back');

  indicator.update({ unread: 1, visible: false }); indicator.update({ unread: 1, visible: true });
  assert.equal(doc.title, '修复插件 — DeepSeek Harness', 'looking at the tab stops the flashing immediately');
  const still = createAttentionIndicator({ document: doc, timers: { setInterval: () => 1, clearInterval: () => {} }, reducedMotion: true });
  still.update({ unread: 2, visible: false });
  assert.equal(doc.title, '🔔 修复插件 — DeepSeek Harness');
  still.update({ unread: 2, visible: false });
  assert.equal(still.active, true, 'reduced motion keeps the marker but never animates it');
});

test('a record with nowhere to go is still dismissible, while a real session stays retryable', async () => {
  const acked = [];
  const acknowledge = async (record) => { acked.push(record.eventId); };
  const sessions = { binding: () => ({}), open: () => true, list: { getSnapshot: () => ({ current: 's1', byId: { s1: { displayTitle: '会话一' } } }) } };

  // Self-test artefacts never had a session: clicking must be able to clear them, or the unread
  // badge stays red forever with no way out.
  const artefact = { eventId: 'self-test', sessionId: null, turn: undefined };
  assert.deepEqual(await navigateNotificationRecord(artefact, { sessions, acknowledge }), { status: 'acknowledged-without-session' });
  assert.deepEqual(acked, ['self-test'], 'the session-less record is acknowledged');

  // A session that is gone from the list can never be opened again either.
  const deleted = { eventId: 'deleted', sessionId: 's-gone' };
  assert.deepEqual(await navigateNotificationRecord(deleted, { sessions, acknowledge }), { status: 'acknowledged-without-session' });
  assert.deepEqual(acked, ['self-test', 'deleted']);

  // Still listed but the host did not select it: do not ack by guesswork, so the notification is not lost.
  const unbound = { eventId: 'unbound', sessionId: 's1' };
  const strict = { binding: () => undefined, open: () => true, list: { getSnapshot: () => ({ current: 'other', byId: { s1: { displayTitle: '会话一' } } }) } };
  assert.deepEqual(await navigateNotificationRecord(unbound, { sessions: strict, acknowledge }), { status: 'navigation-failed' });
  assert.deepEqual(acked, ['self-test', 'deleted'], 'an unopenable but existing session keeps its unread state');

  // The normal path still navigates, reveals the turn and acknowledges.
  const normal = { eventId: 'normal', sessionId: 's1', turn: 4 };
  assert.deepEqual(await navigateNotificationRecord(normal, { sessions, acknowledge }), { status: 'acknowledged' });
  assert.deepEqual(acked, ['self-test', 'deleted', 'normal']);
});

test('each card is pushed down by the measured heights above it', () => {
  assert.deepEqual(toastStackPlan({ heights: [60, 40] }).map((slot) => slot.offsetY), [0, 72]);
  assert.deepEqual(toastStackPlan({ heights: [60, 40, 40] }).map((slot) => slot.offsetY), [0, 72, 124]);
  // An unmeasured card must not poison the offsets, and an empty stack is empty.
  assert.deepEqual(toastStackPlan({ heights: [0, 0] }).map((slot) => slot.offsetY), [0, 12]);
  assert.deepEqual(toastStackPlan({ heights: [60, 40], gap: 8 }).map((slot) => slot.offsetY), [0, 68]);
  assert.deepEqual(toastStackPlan(), []);
});
test('a folded pile bottom-aligns complete older cards under equal exposed edges', () => {
  assert.equal(TOAST_STACK_COLLAPSED_PEEK, 18);
  assert.deepEqual(collapsedStackPlan({ heights: [100, 80, 70, 60, 50] }).map((slot) => slot.offsetY), [0, 38, 66, 94, 122]);
  assert.equal(TOAST_ATTENTION_MS, 4000, 'attention is a short visual cue, not a dismissal duration');
  assert.match(CLIENT_CSS, /data-style=strong\]\[data-attention=true\]/, 'only the enhanced presentation draws the attention bar');
});
test('the window is as tall as the cards it holds, plus a peek when there are more', () => {
  // Five fit: the window is exactly those five, and there is nothing to scroll to.
  const five = stackWindow({ heights: [60, 60, 60, 60, 60] });
  assert.deepEqual(five, { total: 5, hidden: 0, windowHeight: 60 * 5 + 12 * 4, contentHeight: 60 * 5 + 12 * 4, overflow: false });
  // Eight: the window still holds five, but is a sliver taller so the sixth card shows its edge, and
  // the content behind it is the whole queue — that is what makes scrolling possible at all.
  const eight = stackWindow({ heights: Array(8).fill(60) });
  assert.equal(eight.windowHeight, 60 * 5 + 12 * 4 + 10, 'five cards plus a peek');
  assert.equal(eight.contentHeight, 60 * 8 + 12 * 7, 'everything the user can scroll to');
  assert.deepEqual([eight.total, eight.hidden, eight.overflow], [8, 3, true]);
  // Cards are not all the same height, so the window is measured, never assumed.
  assert.equal(stackWindow({ heights: [100, 60, 60, 60, 60, 60] }).windowHeight, 100 + 60 * 4 + 12 * 4 + 10);
  // An unmeasured first paint must not make the window taller than the cards it is showing.
  assert.equal(stackWindow({ heights: [0, 0, 0, 0, 0, 0] }).windowHeight, 12 * 4 + 10);
  assert.equal(stackWindow({ heights: [] }).overflow, false);
  assert.equal(stackWindow({ heights: [60, 60, 60] , visible: 3 }).overflow, false);
  assert.equal(stackWindow({ heights: [60, 60, 60, 60], visible: 3 }).overflow, true, 'a phone window overflows sooner');
});
test('the page-scoped queue keeps waiting work first and lets go of nothing until it is full', () => {
  const settled = (id, at) => ({ record: { eventId: id, phase: 'settled', at } });
  const pending = (id, at) => ({ record: { eventId: id, phase: 'open', at } });
  // Newest first within each group, and the question outranks every completion that followed it.
  const queue = [settled('c3', 3), settled('c2', 2), pending('q1', 1)];
  assert.deepEqual(queueCards(queue).map((card) => card.record.eventId), ['q1', 'c3', 'c2']);
  assert.deepEqual(queueCards(queue).length, 3, 'nothing is dropped before the cap');
  // The cap is a guard against a runaway stream; waiting work is ordered first, so it goes last.
  const many = [pending('q1', 1), ...Array.from({ length: 8 }, (_, index) => settled(`c${index}`, 10 + index))];
  const capped = queueCards(many, 4);
  assert.equal(capped.length, 4);
  assert.equal(capped[0].record.eventId, 'q1', 'the cap never takes the card that waits on the user');
});

test('each card is stamped with its own clock, and the full date rides in the tooltip', () => {
  // Constructed and formatted in local time on purpose: the label never depends on the runner's zone.
  const at = new Date(2026, 1, 14, 9, 5, 3).getTime();
  assert.deepEqual(toastTime(at, new Date(2026, 1, 14, 23, 59, 0).getTime()),
    { label: '09:05:03', title: '2026-02-14 09:05:03', iso: new Date(at).toISOString() },
    'the same day is just the clock, to the second, because parallel tasks finish seconds apart');
  // A tab that was asleep across midnight still gets a date instead of a lie about "today".
  assert.equal(toastTime(at, new Date(2026, 1, 15, 0, 1, 0).getTime()).label, '02-14 09:05');
  assert.equal(toastTime(at, new Date(2027, 1, 14, 9, 5, 3).getTime()).label, '02-14 09:05');
  // And a record with no usable stamp is simply not stamped, rather than stamped with 1970.
  for (const missing of [undefined, null, 0, -1, 'nonsense', NaN]) assert.equal(toastTime(missing), null, `${missing} has no time`);
});
test('a self-test group is spread over time so eight cards read as eight different moments', () => {
  const batch = createLocalSelfTestBatch({ count: 8, now: 1_000_000, randomUUID: () => 'r' });
  assert.equal(batch.length, 8);
  assert.equal(batch.at(-1).at, 1_000_000, 'the newest card is now');
  assert.equal(batch[0].at, 1_000_000 - 7 * SELF_TEST_STEP_MS, 'and the oldest is seven steps back');
  assert.equal(new Set(batch.map((record) => record.at)).size, 8, 'every card keeps its own moment');
  assert.deepEqual(batch.map((record) => record.eventId), batch.map((record) => record.mergeKey), 'distinct records, so they cannot merge into one card');
});
