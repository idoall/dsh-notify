import test from 'node:test'; import assert from 'node:assert/strict';
import { createAttentionIndicator, createSoundPlayer, navigateNotificationRecord, revealTurn, readRetentionCutoff, layoutFor, toastPolicy, toastQueue, channelStatus, prioritizedToastRecords, toastStyleForKind, installClientStyles, CLIENT_CSS, SETTINGS_CSS, BELL_CLASS, bellActionStyle, bellBadgeStyle, toastAnchor, statusTone, resultTone, toastTone, toastIcon, pendingInteractionFor, toastAnswer, answerBatch, sessionLabel } from '../src/client.js';
test('narrow layout has safe touch target and persistent open toast', () => { assert.deepEqual(layoutFor({width:375,coarse:true}), {narrow:true,hitTarget:44}); assert.equal(toastPolicy({phase:'open'},{width:375}).persistent,true); });
test('toast queue caps narrow and desktop and exposes the single remaining channel', () => { assert.equal(toastQueue([{phase:'settled'},{phase:'settled'},{phase:'settled'}],375).length,2); assert.equal(toastQueue([{phase:'settled'},{phase:'settled'},{phase:'settled'}],1024).length,3); assert.equal(channelStatus({},{}).length, 1, 'only 页面里 remains'); assert.equal(channelStatus({},{})[0].id, 'A'); });
test('toast styles map kind tokens and colors', () => { assert.equal(toastStyleForKind('approval').token, 'warning'); assert.equal(toastStyleForKind('completed').token, 'success'); assert.match(toastStyleForKind('failed').borderInlineStart, /danger/); });
test('plugin-owned open interactions suppress completion toasts without guessing Host modal state', () => { const done = {eventId:'done',phase:'settled'}; const open = {eventId:'open',phase:'open'}; assert.deepEqual(prioritizedToastRecords([done,open]), [open]); assert.equal(toastQueue([done,open],1024)[0].record.eventId,'open'); });
test('settings status and self-test result tones drive the colour of one dot and one line', () => {
  assert.equal(statusTone('通知已连接'), 'ok'); assert.equal(statusTone('设置已保存'), 'ok'); assert.equal(statusTone('通知历史已清空'), 'ok');
  assert.equal(statusTone('持久化未配置'), 'warn'); assert.equal(statusTone('通知同步不可用'), 'warn');
  assert.equal(statusTone('设置保存失败'), 'error'); assert.equal(statusTone('清空失败，历史记录保持不变'), 'error');
  assert.equal(statusTone('正在加载…'), 'idle'); assert.equal(statusTone(), 'idle');
  assert.equal(resultTone('passed'), 'passed'); assert.equal(resultTone('failed'), 'failed');
  assert.equal(resultTone('running'), 'active'); assert.equal(resultTone('submitted'), 'active');
  assert.equal(resultTone('unsupported'), 'idle'); assert.equal(resultTone(undefined), 'idle');
});
test('bell occupies its own full-width sidebar row when wide and an official-sized rail icon when collapsed', () => {
  const wide = bellActionStyle(true); const rail = bellActionStyle(false);
  assert.equal(wide.flex, '1 1 100%'); assert.equal(wide.width, undefined); assert.equal(wide.height, 42); assert.equal(wide.justifyContent, 'flex-start'); assert.equal(wide.padding, '0 10px 0 8px'); assert.equal(wide.borderRadius, 12);
  assert.equal(wide.background, undefined, 'an inline background would out-rank the shared :hover rule');
  assert.equal(rail.flex, '0 0 auto'); assert.equal(rail.width, 36); assert.equal(rail.height, 36); assert.equal(rail.borderRadius, '50%', 'the rail icon matches the official and dsh-mobile 36px round rail buttons'); assert.equal(rail.position, 'relative'); assert.equal(rail.justifyContent, 'center'); assert.equal(rail.padding, 0); assert.equal(rail.maxWidth, '100%'); assert.equal(rail.margin, '4px 0');
  const wideBadge = bellBadgeStyle(true); const railBadge = bellBadgeStyle(false);
  assert.equal(wideBadge.marginInlineStart, 'auto'); assert.equal(wideBadge.position, undefined);
  assert.equal(railBadge.position, 'absolute'); assert.equal(railBadge.insetInlineEnd, 2); assert.equal(railBadge.height, 16, 'the rail badge must overlay the icon instead of widening the 36px rail box');
});
test('toast anchors to the conversation column so it clears the right sidebar, never to 100vw', () => {
  const withScroll = (right) => ({ querySelector: (selector) => selector === '[data-conversation-scroll]' ? { getBoundingClientRect: () => ({ right, width: right - 280 }) } : null });
  assert.equal(toastAnchor({ document: withScroll(1906), innerWidth: 1908 }), 18, 'right sidebar closed: the toast sits at the window top-right');
  assert.equal(toastAnchor({ document: withScroll(1047), innerWidth: 1908 }), 877, 'right sidebar open: the toast clears the right pane instead of parking on top of it');
  assert.ok(1908 - toastAnchor({ document: withScroll(1047), innerWidth: 1908 }) <= 1049, 'the toast right edge must stay left of the right pane edge at 1049');
  assert.equal(toastAnchor({ document: { querySelector: () => null }, innerWidth: 1024 }), 168, 'the legacy centered-content guess remains the no-DOM-hook fallback');
  assert.equal(toastAnchor({ document: { querySelector: () => ({ getBoundingClientRect: () => ({ right: 40, width: 0 }) }) }, innerWidth: 1024 }), 168, 'a collapsed measurement falls back instead of anchoring off-screen');
  assert.equal(toastAnchor({ document: { querySelector: () => ({ getBoundingClientRect: () => ({ right: 5000, width: 100 }) }) }, innerWidth: 1024 }), 16, 'an out-of-viewport rect clamps to the 16px edge inset');
});
test('only the footer action row holding our bell is allowed to wrap, and the bell reuses the neighbours hover/active/focus set', () => {
  const appended = []; const removed = [];
  const fake = { head: { append(element) { appended.push(element); } }, createElement() { return { dataset: {}, textContent: '', remove() { removed.push(this); } }; } };
  const dispose = installClientStyles({ document: fake });
  const style = appended[0];
  assert.equal(style.dataset.plugin, 'dsh-notify'); assert.equal(style.textContent, CLIENT_CSS);
  assert.match(style.textContent, /footerActions/); assert.match(style.textContent, new RegExp(`:has\\(\\.${BELL_CLASS}\\)`)); assert.match(style.textContent, /flex-wrap:\s*wrap/);
  const mobileHover = 'var(--dsw-alias-interactive-bg-hover,#f1f3f6)'; const mobileActive = 'var(--dsw-alias-interactive-bg-active,#e8ebf0)';
  assert.match(style.textContent, new RegExp(`\\.${BELL_CLASS}:hover\\{background:${mobileHover.replace(/[()]/g, '\\$&')}`), 'hover must use the same token as dsh-mobile 移动访问 and ui-settings-general 设置');
  assert.ok(style.textContent.includes(`:active,.${BELL_CLASS}[aria-expanded="true"]{background:${mobileActive}}`), 'pressed and open reuse the neighbours active token');
  assert.ok(style.textContent.includes(`.${BELL_CLASS}:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:2px}`));
  assert.ok(style.textContent.includes(`.${BELL_CLASS}{font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit);background:0 0}`), 'buttons must not fall back to the UA font/background');
  assert.ok(style.textContent.includes(SETTINGS_CSS), 'the settings section ships in the same injected stylesheet');
  assert.match(SETTINGS_CSS, /\.dsh-notify-settings\{display:grid/); assert.match(SETTINGS_CSS, /\.dsh-notify-card\{border:1px solid var\(--dsw-alias-border-l2\)/); assert.match(SETTINGS_CSS, /\.dsh-notify-select\{/); assert.match(SETTINGS_CSS, /min-height:44px/, 'coarse pointers keep the 44px hit target required by the UX contract');
  assert.match(SETTINGS_CSS, /color:var\(--dsw-alias-label-secondary\)/); assert.match(SETTINGS_CSS, /border:1px solid var\(--dsw-alias-border-l2\)/);
  assert.equal(/(^|\})\s*(button|input|select|label|section|h2|h3|p|summary)[\s,{.:[]/.test(SETTINGS_CSS), false, 'every rule must be dsh-notify-namespaced so the global stylesheet cannot restyle the host app');
  dispose(); assert.deepEqual(removed, [style]);
  assert.equal(typeof installClientStyles({ document: null }), 'function');
  installClientStyles({ document: null })();
  assert.equal(typeof installClientStyles({ document: { head: {} } }), 'function');
  installClientStyles({ document: { head: {} } })();
});

test('toast tone maps every kind to one icon/progress colour family', () => {
  assert.equal(toastTone('completed'), 'success'); assert.equal(toastTone('failed'), 'error');
  assert.equal(toastTone('approval'), 'warning'); assert.equal(toastTone('question'), 'info'); assert.equal(toastTone('plan-review'), 'info');
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

test('已读 retention hides older acknowledged records and never touches unread ones', () => {
  const now = 1_700_000_000_000;
  assert.equal(readRetentionCutoff(0, now), null, '0 means keep everything');
  assert.equal(readRetentionCutoff(undefined, now), null);
  assert.equal(readRetentionCutoff(7, now), now - 7 * 24 * 60 * 60 * 1000);
  const cutoff = readRetentionCutoff(1, now);
  const records = [
    { eventId: 'fresh-read', unread: false, at: now - 60_000 },
    { eventId: 'stale-read', unread: false, at: now - 2 * 24 * 60 * 60 * 1000 },
    { eventId: 'stale-unread', unread: true, at: now - 2 * 24 * 60 * 60 * 1000 },
  ];
  const readTab = records.filter((record) => !record.unread).filter((record) => cutoff === null || record.at >= cutoff);
  assert.deepEqual(readTab.map((record) => record.eventId), ['fresh-read'], 'only old READ records are hidden');
  const unreadTab = records.filter((record) => record.unread);
  assert.deepEqual(unreadTab.map((record) => record.eventId), ['stale-unread'], 'an old unread record is never hidden by retention');
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

  // Still listed but not openable here: do not ack by guesswork, so the notification is not lost.
  const unbound = { eventId: 'unbound', sessionId: 's1' };
  const strict = { ...sessions, binding: () => undefined };
  assert.deepEqual(await navigateNotificationRecord(unbound, { strict, sessions: strict, acknowledge }), { status: 'navigation-failed' });
  assert.deepEqual(acked, ['self-test', 'deleted'], 'an unopenable but existing session keeps its unread state');

  // The normal path still navigates, reveals the turn and acknowledges.
  const normal = { eventId: 'normal', sessionId: 's1', turn: 4 };
  assert.deepEqual(await navigateNotificationRecord(normal, { sessions, acknowledge }), { status: 'acknowledged' });
  assert.deepEqual(acked, ['self-test', 'deleted', 'normal']);
});
