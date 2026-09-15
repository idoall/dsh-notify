import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, Config, createStore, jobNotification } from '../src/index.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(predicate) { for (let attempt = 0; attempt < 100; attempt += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('condition did not settle'); }
async function fixture(t, rejection, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const routes = new Map();
  const webServer = { register(route) { const key = `${route.kind}:${route.path}`; if (routes.has(key)) throw new Error(`duplicate ${key}`); routes.set(key, route); return () => routes.delete(key); } };
  const connection = { requestRejection: typeof rejection === 'function' ? rejection : () => rejection };
  const jobs = { onJobDone(handler) { listeners.set('job/done', handler); return () => listeners.delete('job/done'); } };
  const ctx = {
    get(name) { return { webServer, connection, jobs }[name]; },
    on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, pushAllowedSuffixes: [], webPush: { generateVAPIDKeys() { return { publicKey: 'p', privateKey: 's' }; }, sendNotification() { throw new Error('must not send'); } }, dnsLookup: async () => [], ...config });
  assert.equal(typeof runtime, 'function', 'Cordis async plugin must resolve to a disposer');
  return { dir, listeners, routes, runtime };
}
function request({ method = 'GET', path = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return { method, url: path, headers, resume() {}, async *[Symbol.asyncIterator]() { yield* chunks; } };
}
function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value = '') { this.body += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); } };
}
async function invoke(route, req) { const res = response(); await route.handler(req, res); return res; }




test('sound routes list, upload, serve and delete only allow-listed audio, behind auth', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-sounds-'));
  const { routes, runtime } = await fixture(t, undefined, { dataDir: dir });
  const headers = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one', 'content-type': 'application/json' };
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const sound = routes.get('exact:/plugins/dsh-notify/sound');
  const remove = routes.get('exact:/plugins/dsh-notify/sounds/delete');
  assert.ok(list && sound && remove, 'all three sound routes are exact objects');

  const empty = JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers }))).body);
  assert.deepEqual(empty.custom, []); assert.deepEqual(empty.builtins, ['chime', 'ping', 'alert', 'none']); assert.equal(empty.maxBytes, 1024 * 1024);

  const reject = async (name, bytes, status) => { const result = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...headers, 'x-sound-name': name }, body: bytes })); assert.equal(result.statusCode, status, `${name} -> ${status}`); };
  await reject('../evil.mp3', 'x', 400);
  await reject('note.txt', 'x', 400);
  await reject('ok.mp3', '', 400);
  await reject('ok.mp3', 'x'.repeat(1024 * 1024 + 1), 413);

  const upload = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...headers, 'x-sound-name': 'Ding.MP3' }, body: 'audio-bytes' }));
  assert.equal(upload.statusCode, 200); assert.deepEqual(JSON.parse(upload.body), { ok: true, name: 'Ding.mp3', bytes: 11 });

  const served = await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=Ding.mp3', headers }));
  assert.equal(served.statusCode, 200); assert.equal(served.headers['content-type'], 'audio/mpeg'); assert.equal(served.body, 'audio-bytes');
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=../etc/passwd', headers }))).statusCode, 404);
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=missing.mp3', headers }))).statusCode, 404);

  const listed = JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers }))).body);
  assert.deepEqual(listed.custom.map((entry) => entry.name), ['Ding.mp3']);

  const wrongConfirm = await invoke(remove, request({ method: 'POST', path: '/plugins/dsh-notify/sounds/delete', headers, body: { name: 'Ding.mp3' } }));
  assert.equal(wrongConfirm.statusCode, 400);
  const deleted = await invoke(remove, request({ method: 'POST', path: '/plugins/dsh-notify/sounds/delete', headers, body: { confirm: true, name: 'Ding.mp3' } }));
  assert.deepEqual(JSON.parse(deleted.body), { ok: true });
  assert.deepEqual(JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers }))).body).custom, []);
  await runtime();
});
test('the sound list degrades to empty when persistence is disabled', async (t) => {
  const { routes } = await fixture(t, undefined, { dataDir: 'relative/not/absolute' });
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const headers = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one' };
  const result = await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers }));
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.body).custom, []);
});

test('delete removes exactly the requested records, resets the cursor, and refuses abuse', async (t) => {
  const { listeners, routes, runtime } = await fixture(t);
  const session = { id: 'delete-session', header: {} };
  for (const turn of [1, 2, 3]) listeners.get('session/event')(session, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.store.getRecords().length === 3);
  const [first, second] = runtime.store.getRecords();
  const route = routes.get('exact:/plugins/dsh-notify/delete');
  assert.ok(route);
  const headers = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one', 'content-type': 'application/json' };
  const crossOrigin = await invoke(route, request({ method: 'POST', path: '/plugins/dsh-notify/delete', headers: { ...headers, origin: 'https://evil.example' }, body: { confirm: true, eventIds: [first.eventId] } }));
  assert.equal(crossOrigin.statusCode, 403); assert.equal(runtime.store.getRecords().length, 3, 'a cross-origin delete must not touch the store');
  for (const body of [{ eventIds: [first.eventId] }, { confirm: true, eventIds: [] }, { confirm: true, eventIds: ['ok', 7] }, { confirm: true, eventIds: [first.eventId], extra: true }]) {
    const rejected = await invoke(route, request({ method: 'POST', path: '/plugins/dsh-notify/delete', headers, body }));
    assert.equal(rejected.statusCode, 400, `rejected: ${JSON.stringify(body)}`);
  }
  assert.equal(runtime.store.getRecords().length, 3);
  const before = runtime.store.epoch;
  const result = await invoke(route, request({ method: 'POST', path: '/plugins/dsh-notify/delete', headers, body: { confirm: true, eventIds: [first.eventId, 'never-existed'] } }));
  assert.equal(result.statusCode, 200);
  const payload = JSON.parse(result.body);
  assert.equal(payload.ok, true); assert.equal(payload.reset, true); assert.equal(payload.removed, 1); assert.equal(payload.cursor, 0);
  assert.ok(payload.epoch > before, 'a partial delete is published as a new epoch so every client re-syncs');
  assert.deepEqual(payload.items.map((record) => record.eventId), [second.eventId, runtime.store.getRecords().at(-1).eventId].filter(Boolean).slice(0, 2));
  assert.equal(runtime.store.getRecords().some((record) => record.eventId === first.eventId), false);
  assert.equal(runtime.store.getRecords().length, 2);
});

test('the read-only store refuses deletes instead of pretending to succeed', async () => {
  const store = await createStore({ dataDir: 'profiles/web/data/dsh-notify' });
  assert.equal(store.enabled, false);
  const result = await store.deleteRecords(['e1']);
  assert.deepEqual({ removed: result.removed, items: result.items }, { removed: 0, items: [] });
});


test('Host declares no hard service injection and exports a DSH config schema', () => {
  assert.deepEqual(inject, []);
  assert.equal(typeof Config, 'function');
});

test('session/event uses session id and data, while approval and question waterfalls always delegate', async (t) => {
  const { listeners, runtime } = await fixture(t);
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'approval/asked', data: { id: 'approval-1', toolName: 'bash' } });
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  listeners.get('session/event')({ id: 'sub', header: { origin: 'subagent' } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.store.getRecords().length >= 2);
  const records = runtime.store.getRecords();
  assert.equal(records.some((item) => item.mergeKey === 'approval:approval-1' && item.sessionId === 'session-1'), true);
  assert.equal(records.some((item) => item.mergeKey === 'turn:session-1:2'), true);
  assert.equal(records.some((item) => item.sessionId === 'sub' && item.kind === 'completed'), false);
  let approvalNext = 0; let questionNext = 0;
  await listeners.get('approval/request')({}, async () => { approvalNext += 1; return 'approved'; });
  await listeners.get('user-questions/request')({ agent: { session: { id: 'session-1' } }, questions: [{ id: 'q', question: 'Continue?' }] }, async () => { questionNext += 1; return { answers: [] }; });
  const hostile = {}; Object.defineProperty(hostile, 'agent', { get() { throw new Error('hostile live payload'); } });
  await listeners.get('user-questions/request')(hostile, async () => { questionNext += 1; return { answers: [] }; });
  await settle();
  assert.equal(approvalNext, 1); assert.equal(questionNext, 2);
});

test('a live tool/call is the authoritative question source and closes on its own tool/result', async (t) => {
  const { listeners, runtime } = await fixture(t);
  const session = { id: 'question-session', header: {} };
  // dsh-user-questions emits the waterfall through scopeTarget(agent, agent), which a root-scope
  // profile plugin never sees, so the session stream is the only live signal it can rely on. The
  // event carries the real callId and the raw arguments, so binding here is not FIFO guessing.
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-1', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ header: '通道范围', question: '浏览器与主机通知要怎么处理？' }] }) } });
  await waitUntil(() => runtime.store.getRecords().some((record) => record.mergeKey === 'question:question-session:call-1'));
  const asked = runtime.store.getRecords().find((record) => record.mergeKey === 'question:question-session:call-1');
  assert.equal(asked.kind, 'question'); assert.equal(asked.phase, 'open'); assert.equal(asked.unread, true);
  assert.equal(asked.body, '通道范围：浏览器与主机通知要怎么处理？', 'the notification must say what is being asked, not just 需要回复');
  assert.equal(asked.body === '需要回复', false);

  // A second concurrent call keeps its own identity instead of FIFO-binding to the first.
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-2', name: 'exit_plan_mode', arguments: '{}' } });
  await waitUntil(() => runtime.store.getRecords().some((record) => record.mergeKey === 'question:question-session:call-2'));
  const plan = runtime.store.getRecords().find((record) => record.mergeKey === 'question:question-session:call-2');
  assert.equal(plan.kind, 'plan-review'); assert.equal(plan.phase, 'open');

  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-2' }] } } });
  await waitUntil(() => runtime.store.getRecords().find((record) => record.mergeKey === 'question:question-session:call-2').phase === 'settled');
  assert.equal(runtime.store.getRecords().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open', 'a reverse result must not close the other call');
  // An uncorrelated result can never close anything.
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result' }] } } });
  await settle();
  assert.equal(runtime.store.getRecords().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open');
  await runtime();
});

test('an unscoped waterfall still yields its own unlinked records', async (t) => {
  const { listeners, runtime } = await fixture(t); const waterfall = listeners.get('user-questions/request'); const session = { id: 'unscoped-session' }; const next = async () => ({ answers: [] });
  await waterfall({ agent: { session }, questions: [{ id: 'same', question: 'First delivered second?' }] }, next);
  await waterfall({ agent: { session }, questions: [{ id: 'plan', question: 'Approve?', intent: { kind: 'plan-review' } }] }, next);
  await waitUntil(() => runtime.store.getRecords().filter((record) => record.kind === 'question').length === 1);
  const records = runtime.store.getRecords();
  assert.equal(records.every((record) => record.mergeKey.includes(':unlinked:')), true);
  assert.equal(records.every((record) => record.phase === 'settled'), true);
  assert.equal(records.some((record) => record.kind === 'plan-review'), true);
  await runtime();
});

test('each unlinked waterfall settles only its own key, preserves return/error, and cleans abort races', async (t) => {
  const { listeners, runtime } = await fixture(t); const waterfall = listeners.get('user-questions/request'); const session = { id: 'waterfall-session' };
  const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const first = deferred(); const second = deferred(); let firstCalls = 0; let secondCalls = 0;
  const p1 = waterfall({ agent: { session }, questions: [{ id: 'same', question: 'first' }] }, () => { firstCalls += 1; return first.promise; });
  const p2 = waterfall({ agent: { session }, questions: [{ id: 'same', question: 'second' }] }, () => { secondCalls += 1; return second.promise; });
  await waitUntil(() => runtime.store.getRecords().filter((record) => record.kind === 'question').length === 2);
  const keys = Object.fromEntries(runtime.store.getRecords().filter((record) => record.kind === 'question').map((record) => [record.body, record.mergeKey])); assert.notEqual(keys.first, keys.second);
  const answer = { answers: [{ id: 'same', selected: ['yes'] }] }; second.resolve(answer); assert.equal(await p2, answer);
  await waitUntil(() => runtime.store.getRecords().find((record) => record.mergeKey === keys.second)?.phase === 'settled'); assert.equal(runtime.store.getRecords().find((record) => record.mergeKey === keys.first).phase, 'open');
  const original = Object.assign(new Error('delegate failed'), { code: 'DELEGATE_FAILED' }); first.reject(original); await assert.rejects(p1, (error) => error === original);
  await waitUntil(() => runtime.store.getRecords().find((record) => record.mergeKey === keys.first)?.phase === 'expired'); assert.equal(firstCalls, 1); assert.equal(secondCalls, 1);
  class CountedSignal extends EventTarget { added = 0; removed = 0; addEventListener(...args) { this.added += 1; return super.addEventListener(...args); } removeEventListener(...args) { this.removed += 1; return super.removeEventListener(...args); } }
  const signal = new CountedSignal(); Object.defineProperty(signal, 'aborted', { value: false, writable: true }); const pending = deferred(); let abortCalls = 0;
  const aborted = waterfall({ agent: { session }, signal, questions: [{ id: 'abort', question: 'abort me' }] }, () => { abortCalls += 1; return pending.promise; });
  await waitUntil(() => runtime.store.getRecords().some((record) => record.body === 'abort me'));
  signal.aborted = true; signal.dispatchEvent(new Event('abort')); pending.resolve(answer); assert.equal(await aborted, answer);
  await waitUntil(() => runtime.store.getRecords().find((record) => record.body === 'abort me')?.phase === 'expired'); assert.equal(runtime.store.getRecords().find((record) => record.body === 'abort me').outcome, 'abort'); assert.equal(abortCalls, 1); assert.equal(signal.added, 1); assert.equal(signal.removed, 1);
});

test('authoritative approval ids remain distinct, non-terminal turn reasons are silent, and real job/workflow shapes dispatch', async (t) => {
  const { listeners, runtime } = await fixture(t, undefined, { });
  const session = { id: 'session-2', header: {} };
  listeners.get('session/event')(session, { type: 'approval/asked', data: { id: 'a-1' } });
  listeners.get('session/event')(session, { type: 'approval/asked', data: { id: 'a-2' } });
  listeners.get('session/event')(session, { type: 'approval/decided', data: { id: 'a-1', outcome: 'cancelled' } });
  for (const kind of ['blocked', 'aborted', 'max-tokens', 'interrupted']) listeners.get('session/event')(session, { type: 'turn/end', data: { turn: kind, reason: { kind } } });
  assert.equal(runtime.store.getRecords().some((record) => record.kind === 'job-end' || record.kind === 'workflow-end'), false, 'subtask completions are opt-in');
  await runtime.store.setSettings({ subtaskNotify: true });
  listeners.get('job/done')({ id: 'job-1', label: 'Compile', status: 'completed' }, { session: { id: 'session-2' } });
  listeners.get('workflow/end')({ id: 'wf-1', meta: { name: 'Release checks' } }, { stopReason: 'completed' });
  await waitUntil(() => runtime.store.getRecords().length >= 4);
  const records = runtime.store.getRecords();
  assert.equal(records.filter((record) => record.kind === 'approval').length, 2);
  assert.equal(records.find((record) => record.mergeKey === 'approval:a-1').phase, 'expired');
  assert.equal(records.some((record) => String(record.mergeKey).startsWith('turn:session-2')), false);
  assert.equal(records.some((record) => record.mergeKey === 'job:job-1'), true);
  const job = records.find((record) => record.mergeKey === 'job:job-1');
  assert.equal(job.title, '后台任务结束'); assert.equal(job.body, 'Compile');
  assert.equal(records.some((record) => record.mergeKey === 'wf:wf-1'), true);
});

test('session recovery scans unresolved interactive tools without re-submitting external channels', async (t) => {
  const { listeners, runtime } = await fixture(t);
  listeners.get('session/created')({ id: 'recovered', snapshotEvents: () => [
    { type: 'approval/asked', data: { id: 'approval-old' } },
    { type: 'tool/call', data: { callId: 'answered', name: 'ask_user_question' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'answered' }] } } },
    { type: 'tool/call', data: { callId: 'open-plan', name: 'exit_plan_mode' } },
  ] });
  await waitUntil(() => runtime.store.getRecords().length >= 2);
  const records = runtime.store.getRecords();
  assert.equal(records.some((record) => record.mergeKey === 'approval:approval-old'), true);
  assert.equal(records.some((record) => record.mergeKey === 'question:recovered:answered'), false);
  assert.equal(records.some((record) => record.mergeKey === 'question:recovered:open-plan' && record.kind === 'plan-review'), true);
});

test('raw routes are exact objects and preserve 401/403 before business logic', async (t) => {
  let rejected = 401;
  const { routes } = await fixture(t, () => rejected);
  assert.equal([...routes.values()].every((route) => route.kind === 'exact' && typeof route.handler === 'function'), true);
  assert.equal(routes.has('exact:/plugins/dsh-notify/pull'), true);
  const pull = routes.get('exact:/plugins/dsh-notify/pull');
  const unauth = await invoke(pull, request({ path: '/plugins/dsh-notify/pull' }));
  assert.equal(unauth.statusCode, 401);
  rejected = 403;
  assert.equal((await invoke(pull, request({ path: '/plugins/dsh-notify/pull' }))).statusCode, 403);
  rejected = undefined;
  const open = routes.get('exact:/plugins/dsh-notify/open');
  const redirect = await invoke(open, request({ path: '/plugins/dsh-notify/open?sessionId=session-1' }));
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, '/?sessionId=session-1');
  const hostile = await invoke(open, request({ path: '/plugins/dsh-notify/open?sessionId=https%3A%2F%2Fevil.example%2F%3Ftoken%3Dsecret' }));
  assert.equal(hostile.headers.location, '/');
});

test('Node HTTP JSON routes enforce auth, CSRF, body schema and persist config/ack', async (t) => {
  const { routes, runtime } = await fixture(t);
  const config = routes.get('exact:/plugins/dsh-notify/config');
  const badOrigin = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: { origin: 'https://evil.example', host: 'dsh.example', 'content-type': 'application/json' }, body: {} }));
  assert.equal(badOrigin.statusCode, 403);
  const invalid = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: { origin: 'https://dsh.example', host: 'dsh.example', 'content-type': 'application/json' }, body: { unexpected: true } }));
  assert.equal(invalid.statusCode, 400);
  const saved = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: { origin: 'https://dsh.example', host: 'dsh.example', 'content-type': 'application/json' }, body: { verbosity: 'detailed', subtaskNotify: true } }));
  assert.equal(saved.statusCode, 200);
  assert.equal(runtime.store.getSettings().subtaskNotify, true);
  assert.equal(runtime.store.getSettings().verbosity, 'detailed');
  const method = await invoke(config, request({ method: 'DELETE', path: '/plugins/dsh-notify/config' }));
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'GET, POST');
});

test('clear requires auth, same-origin explicit confirmation and rate limit while preserving configuration', async (t) => {
  let rejected;
  const { routes, runtime } = await fixture(t, () => rejected);
  await runtime.store.setSettings({ verbosity: 'normal', toastEnabled: true });
  await runtime.store.putRecord({ eventId: 'event-clear', mergeKey: 'turn:clear:1', kind: 'completed', title: 'done', body: '', at: 1, unread: true, phase: 'settled' });
  const oldEpoch = runtime.store.epoch; const route = routes.get('exact:/plugins/dsh-notify/clear');
  const headers = { origin: 'https://dsh.example', host: 'dsh.example', cookie: 'sid=clear', 'content-type': 'application/json' };
  rejected = 401; assert.equal((await invoke(route, request({ method: 'POST', headers, body: { confirm: true } }))).statusCode, 401); assert.equal(runtime.store.getRecords().length, 1);
  rejected = undefined;
  assert.equal((await invoke(route, request({ method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: { confirm: true } }))).statusCode, 403);
  assert.equal((await invoke(route, request({ method: 'POST', headers: { ...headers, 'content-length': '1025' }, body: { confirm: true } }))).statusCode, 413);
  for (const body of [{}, { confirm: false }, { confirm: true, extra: true }]) { const result = await invoke(route, request({ method: 'POST', headers, body })); assert.equal(result.statusCode, 400); }
  const cleared = await invoke(route, request({ method: 'POST', headers, body: { confirm: true } })); assert.equal(cleared.statusCode, 200);
  assert.deepEqual(JSON.parse(cleared.body), { ok: true, epoch: oldEpoch + 1, cursor: 0, reset: true, items: [] });
  assert.deepEqual(runtime.store.getRecords(), []); assert.equal(runtime.store.getSettings().toastEnabled, true);
  const pull = runtime.store.pull({ epoch: oldEpoch, cursor: 1 }); assert.equal(pull.reset, true); assert.deepEqual(pull.items, []);
  await runtime();

});

test('records stay identical across a restart, an isolated epoch after clear, and a settings recovery', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-epoch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { dataDir: dir };
  const first = await fixture(t, undefined, options);
  const session = { id: 'epoch-session', header: {} }; const completed = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };
  first.listeners.get('session/event')(session, completed);
  await waitUntil(() => first.runtime.store.getRecords().length === 1);
  const originalId = first.runtime.store.getRecords()[0].eventId;

  // A restart must not duplicate the turn or mint a new identity for it.
  const restarted = await fixture(t, undefined, options);
  restarted.listeners.get('session/event')(session, completed); await settle();
  assert.equal(restarted.runtime.store.getRecords().length, 1, 'the same turn must not be recorded twice');
  assert.equal(restarted.runtime.store.getRecords()[0].eventId, originalId);

  // Clearing starts an isolated epoch, so the same turn is a new record afterwards.
  const clear = restarted.routes.get('exact:/plugins/dsh-notify/clear');
  const headers = { origin: 'https://dsh.example', host: 'dsh.example', cookie: 'sid=epoch', 'content-type': 'application/json' };
  assert.equal((await invoke(clear, request({ method: 'POST', headers, body: { confirm: true } }))).statusCode, 200);
  restarted.listeners.get('session/event')(session, completed);
  await waitUntil(() => restarted.runtime.store.getRecords().length === 1);
  const afterClearId = restarted.runtime.store.getRecords()[0].eventId;
  assert.notEqual(afterClearId, originalId, 'a cleared epoch is isolated');

  await writeFile(join(dir, 'settings.json'), '{broken', 'utf8');
  const recovered = await fixture(t, undefined, options);
  assert.equal(recovered.runtime.store.status.persist, 'recovered');
  await recovered.runtime.store.setSettings({ verbosity: 'normal', toastEnabled: true });
  recovered.listeners.get('session/event')(session, completed); await settle();
  assert.equal(recovered.runtime.store.getRecords().length, 1);
  assert.equal(recovered.runtime.store.getRecords()[0].eventId, afterClearId, 'recovery keeps delivered identities stable');
  await recovered.runtime(); await restarted.runtime();
});
test('strict self-test closes the legacy route, isolates A, cleans its target only and replays idempotently', async (t) => {
  const { routes, runtime } = await fixture(t);
  const route = routes.get('exact:/plugins/dsh-notify/self-test');
  const headers = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one', 'content-type': 'application/json' };
  assert.equal((await invoke(routes.get('exact:/plugins/dsh-notify/test'), request({ method: 'POST', headers, body: {} }))).statusCode, 410);
  for (const body of [{ dimension: 'a-history', confirm: true }, { dimension: 'c', confirm: true }, { dimension: 'd', confirm: true, recipientId: 'recipient-x', recipientBindingNonce: 'binding-y' }, { dimension: 'a-history', confirm: false, testRunId: 'self-test:a-history:12345678' }, { dimension: 'a-history', confirm: true, testRunId: 'self-test:a-history:12345678', extra: true }]) {
    assert.equal((await invoke(route, request({ method: 'POST', headers, body }))).statusCode, 400, JSON.stringify(body));
  }
  const body = { dimension: 'a-history', confirm: true, testRunId: 'self-test:a-history:enabled12345' };
  const first = await invoke(route, request({ method: 'POST', headers, body }));
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).status, 'passed');
  const replay = await invoke(route, request({ method: 'POST', headers, body }));
  assert.deepEqual(JSON.parse(replay.body), JSON.parse(first.body), 'a finished run replays its stored result');
  const cleanup = routes.get('exact:/plugins/dsh-notify/self-test/cleanup');
  const cleaned = await invoke(cleanup, request({ method: 'POST', headers, body: { confirm: true, testRunId: body.testRunId } }));
  assert.equal(cleaned.statusCode, 200);
  assert.equal(runtime.store.getRecords().some((record) => record.testRunId === body.testRunId), false);
  await runtime();
});
test('missing dataDir keeps Host loaded but disables persistence and authenticated GUI routes need both services', async () => {
  for (const services of [{}, { webServer: { register() { throw new Error('must not register'); } } }, { connection: { requestRejection() {} } }]) {
    const listeners = new Map(); const ctx = { on(name, handler) { listeners.set(name, handler); }, get(name) { return services[name]; }, emit() {} };
    const runtime = await apply(ctx, {});
    assert.equal(runtime.store.status.persist, 'disabled');
    assert.equal(runtime.guiAvailable, false);
    assert.match(runtime.reason, /authenticated web routes unavailable/);
  }
});

test('a job notification never turns a raw command line into its title', () => {
  const command = 'mkdir -p /tmp/x && date -u +"START %Y-%m-%dT%H:%M:%SZ" && python3 /tmp/x/poll.py';
  assert.deepEqual(jobNotification({ label: command, status: 'completed' }), { title: '后台任务结束', body: '已完成' });
  assert.deepEqual(jobNotification({ label: 'Compile', status: 'completed' }), { title: '后台任务结束', body: 'Compile' });
  assert.deepEqual(jobNotification({ label: 'Compile', status: 'error' }), { title: '后台任务失败', body: 'Compile' });
  assert.equal(jobNotification({ status: 'aborted' }).body, '已中止');
  assert.deepEqual(jobNotification({ label: 'x'.repeat(80), status: 'completed' }).body, '已完成');
  assert.deepEqual(jobNotification({ status: 'completed' }), { title: '后台任务结束', body: '已完成' });
  assert.deepEqual(jobNotification({}), { title: '后台任务结束', body: undefined });
  assert.equal(jobNotification({ label: 'a; rm -rf /', status: 'completed' }).body, '已完成');
  assert.equal(jobNotification({ label: 'echo `id`', status: 'completed' }).body, '已完成');
});

test('a turn that ends expires leftover open records so they cannot shadow later notifications', async () => {
  const { EventReducer } = await import('../src/core.js');
  const reducer = new EventReducer(() => 1000);
  const open = reducer.approvalAsked({ id: 'approval-1', toolName: 'Bash', reason: '需要写入', turn: 4 }, 'session-a');
  assert.equal(open.turn, 4, 'the record remembers its turn');
  const other = reducer.approvalAsked({ id: 'approval-2', toolName: 'Bash', turn: 4 }, 'session-b');
  assert.equal(open.phase, 'open');
  // A restart only knows which turns already ended: a question asked during a turn that has not
  // ended must survive, or a live question would be closed by the rebuild itself.
  assert.deepEqual(reducer.expireOpenForSession('session-a', 3), [], 'an approval from a later turn is not expired');
  const expired = reducer.expireOpenForSession('session-a');
  assert.deepEqual(expired.map((record) => record.eventId), [open.eventId]);
  assert.equal(open.phase, 'expired'); assert.equal(open.outcome, 'expired');
  assert.equal(other.phase, 'open', 'another session is untouched');
  assert.deepEqual(reducer.expireOpenForSession('session-a'), [], 'expiring twice is a no-op');
  const settled = reducer.approvalDecided('approval-1', 'approved');
  assert.equal(settled, open); assert.equal(settled.phase, 'settled', 'a late decision still wins');
});

test('a stuck write can never wedge the host: our scans and waterfalls are bounded', async (t) => {
  const listeners = new Map();
  const ctx = { get: () => undefined, on: (name, handler) => { listeners.set(name, handler); return () => {}; }, effect: (fn) => fn?.(), emit() {} };
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-bounded-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runtime = await apply(ctx, { dataDir: dir });
  // Poison every write, then make sure the session scan still returns instead of hanging forever.
  const store = runtime.store;
  const original = store.putRecord.bind(store);
  store.putRecord = () => new Promise(() => {});
  const scan = listeners.get('session/created');
  assert.equal(typeof scan, 'function');
  const started = Date.now();
  const result = await Promise.race([
    Promise.resolve(scan({ id: 'session-stuck', snapshotEvents: () => [{ type: 'approval/asked', data: { id: 'a1', turn: 1 } }] })),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 3000)),
  ]);
  assert.notEqual(result, 'hung', 'the listener returned even though every write was stuck');
  assert.ok(Date.now() - started < 3000);
  store.putRecord = original;
  await runtime();
});

test('/settle ends the pending state that the badge counts, and never touches a settled record', async (t) => {
  const { routes, runtime } = await fixture(t);
  const route = routes.get('exact:/plugins/dsh-notify/settle');
  assert.ok(route, 'the settle route exists');
  const headers = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=settle', 'content-type': 'application/json' };
  const asked = await runtime.reducer.approvalAsked({ id: 'approval-settle', toolName: 'Bash', reason: '需要写入', turn: 3 }, 'session-settle');
  await runtime.store.putRecord(asked);

  assert.equal((await invoke(route, request({ method: 'POST', headers, body: { eventId: 'nope', extra: 1 } }))).statusCode, 400, 'unknown fields are rejected');
  const first = await invoke(route, request({ method: 'POST', headers, body: { eventId: asked.eventId } }));
  assert.equal(first.statusCode, 200); assert.equal(JSON.parse(first.body).ok, true); assert.equal(JSON.parse(first.body).phase, 'settled');
  assert.equal(runtime.store.getRecords().find((record) => record.eventId === asked.eventId).phase, 'settled');
  const again = await invoke(route, request({ method: 'POST', headers, body: { eventId: asked.eventId } }));
  assert.equal(JSON.parse(again.body).ok, false, 'settling twice is a no-op, not an error');
  assert.equal(runtime.store.getRecords().find((record) => record.eventId === asked.eventId).phase, 'settled');
});
