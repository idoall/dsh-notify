import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, Config, jobNotification } from '../src/index.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(predicate) { for (let attempt = 0; attempt < 100; attempt += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('condition did not settle'); }
/**
 * Event bookkeeping for the ctx doubles below. Cordis dispatches an event to every listener, so a plain
 * `Map<name, handler>` is a lie: the plugin registers two for `session/event` (the turn/grace logic and
 * the workflow-owner lookup), and a single-slot map silently kept only the last one. `listeners.get(name)`
 * therefore hands back one callable that runs them in order and yields the last result — which is also
 * what a test wants when it awaits a waterfall handler.
 */
function createListeners() {
  const handlers = new Map();
  return {
    listeners: { get: (name) => (...args) => { let result; for (const handler of [...(handlers.get(name) ?? [])]) result = handler(...args); return result; } },
    register(name, handler) {
      const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list);
      return () => { const at = list.indexOf(handler); if (at !== -1) list.splice(at, 1); };
    },
  };
}
async function fixture(t, rejection, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { listeners, register } = createListeners();
  const routes = new Map();
  const webServer = { register(route) { const key = `${route.kind}:${route.path}`; if (routes.has(key)) throw new Error(`duplicate ${key}`); routes.set(key, route); return () => routes.delete(key); } };
  const connection = { requestRejection: typeof rejection === 'function' ? rejection : () => rejection };
  // Current DSH: one job event stream. `events.subscribe(filter, listener)` is the 0.1.7 seam; `onJobDone`
  // is the pre-0.1.7 listener this plugin still falls back to.
  const jobs = { events: { subscribe(filter, handler) { return register('job/settled', (job) => handler({ type: 'settled', job, cause: 'producer', awaited: false })); } } };
  const ctx = {
    get(name) { return { webServer, connection, jobs }[name]; },
    on(name, handler) { return register(name, handler); },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0, ...config });
  assert.equal(typeof runtime, 'function', 'Cordis async plugin must resolve to a disposer');
  return { dir, listeners, routes, runtime, records: () => runtime.buffer.pull().items };
}
function request({ method = 'GET', path = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return { method, url: path, headers, resume() {}, async *[Symbol.asyncIterator]() { yield* chunks; } };
}
function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value = '') { this.body += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); } };
}
async function invoke(route, req) { const res = response(); await route.handler(req, res); return res; }
const browserHeaders = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one', 'content-type': 'application/json' };

test('sound routes list, upload, serve and delete only allow-listed audio, behind auth', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-sounds-'));
  const { routes, runtime } = await fixture(t, undefined, { dataDir: dir });
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const sound = routes.get('exact:/plugins/dsh-notify/sound');
  const remove = routes.get('exact:/plugins/dsh-notify/sounds/delete');
  assert.ok(list && sound && remove, 'all three sound routes are exact objects');

  const empty = JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }))).body);
  assert.deepEqual(empty.custom, []); assert.deepEqual(empty.builtins, ['chime', 'ping', 'alert', 'none']); assert.equal(empty.maxBytes, 1024 * 1024);

  const reject = async (name, bytes, status) => { const result = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...browserHeaders, 'x-sound-name': name }, body: bytes })); assert.equal(result.statusCode, status, `${name} -> ${status}`); };
  await reject('../evil.mp3', 'x', 400);
  await reject('note.txt', 'x', 400);
  await reject('ok.mp3', '', 400);
  await reject('ok.mp3', 'x'.repeat(1024 * 1024 + 1), 413);

  const upload = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...browserHeaders, 'x-sound-name': 'Ding.MP3' }, body: 'audio-bytes' }));
  assert.equal(upload.statusCode, 200); assert.deepEqual(JSON.parse(upload.body), { ok: true, name: 'Ding.mp3', bytes: 11 });

  const served = await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=Ding.mp3', headers: browserHeaders }));
  assert.equal(served.statusCode, 200); assert.equal(served.headers['content-type'], 'audio/mpeg'); assert.equal(served.body, 'audio-bytes');
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=../etc/passwd', headers: browserHeaders }))).statusCode, 404);
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=missing.mp3', headers: browserHeaders }))).statusCode, 404);

  const deleted = await invoke(remove, request({ method: 'POST', path: '/plugins/dsh-notify/sounds/delete', headers: browserHeaders, body: { confirm: true, name: 'Ding.mp3' } }));
  assert.deepEqual(JSON.parse(deleted.body), { ok: true });
  assert.deepEqual(JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }))).body).custom, []);
  await runtime();
});
test('the sound list degrades to empty when the profile directory is unusable', async (t) => {
  const { routes } = await fixture(t, undefined, { dataDir: 'relative/not/absolute' });
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const result = await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }));
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.body).custom, []);
});
test('Host declares no hard service injection and exports a DSH config schema', () => {
  assert.deepEqual(inject, []);
  assert.equal(typeof Config, 'function');
});

test('session/event records approvals without mislabelling their interactive turn as completed, and waterfalls always delegate', async (t) => {
  const { listeners, records } = await fixture(t);
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'approval/asked', data: { id: 'approval-1', toolName: 'bash', turn: 2 } });
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  listeners.get('session/event')({ id: 'sub', header: { origin: 'subagent' } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => records().some((item) => item.mergeKey === 'approval:approval-1'));
  assert.equal(records().some((item) => item.mergeKey === 'approval:approval-1' && item.sessionId === 'session-1'), true);
  assert.equal(records().some((item) => item.mergeKey === 'turn:session-1:2'), false, 'an approval boundary is not a completed task');
  assert.equal(records().some((item) => item.sessionId === 'sub' && item.kind === 'completed'), false, 'a subagent turn is not the task finishing');
  let approvalNext = 0; let questionNext = 0;
  await listeners.get('approval/request')({}, async () => { approvalNext += 1; return 'approved'; });
  await listeners.get('user-questions/request')({ agent: { session: { id: 'session-1' } }, questions: [{ id: 'q', question: 'Continue?' }] }, async () => { questionNext += 1; return { answers: [] }; });
  const hostile = {}; Object.defineProperty(hostile, 'agent', { get() { throw new Error('hostile live payload'); } });
  await listeners.get('user-questions/request')(hostile, async () => { questionNext += 1; return { answers: [] }; });
  await settle();
  assert.equal(approvalNext, 1); assert.equal(questionNext, 2);
});

test('a live tool/call is the authoritative question source and closes on its own tool/result', async (t) => {
  const { listeners, records, runtime } = await fixture(t);
  const session = { id: 'question-session', header: {} };
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-1', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ header: '通道范围', question: '浏览器与主机通知要怎么处理？' }] }) } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:question-session:call-1'));
  const asked = records().find((record) => record.mergeKey === 'question:question-session:call-1');
  assert.equal(asked.kind, 'question'); assert.equal(asked.phase, 'open');
  assert.equal(asked.body, '通道范围：浏览器与主机通知要怎么处理？', 'the notification must say what is being asked, not just 需要回复');

  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-2', name: 'exit_plan_mode', arguments: '{}' } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:question-session:call-2'));
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-2').kind, 'plan-review');

  // DSH 0.1.7 flattened the result onto the tool-role message: `message.toolCallId` is the link.
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { toolCallId: 'call-2', isError: false } } });
  await waitUntil(() => records().find((record) => record.mergeKey === 'question:question-session:call-2').phase === 'settled');
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open', 'a reverse result must not close the other call');
  // An uncorrelated result can never close anything.
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'no call id here' }] } } });
  await settle();
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open');
  // A failed result settles as an abort.
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { toolCallId: 'call-1', isError: true } } });
  await waitUntil(() => records().find((record) => record.mergeKey === 'question:question-session:call-1').phase === 'expired');
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-1').outcome, 'abort');
  await runtime();
});

test('a pre-0.1.7 nested tool-result block still closes its interaction', async (t) => {
  const { listeners, records, runtime } = await fixture(t);
  const session = { id: 'legacy-result-session', header: {} };
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'legacy-1', name: 'ask_user_question', arguments: '{}' } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:legacy-result-session:legacy-1'));
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'legacy-1' }] } } });
  await waitUntil(() => records().find((record) => record.mergeKey === 'question:legacy-result-session:legacy-1').phase === 'settled');
  await runtime();
});

test('each unlinked waterfall yields its own record and settles only its own key', async (t) => {
  const { listeners, records, runtime } = await fixture(t); const waterfall = listeners.get('user-questions/request'); const session = { id: 'unscoped-session' }; const next = async () => ({ answers: [] });
  await waterfall({ agent: { session }, questions: [{ id: 'same', question: 'First delivered second?' }] }, next);
  await waterfall({ agent: { session }, questions: [{ id: 'plan', question: 'Approve?', intent: { kind: 'plan-review' } }] }, next);
  await waitUntil(() => records().filter((record) => record.kind === 'question' || record.kind === 'plan-review').length >= 2);
  const questions = records().filter((record) => record.kind === 'question' || record.kind === 'plan-review');
  assert.equal(questions.every((record) => record.mergeKey.includes(':unlinked:')), true, 'no FIFO guess may bind these');
  assert.equal(questions.some((record) => record.kind === 'plan-review'), true);
  await runtime();
});

test('a plan review is one card even when both the tool/call and the waterfall fire', async (t) => {
  const { listeners, records, runtime } = await fixture(t);
  const waterfall = listeners.get('user-questions/request');
  const session = { id: 'plan-session', header: {} };
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-plan', name: 'exit_plan_mode', arguments: '{}', turn: 4 } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:plan-session:call-plan'));
  const firstId = records().find((record) => record.mergeKey === 'question:plan-session:call-plan').eventId;

  let resolveAnswer;
  const pending = new Promise((resolve) => { resolveAnswer = resolve; });
  const done = waterfall({ agent: { session }, questions: [{ id: 'plan', question: 'Approve this plan and leave plan mode?', intent: { kind: 'plan-review' } }] }, () => pending);
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:plan-session:call-plan' && record.body.includes('Approve this plan')));
  const plans = records().filter((record) => record.kind === 'plan-review');
  assert.equal(plans.length, 1, 'the waterfall must not mint a second unlinked card');
  assert.equal(plans[0].eventId, firstId);
  assert.equal(plans[0].mergeKey, 'question:plan-session:call-plan');
  assert.equal(plans[0].title, '计划待审');
  assert.equal(plans[0].body, 'Approve this plan and leave plan mode?');
  assert.equal(plans[0].phase, 'open');

  resolveAnswer({ answers: [] });
  await done;
  await waitUntil(() => records().find((record) => record.mergeKey === 'question:plan-session:call-plan').phase !== 'open');
  assert.equal(records().filter((record) => record.kind === 'plan-review').length, 1);
  await runtime();
});

test('a live question is one card even when the waterfall arrives before the tool/call', async (t) => {
  const { listeners, records, runtime } = await fixture(t);
  const waterfall = listeners.get('user-questions/request');
  const session = { id: 'ask-session', header: {} };
  let resolveAnswer;
  const pending = new Promise((resolve) => { resolveAnswer = resolve; });
  const done = waterfall({ agent: { session }, questions: [{ id: 'q', header: '通道范围', question: '浏览器与主机通知要怎么处理？' }] }, () => pending);
  await waitUntil(() => records().some((record) => record.kind === 'question' && record.phase === 'open'));
  const first = records().find((record) => record.kind === 'question');
  assert.equal(first.mergeKey.includes(':unlinked:'), true);

  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-ask', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ header: '通道范围', question: '浏览器与主机通知要怎么处理？' }] }) } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:ask-session:call-ask'));
  const questions = records().filter((record) => record.kind === 'question');
  assert.equal(questions.length, 1, 'the late tool/call rekeys the unlinked card instead of stacking a second one');
  assert.equal(questions[0].eventId, first.eventId);
  assert.equal(questions[0].body, '通道范围：浏览器与主机通知要怎么处理？');

  resolveAnswer({ answers: [] });
  await done;
  await runtime();
});

test('/pull hands a page only what it has not seen, and the buffer is memory-only', async (t) => {
  const { routes, runtime, listeners } = await fixture(t);
  const pull = routes.get('exact:/plugins/dsh-notify/pull');

  const first = await invoke(pull, request({ path: '/plugins/dsh-notify/pull?since=0', headers: browserHeaders }));
  const empty = JSON.parse(first.body);
  assert.deepEqual(empty, { seq: 0, items: [] });
  assert.equal(runtime.buffer.size, 0, 'nothing is written until something happens');

  listeners.get('session/event')({ id: 's1', header: {} }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.size === 1);

  const seen = JSON.parse((await invoke(pull, request({ path: `/plugins/dsh-notify/pull?since=${empty.seq}`, headers: browserHeaders }))).body);
  assert.equal(seen.items.length, 1); assert.equal(seen.items[0].title, '任务完成'); assert.equal(seen.seq, 1);

  const caughtUp = JSON.parse((await invoke(pull, request({ path: `/plugins/dsh-notify/pull?since=${seen.seq}`, headers: browserHeaders }))).body);
  assert.deepEqual(caughtUp.items, [], 'a page that is current is told nothing twice');
  await runtime();
});

test('/config persists the user own preferences to the profile directory', async (t) => {
  const { routes, dir, runtime } = await fixture(t);
  const config = routes.get('exact:/plugins/dsh-notify/config');
  const initial = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(initial.storage.records, 'memory', 'records never persist, and the page is told so');
  assert.equal(initial.storage.preferences, 'file');
  assert.deepEqual({ sound: initial.sound, toastPosition: initial.toastPosition, notificationStyle: initial.notificationStyle, stackCollapsed: initial.stackCollapsed }, { sound: 'chime', toastPosition: 'conversation', notificationStyle: 'strong', stackCollapsed: true });

  const patched = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { sound: 'alert', toastPosition: 'viewport', notificationStyle: 'soft', stackCollapsed: false, subtaskNotify: true } }));
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'alert', toastPosition: 'viewport', notificationStyle: 'soft', stackCollapsed: false, subtaskNotify: true });

  const rejected = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { readRetentionDays: 7 } }));
  assert.equal(rejected.statusCode, 400, 'a setting that only served the deleted history list is not accepted');
  for (const invalid of [{ notificationStyle: 'loud' }, { notificationStyle: true }, { stackCollapsed: 'true' }, { stackCollapsed: null }]) assert.equal((await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: invalid }))).statusCode, 400, 'style choices are explicit and typed');
  const reloaded = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(reloaded.sound, 'alert');
  await runtime();
});

test('a restart forgets the notifications and keeps the preferences', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const build = async () => {
    const { listeners, register } = createListeners(); const routes = new Map();
    const ctx = { get(name) { return { webServer: { register(route) { routes.set(`${route.kind}:${route.path}`, route); return () => {}; } }, connection: { requestRejection: () => undefined }, jobs: undefined }[name]; }, on: register, effect(setup) { return setup(); }, emit() {} };
    return { listeners, routes, runtime: await apply(ctx, { dataDir: dir, completionGraceMs: 0 }) };
  };
  const first = await build();
  first.listeners.get('session/event')({ id: 's1', header: {} }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => first.runtime.buffer.size === 1);
  const config = first.routes.get('exact:/plugins/dsh-notify/config');
  await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { sound: 'ping' } }));

  const second = await build();
  assert.equal(second.runtime.buffer.size, 0, 'a page that was not connected when it happened never learns about it');
  assert.deepEqual(second.runtime.buffer.pull(), { seq: 0, items: [] });
  assert.equal(second.runtime.preferences.get().sound, 'ping', 'the users own choices survive');
});

test('raw routes are exact, check auth before business logic, and the history routes are gone', async (t) => {
  const { routes } = await fixture(t, (req) => (String(req.headers?.cookie ?? '') === 'sid=one' ? undefined : 401));
  assert.deepEqual([...routes.keys()].sort(), [
    'exact:/plugins/dsh-notify/config',
    'exact:/plugins/dsh-notify/health',
    'exact:/plugins/dsh-notify/pull',
    'exact:/plugins/dsh-notify/sound',
    'exact:/plugins/dsh-notify/sounds',
    'exact:/plugins/dsh-notify/sounds/delete',
  ], 'only the live transport, the preferences and the sound library remain');
  const pull = routes.get('exact:/plugins/dsh-notify/pull');
  assert.equal((await invoke(pull, request({ path: '/plugins/dsh-notify/pull', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' } }))).statusCode, 401);
  const config = routes.get('exact:/plugins/dsh-notify/config');
  assert.equal((await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: { ...browserHeaders, origin: 'http://evil.test' }, body: { sound: 'ping' } }))).statusCode, 403, 'a cross-site write is refused before it is parsed');
  assert.equal((await invoke(pull, request({ method: 'POST', path: '/plugins/dsh-notify/pull', headers: browserHeaders }))).statusCode, 405);
  const health = JSON.parse((await invoke(routes.get('exact:/plugins/dsh-notify/health'), request({ path: '/plugins/dsh-notify/health', headers: browserHeaders }))).body);
  assert.deepEqual(health.storage, { records: 'memory', preferences: 'file' });
  assert.equal(typeof health.buffered, 'number');
});

test('a job notification never turns a raw command line into its title', () => {
  assert.deepEqual(jobNotification({ status: 'completed', label: 'rm -rf / && echo done' }), { title: '后台任务结束', body: '已完成' });
  assert.deepEqual(jobNotification({ status: 'failed', label: 'build the docs' }), { title: '后台任务失败', body: 'build the docs' });
  assert.deepEqual(jobNotification({ status: 'completed' }), { title: '后台任务结束', body: '已完成' });
});

test('a finished turn is only announced once the session really stops', async (t) => {
  const { listeners, runtime } = await fixture(t, undefined, { completionGraceMs: 60 });
  const session = { id: 'graceful-session', header: {} };
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await settle();
  assert.equal(runtime.buffer.size, 0, 'the grace window holds the announcement');
  listeners.get('session/event')(session, { type: 'turn/start', data: { turn: 2 } });
  await waitUntil(() => true);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(runtime.buffer.size, 0, 'work resumed inside the window: that turn end was not the task finishing');

  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.size === 1);
  assert.equal(runtime.buffer.pull().items[0].mergeKey, 'turn:graceful-session:2');
  await runtime();
});

test('a lifecycle-capable host announces completion only after the native agent becomes idle', async (t) => {
  const { listeners, records, runtime } = await fixture(t, undefined, { completionGraceMs: 0 });
  const session = { id: 'native-idle-session', header: {} };
  const agent = { session };
  listeners.get('agent/status')({ agent, status: 'running' });
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await settle();
  assert.equal(records().some((record) => record.mergeKey === 'turn:native-idle-session:1'), false, 'a rendered final message is not notification-complete while the native spinner is still running');

  listeners.get('agent/status')({ agent, status: 'idle' });
  await waitUntil(() => records().some((record) => record.mergeKey === 'turn:native-idle-session:1'));
  assert.equal(records().filter((record) => record.mergeKey === 'turn:native-idle-session:1').length, 1, 'the idle transition emits exactly one completion record');

  listeners.get('agent/status')({ agent, status: 'running' });
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  listeners.get('agent/status')({ agent, status: 'running' });
  await settle();
  listeners.get('agent/status')({ agent, status: 'idle' });
  await waitUntil(() => records().some((record) => record.mergeKey === 'turn:native-idle-session:2'));
  assert.equal(records().filter((record) => record.mergeKey === 'turn:native-idle-session:2').length, 1, 'a later real idle still reports its own finished turn once');
  await runtime();
});

test('an interactive pause and its post-decision work yield one completion notification', async (t) => {
  const { listeners, records, runtime } = await fixture(t, undefined, { completionGraceMs: 0 });
  const session = { id: 'one-task-session', header: {} };
  const agent = { session };
  listeners.get('agent/status')({ agent, status: 'running' });
  listeners.get('session/event')(session, { type: 'tool/call', data: { turn: 10, callId: 'review-1', name: 'exit_plan_mode', arguments: '{}' } });
  listeners.get('session/event')(session, { type: 'tool/result', data: { turn: 10, message: { toolCallId: 'review-1', isError: false } } });
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 10, reason: { kind: 'completed' } } });
  listeners.get('agent/status')({ agent, status: 'idle' });
  await settle();
  assert.equal(records().some((record) => record.mergeKey === 'turn:one-task-session:10'), false, 'the plan-review pause is not a completed task');

  listeners.get('agent/status')({ agent, status: 'running' });
  listeners.get('session/event')(session, { type: 'turn/start', data: { turn: 11 } });
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 11, reason: { kind: 'completed' } } });
  listeners.get('agent/status')({ agent, status: 'idle' });
  await waitUntil(() => records().some((record) => record.mergeKey === 'turn:one-task-session:11'));
  assert.equal(records().filter((record) => record.kind === 'completed').length, 1, 'one user task gets one completed card despite its interactive pause');
  await runtime();
});

test('an answered ordinary question that directly ends work still announces one completion', async (t) => {
  const { listeners, records, runtime } = await fixture(t, undefined, { completionGraceMs: 0 });
  const session = { id: 'question-finishes-session', header: {} };
  const agent = { session };
  listeners.get('agent/status')({ agent, status: 'running' });
  listeners.get('session/event')(session, { type: 'tool/call', data: { turn: 12, callId: 'question-1', name: 'ask_user_question', arguments: '{}' } });
  listeners.get('session/event')(session, { type: 'tool/result', data: { turn: 12, message: { toolCallId: 'question-1', isError: false } } });
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 12, reason: { kind: 'completed' } } });
  listeners.get('agent/status')({ agent, status: 'idle' });
  await waitUntil(() => records().some((record) => record.mergeKey === 'turn:question-finishes-session:12'));
  assert.equal(records().filter((record) => record.kind === 'completed').length, 1, 'a directly settled user question must not erase the task completion notification');
  await runtime();
});

test('a turn that ends expires leftover open records so they cannot shadow later notifications', async (t) => {
  const { listeners, runtime } = await fixture(t);
  const session = { id: 'leftover-session', header: {} };
  listeners.get('session/event')(session, { type: 'approval/asked', data: { id: 'never-decided', toolName: 'bash' } });
  await waitUntil(() => runtime.buffer.size === 1);
  assert.equal(runtime.buffer.pull().items[0].phase, 'open');

  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.pull().items.some((record) => record.mergeKey === 'turn:leftover-session:3'));
  const records = runtime.buffer.pull().items;
  const approval = records.filter((record) => record.mergeKey === 'approval:never-decided').at(-1);
  assert.equal(approval.phase, 'expired', 'nothing can still be waiting on a turn that ended');
  assert.equal(records.filter((record) => record.mergeKey === 'approval:never-decided').length, 1, 'the expiry replaced the open copy instead of queueing a second notification');
  await runtime();
});

test('/config only adopts the settings this version has, whatever the file on disk holds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-legacy-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A profile that has been through the previous release: the wrapper plus a key that is gone.
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify({ version: 1, value: { sound: 'ping', toastPosition: 'viewport', readRetentionDays: 7 } }, null, 2)}\n`, 'utf8');
  const { routes, runtime } = await fixture(t, undefined, { dataDir: dir });
  const config = routes.get('exact:/plugins/dsh-notify/config');
  const loaded = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(loaded.sound, 'ping', 'the sound the user chose is the one that loads');
  assert.equal(loaded.toastPosition, 'viewport');
  assert.equal('readRetentionDays' in loaded, false, 'a setting this version does not have is not smuggled into the config');
  assert.equal('version' in loaded, false); assert.equal('value' in loaded, false);

  const patched = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { subtaskNotify: true } }));
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'ping', toastPosition: 'viewport', subtaskNotify: true }, 'the write is flat, drops the dead key and keeps the choices it did not touch');
  await runtime();
});

test('the job registry is reached through ctx.inject, and 0.1.7 is read through its event stream', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-jobs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const filters = [];
  // DSH 0.1.7: one lifecycle stream; the terminal event is `settled` and carries the JobView.
  const jobs = { events: { subscribe(filter, handler) { filters.push(filter); listeners.set('job/settled', handler); return () => listeners.delete('job/settled'); } } };
  const routes = new Map();
  // A real Cordis profile context: services are declared, not readable as plain properties.
  const ctx = {
    inject(names, callback) { if (names.includes('jobs')) callback({ jobs }); return () => {}; },
    get() { return undefined; },
    on(name, handler) { listeners.set(name, handler); return () => {}; },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0, webServer: undefined });
  assert.equal(runtime.diagnostics.services.jobs, 'events', 'the injected seam is the one that takes');
  assert.deepEqual(filters, [{ owners: 'all' }], 'a profile-level mount must observe every owner');

  const settled = (job, over = {}) => listeners.get('job/settled')({ type: 'settled', job, cause: 'producer', awaited: false, ...over });

  // Off by default: a background job finishing is not news.
  settled({ id: 'job-off', kind: 'bash', status: 'completed', label: 'pnpm build', owner: 's1' });
  await settle();
  assert.equal(runtime.buffer.size, 0, 'subtask noise stays off until the user asks for it');

  runtime.preferences.set({ subtaskNotify: true });
  settled({ id: 'job-1', kind: 'bash', status: 'completed', label: 'pnpm build', owner: 'session-1' });
  await waitUntil(() => runtime.buffer.size >= 1);
  const first = runtime.buffer.pull();
  const [record] = first.items;
  assert.equal(record.kind, 'job-end'); assert.equal(record.title, '后台任务结束'); assert.equal(record.body, 'pnpm build');
  assert.equal(record.sessionId, 'session-1', 'the notification knows which session the job belonged to');

  // A settlement that released a waiting caller was already handed to that caller, so it is not news.
  settled({ id: 'job-awaited', kind: 'bash', status: 'completed', label: 'pnpm test', owner: 'session-1' }, { awaited: true });
  await settle();
  assert.deepEqual(runtime.buffer.pull({ since: first.seq }).items, [], 'an awaited settlement must not raise a second card');

  // Only the terminal event is a notification: progress and registration are not.
  for (const type of ['registered', 'progress', 'stopping', 'removed', 'output']) listeners.get('job/settled')({ type, id: 'job-x', job: { id: 'job-x', status: 'running' } });
  await settle();
  assert.deepEqual(runtime.buffer.pull({ since: first.seq }).items, [], 'a non-settled job event never becomes a card');
  void routes;
});

test('a pre-0.1.7 registry still reports through onJobDone', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-jobs-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const jobs = { onJobDone(handler) { listeners.set('job/done', handler); return () => listeners.delete('job/done'); } };
  const ctx = {
    inject(names, callback) { if (names.includes('jobs')) callback({ jobs }); return () => {}; },
    get() { return undefined; },
    on() { return () => {}; },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0, webServer: undefined });
  assert.equal(runtime.diagnostics.services.jobs, 'onJobDone', 'the older listener is the fallback, not the primary');
  runtime.preferences.set({ subtaskNotify: true });
  listeners.get('job/done')({ id: 'job-legacy', status: 'completed', label: 'pnpm build', ownerSession: 's1' }, { session: { id: 's1' } });
  await waitUntil(() => runtime.buffer.size >= 1);
  assert.equal(runtime.buffer.pull().items[0].sessionId, 's1');
});

test('a composition with no job registry says so instead of failing silently', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-nojobs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ctx = { get() { return undefined; }, on() { return () => {}; }, effect(setup) { return setup(); }, emit() {} };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0 });
  assert.equal(runtime.diagnostics.services.jobs, 'unavailable', 'the report is how a silent seam becomes visible');
});

test('a plain test double still resolves the registry reflectively', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-reflect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const jobs = { events: { subscribe(_filter, handler) { listeners.set('job/settled', handler); return () => {}; } } };
  const ctx = { get(name) { return name === 'jobs' ? jobs : undefined; }, on() { return () => {}; }, effect(setup) { return setup(); }, emit() {} };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0 });
  assert.equal(runtime.diagnostics.services.jobs, 'reflected');
  runtime.preferences.set({ subtaskNotify: true });
  listeners.get('job/settled')({ type: 'settled', cause: 'producer', awaited: false, job: { id: 'job-2', kind: 'bash', status: 'failed', label: 'go test ./...', owner: 's2' } });
  await waitUntil(() => runtime.buffer.size >= 1);
  assert.equal(runtime.buffer.pull().items[0].kind, 'job-end');
  assert.equal(runtime.buffer.pull().items[0].title, '后台任务失败');
});

test('a finished workflow learns which session it belongs to, so its card can jump', async (t) => {
  const { listeners, runtime, records } = await fixture(t, undefined);
  runtime.preferences.set({ subtaskNotify: true });
  const end = async (id, name) => { listeners.get('workflow/end')({ id, meta: { name } }, { stopReason: 'completed' }); await settle(); };
  const record = (id) => records().find((item) => item.mergeKey === `wf:${id}`);

  // Nothing is known until the log says so. dsh-tool-workflow appends the run to its parent Session
  // before the run begins, and that append is the only place the owning session is written down — the
  // `workflow/end` payload itself is `{id, meta}` and carries no session at all.
  await end('wf-unowned', '无主运行');
  assert.equal(record('wf-unowned').sessionId, undefined, 'a run whose session was never recorded is not attributed to anything');

  listeners.get('session/event')({ id: 'session-42' }, { type: 'tool-workflow/run-start', data: { runId: 'wf-1', name: '审计' } });
  await end('wf-1', '审计');
  assert.equal(record('wf-1').sessionId, 'session-42', 'the card can jump to the session that ran the workflow');
  assert.equal(record('wf-1').title, '审计');

  // Two sessions running workflows at the same time keep their own runs.
  listeners.get('session/event')({ id: 'session-99' }, { type: 'tool-workflow/run-start', data: { runId: 'wf-2', name: '另一个' } });
  await end('wf-2', '另一个');
  assert.equal(record('wf-2').sessionId, 'session-99');

  // Every other session record is ignored: only the workflow's own run-start claims a run.
  listeners.get('session/event')({ id: 'session-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  listeners.get('session/event')({ id: 'session-1' }, { type: 'tool-workflow/agent-start', data: { runId: 'wf-3', seq: 1, label: 'x', childId: 'child-1' } });
  await end('wf-3', 'x');
  assert.equal(record('wf-3').sessionId, undefined, 'an agent-start is not a run-start');

  // The sub-agent records share the runId, so the last run-start for a run id is the one that counts.
  listeners.get('session/event')({ id: 'session-old' }, { type: 'tool-workflow/run-start', data: { runId: 'wf-4', name: 'old' } });
  listeners.get('session/event')({ id: 'session-new' }, { type: 'tool-workflow/run-start', data: { runId: 'wf-4', name: 'new' } });
  await end('wf-4', 'new');
  assert.equal(record('wf-4').sessionId, 'session-new');
});
