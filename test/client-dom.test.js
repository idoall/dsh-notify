import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient, NotificationSelfTests, publishLocalSelfTest, setToastConfig, toastAnchor } from '../src/client.js';

function response(value) { return { ok: true, json: async () => value }; }






test('a new toast asks for the configured sound, and prefers a custom upload when one is chosen', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let pulls = 0; let releaseLive = false;
  const started = []; const audioSrc = [];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    AudioContext: class { state = 'running'; currentTime = 0; destination = {}; createOscillator() { const node = { type: '', frequency: { value: 0 }, connect() {}, start() { started.push(node.frequency.value); }, stop() {} }; return node; } createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } },
    Audio: class { constructor(src) { this.src = src; audioSrc.push(src); } addEventListener() {} play() { return Promise.resolve(); } pause() {} },
    fetch: async (url) => {
      if (String(url).includes('/pull?')) {
        const prime = { eventId: 'prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
        const live = { eventId: 'live', mergeKey: 'turn:live', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新事件', at: 2, unread: true, phase: 'settled' };
        pulls += 1;
        // The store may pull more than once while mounting; every mount pull stays a silent reset.
        return response(releaseLive ? { reset: false, epoch: 1, cursor: 2, items: [prime, live] } : { reset: true, epoch: 1, cursor: 1, items: [prime] });
      }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); setToastConfig({ sound: 'chime', soundEnabled: true }); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  // jsdom reports hidden=true by default, which is exactly the condition the hidden-mute rule checks.
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, getUiSession: () => undefined });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  setToastConfig({ sound: 'chime', soundEnabled: true });
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });   // mount pulls are resets and prime silently
  assert.deepEqual(started, [], 'the priming record must not beep');
  releaseLive = true;
  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.ok(document.querySelector('aside.dsh-notify-toast'), 'the live record is toasted');
  assert.deepEqual(started, [880, 1318.5], 'a live toast plays the configured built-in cue');

  setToastConfig({ sound: 'custom:ding.mp3' });
  await act(async () => { publishLocalSelfTest({ eventId: 'local-1', localOnly: true, kind: 'completed', title: '任务完成', body: '自定义音' }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.deepEqual(audioSrc, ['/plugins/dsh-notify/sound?name=ding.mp3'], 'a custom choice plays the uploaded file');
});

test('a question toast closes itself when the answer happens elsewhere', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer;
  const listeners = new Set(); let pendingMap = new Map();
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = next; for (const listener of listeners) listener(); };
  const calls = [];
  const earlier = { eventId: 'turn:prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
  const question = (callId, phase) => ({ eventId: `question:s1:${callId}`, mergeKey: `question:s1:${callId}`, kind: 'question', sessionId: 's1', title: '需要回复', body: '要不要继续？', at: 2, unread: true, phase });
  // A realistic host: the cursor only advances when the record set actually changes.
  let record = question('call-1', 'open'); let cursor = 1;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    // The store re-registers its poller whenever the cursor moves, so keep the latest callback and make
    // the page visible so the attention indicator never registers one of its own.
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url, init) => {
      if (String(url).includes('/pull?')) return response(cursor === 1 ? { reset: true, epoch: 1, cursor, items: [earlier] } : { reset: false, epoch: 1, cursor, items: [earlier, record] });
      if (String(url).includes('/ack')) { calls.push(`ack:${JSON.parse(init.body).eventId}`); return response({ ok: true }); }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => {
    const open = document.querySelector('aside[role="status"] button[aria-label="关闭通知"]');
    if (open) { await act(async () => { open.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); }
    if (root) await act(async () => { root.unmount(); });
    mounted?.destroy();
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  });
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  const sessions = { binding: () => ({}), open: () => true, list: { getSnapshot: () => ({ current: 's1', byId: { s1: { id: 's1' } } }) } };
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ pendingInteractions: observable }) });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); }); };
  const toastNode = () => document.querySelector('aside[role="status"]');
  const answerCount = () => toastNode()?.querySelectorAll('.dsh-notify-toast-answer').length ?? 0;
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await settle();

  cursor = 2;   // the host now reports the open question
  await act(async () => { await pullTimer(); }); await settle();
  assert.ok(toastNode(), 'the question is toasted');
  assert.equal(answerCount(), 1, 'without a pending interaction only the session link is offered');

  // The official composer holds the question and the user answers it there: the toast must follow.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q1', options: [{ label: '继续' }] }], answer: async () => {} }]])); });
  assert.equal(answerCount(), 2, 'answering from the toast is offered while it is pending');
  await act(async () => { publish(new Map()); }); await settle();
  assert.equal(toastNode(), null, 'an answer given in the composer closes the toast');
  assert.deepEqual(calls.filter((call) => call.startsWith('ack:')), ['ack:question:s1:call-1'], 'and it stops counting as unread, because it was handled');

});



test('an unanswered record never starves later toasts, and every record is toasted at most once', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer; let release = false;
  // The exact shape that used to break: one 3-hour-old approval left open by a missed decision event.
  const staleApproval = { eventId: 'approval-stale', mergeKey: 'approval:old', kind: 'approval', sessionId: 's1', title: '需要审批', body: '旧审批', at: 1, unread: false, phase: 'open' };
  const completion = { eventId: 'completion-new', mergeKey: 'turn:s1:9', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新完成', at: 9, unread: true, phase: 'settled' };
  let items = [staleApproval];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => String(url).includes('/pull?') ? response({ reset: release ? false : true, epoch: 1, cursor: 1, items }) : response({}),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });

  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, getUiSession: () => undefined });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.equal(document.querySelector('aside.dsh-notify-toast'), null, 'history never toasts on load, even when it contains an open record');

  release = true; items = [completion, staleApproval];
  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const toast = document.querySelector('aside.dsh-notify-toast');
  assert.ok(toast, 'a completion still toasts while an unrelated record is left open');
  assert.match(toast.textContent, /任务完成/);

  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.match(document.querySelector('aside.dsh-notify-toast').textContent, /任务完成/, 'the same record is not re-toasted by a later poll');
});

test('the history panel splits unread from read, deletes a selection, and clears everything', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let initial = true;
  const calls = []; let records = [];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url, init) => {
      if (String(url).includes('/pull?')) { if (initial) { initial = false; return response({ reset: true, epoch: 1, cursor: 0, items: [] }); } return response({ reset: false, epoch: 1, cursor: 4, items: records }); }
      if (String(url).includes('/delete')) { const body = JSON.parse(init.body); calls.push(['delete', body.eventIds]); const drop = new Set(body.eventIds); records = records.filter((record) => !drop.has(record.eventId)); return response({ ok: true, reset: true, epoch: 2, cursor: 0, removed: body.eventIds.length, requested: body.eventIds.length, items: records }); }
      if (String(url).includes('/clear')) { calls.push(['clear']); records = []; return response({ ok: true, reset: true, epoch: 3, cursor: 0, items: [] }); }
      if (String(url).includes('/ack')) { const id = JSON.parse(init.body).eventId; calls.push(['ack', id]); records = records.map((record) => record.eventId === id ? { ...record, unread: false } : record); return response({ ok: true }); }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions: { binding: () => ({}), open: () => true, list: { getSnapshot: () => ({ current: 's1' }) } } });
  root = createRoot(document.getElementById('root'));
  const Bell = components.get('sidebar.footer.action');
  await act(async () => { root.render(React.createElement(Bell, { ...components.get('sidebar.footer.action:props'), wide: true })); });
  records = [
    { eventId: 'e1', mergeKey: 'turn:1', kind: 'completed', sessionId: 's1', title: '任务完成', body: '第一条', at: Date.now() - 120000, unread: true, phase: 'settled' },
    { eventId: 'e2', mergeKey: 'turn:2', kind: 'completed', sessionId: 's1', title: '任务完成', body: '第二条', at: Date.now() - 60000, unread: true, phase: 'settled' },
    { eventId: 'e3', mergeKey: 'turn:3', kind: 'completed', sessionId: 's1', title: '任务完成', body: '第三条', at: Date.now(), unread: false, phase: 'settled' },
  ];
  await act(async () => { await pullTimer(); });
  const bell = document.querySelector('button[aria-label^="通知"]');
  await act(async () => { bell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const panel = () => document.querySelector('section[aria-label="通知历史"]');
  const buttonIn = (text) => [...panel().querySelectorAll('button')].find((node) => node.textContent.includes(text));
  const rows = () => [...panel().querySelectorAll('.dsh-notify-history-row')];
  const tab = (name) => [...panel().querySelectorAll('[role="tab"]')].find((node) => node.textContent.startsWith(name));

  assert.match(panel().textContent, /未读 2/); assert.match(panel().textContent, /已读 1/);
  assert.equal(rows().length, 2, 'the unread tab shows only unread records');
  await act(async () => { rows()[0].querySelector('.dsh-notify-history-open').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, [['ack', 'e2']], 'clicking a row outside selection mode acknowledges its record');
  // It must fade in place instead of jumping out of the list the user is reading.
  assert.equal(rows().length, 2, 'the confirmed row stays where it was until the next fetch');
  assert.equal(rows()[0].getAttribute('data-read'), 'true', 'and it now reads as read: 二级边框 + 二级字色');
  assert.equal(rows()[1].getAttribute('data-read'), 'false', 'the untouched row keeps the strong unread border');
  await act(async () => { await pullTimer(); });   // a background poll must not re-order the list
  await act(async () => { await pullTimer(); });
  assert.equal(rows().length, 2, 'even after several polls the confirmed row stays put until the user reopens the list');
  // Reopening is the moment the list is allowed to regroup.
  await act(async () => { panel().querySelector('button[aria-label="关闭通知历史"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { document.querySelector('button[aria-label^="通知"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(rows().length, 1, 'reopening the panel is when the confirmed row leaves 未读');
  await act(async () => { tab('已读').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(rows().length, 2, 'and it is now listed under 已读'); assert.match(panel().textContent, /第三条/);

  await act(async () => { tab('未读').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(rows().length, 1, 'only the still-unread record remains here');
  assert.equal(panel().querySelectorAll('input[type="checkbox"]').length, 0, 'no checkboxes until the user asks to select');
  assert.equal(buttonIn('全部删除'), undefined, 'the destructive action is not the default one');
  assert.equal(buttonIn('删除选中'), undefined);
  assert.ok(buttonIn('选择…'));
  await act(async () => { buttonIn('选择…').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const boxes = () => [...panel().querySelectorAll('input[type="checkbox"]')];
  assert.equal(buttonIn('删除选中').disabled, true, 'nothing selected means nothing to delete');
  await act(async () => { boxes()[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(buttonIn('删除选中（1）').disabled, false);
  await act(async () => { buttonIn('删除选中（1）').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(panel().textContent, /将删除选中的 1 条通知/);
  await act(async () => { buttonIn('确认删除').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const deletes = calls.filter((call) => call[0] === 'delete');
  assert.equal(deletes.length, 1); assert.deepEqual(deletes[0][1], ['e1'], 'exactly the checked record is deleted by eventId');
  assert.match(panel().textContent, /已删除 1 条通知/);
  assert.equal(rows().length, 0, 'the surviving (read) record is not shown under 未读');

  await act(async () => { buttonIn('全部删除').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(panel().textContent, /将清空 Host 上的全部通知历史/);
  await act(async () => { buttonIn('确认清空').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls.at(-1), ['clear']);
  assert.match(panel().textContent, /通知历史已清空/);
  assert.equal(document.querySelector('aside[role="status"]'), null, 'a reset must not re-toast a surviving record');
});

test('a pending question can be answered straight from the toast and stays in sync with the composer', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let initial = true; let pulls = 0;
  const answered = []; const calls = [];
  const listeners = new Set();
  let pendingMap = new Map();
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = next; for (const listener of listeners) listener(); };
  const earlier = { eventId: 'turn:prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
  const questionRecord = { eventId: 'question:s1:call-1', mergeKey: 'question:s1:call-1', kind: 'question', sessionId: 's1', title: '需要回复', body: '通道范围：要怎么处理？', at: 2, unread: true, phase: 'open' };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => {
      if (String(url).includes('/pull?')) { if (initial) { initial = false; return response({ reset: true, epoch: 1, cursor: 0, items: [] }); } pulls += 1; return response({ reset: false, epoch: 1, cursor: 9, items: pulls === 1 ? [earlier] : [earlier, questionRecord] }); }
      if (String(url).includes('/ack')) { calls.push('ack'); return response({ ok: true }); }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  const sessions = { binding: () => ({}), open: (id) => { calls.push(`open:${id}`); return true; }, list: { getSnapshot: () => ({ current: 's1', ids: ['s1'], byId: { s1: { id: 's1', displayTitle: '通知插件改造' } } }) } };
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ pendingInteractions: observable }) });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay'); const Bell = components.get('sidebar.footer.action');
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Bell, { ...components.get('sidebar.footer.action:props'), wide: true }), React.createElement(Overlay, components.get('shell.overlay:props')))); });
  await act(async () => { await pullTimer(); }); await act(async () => { await pullTimer(); });
  let toast = document.querySelector('aside[role="status"]'); assert.ok(toast); assert.match(toast.textContent, /需要回复/);
  assert.equal(toast.querySelector('.dsh-notify-toast-source')?.textContent, '通知插件改造', 'the toast says which session it came from');

  // No interaction published yet: the toast must offer the session, not fake buttons.
  assert.equal(toast.querySelectorAll('.dsh-notify-toast-answer').length, 1, 'only the 去会话里回答 action exists without a pending interaction');
  assert.match(toast.textContent, /去会话里回答/);

  // The official composer publishes the question the user must answer.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q1', options: [{ label: '批准' }, { label: '拒绝' }] }], answer: async (batch) => { answered.push(batch); publish(new Map()); } }]])); });
  toast = document.querySelector('aside[role="status"]');
  const labels = [...toast.querySelectorAll('.dsh-notify-toast-answer')].map((node) => node.textContent);
  assert.deepEqual(labels, ['批准', '拒绝', '去会话里回答'], 'the toast lists the real options plus a way into the session');

  await act(async () => { [...toast.querySelectorAll('.dsh-notify-toast-answer')].find((node) => node.textContent === '批准').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(answered, [{ answers: [{ id: 'q1', selected: ['批准'] }] }], 'answering resolves the same PendingQuestion the composer renders');
  assert.deepEqual(calls, ['ack'], 'the record is acknowledged, and answering never navigates away');
  assert.equal(document.querySelector('aside[role="status"]'), null, 'the toast closes once answered');

  // A response published by the composer (not by us) leaves nothing to answer here.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q2', options: [{ label: 'ok' }] }, { id: 'q3', options: [{ label: 'ok' }] }], answer: async () => {} }]])); });
  await act(async () => { globalThis.dispatchEvent(new dom.window.Event('dsh-notify:open-history')); });
  const list = document.querySelector('[role="dialog"][aria-label="通知历史"]'); assert.ok(list);
  await act(async () => { globalThis.dispatchEvent(new dom.window.Event('dsh-notify:open-history')); });
  const still = document.querySelector('[role="dialog"][aria-label="通知历史"]');
  assert.ok(still, 'two questions cannot be answered from a toast; the session keeps them');
});

test('clicking a toast jumps to its session; only a failed jump falls back to the history list', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let initial = true; let pulls = 0;
  const calls = []; let bound = true; let current = 'other-session';
  const earlier = { eventId: 'turn:real:8', mergeKey: 'turn:real:8', kind: 'completed', sessionId: 'other-session', title: '任务完成', body: '更早的一条', at: 8, unread: true, phase: 'settled' };
  const record = { eventId: 'turn:real:9', mergeKey: 'turn:real:9', kind: 'completed', sessionId: 'target-session', title: '任务完成', body: '在别的会话里', at: 9, unread: true, phase: 'settled' };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => {
      if (String(url).includes('/pull?')) {
        if (initial) { initial = false; return response({ reset: true, epoch: 1, cursor: 0, items: [] }); }
        pulls += 1;
        return response({ reset: false, epoch: 1, cursor: 9, items: pulls === 1 ? [earlier] : [earlier, record] });
      }
      if (String(url).includes('/ack')) { calls.push('ack'); return response({ ok: true }); }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  const sessions = { binding: (id) => bound && id === 'target-session' ? {} : undefined, open: (id) => { calls.push(`open:${id}`); current = id; return true; }, list: { getSnapshot: () => ({ current }) } };
  const components = new Map(); let overlayProps; let bellProps;
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions });
  root = createRoot(document.getElementById('root'));
  overlayProps = components.get('shell.overlay:props'); bellProps = components.get('sidebar.footer.action:props');
  const Overlay = components.get('shell.overlay');
  const Bell = components.get('sidebar.footer.action');
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Bell, { ...bellProps, wide: true }), React.createElement(Overlay, overlayProps))); });
  await act(async () => { await pullTimer(); });   // the first non-local record only primes lastEvent
  await act(async () => { await pullTimer(); });   // the next one is a live event and must toast
  const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast, 'a record arriving after load is presented as a toast');
  await act(async () => { toast.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, ['open:target-session', 'ack'], 'the toast jumps straight to its session and acknowledges it');
  assert.equal(document.querySelector('[role="dialog"][aria-label="通知历史"]'), null, 'a successful jump must not dump the user into the notification list');

  bound = false; calls.length = 0;
  await act(async () => { globalThis.dispatchEvent(new dom.window.Event('dsh-notify:open-history')); });
  const list = document.querySelector('[role="dialog"][aria-label="通知历史"]');
  assert.ok(list, 'the bell remains the way into the list');
  const item = [...list.querySelectorAll('button')].find((node) => node.textContent.includes('任务完成'));
  await act(async () => { item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, [], 'an unbound session cannot be navigated to, and nothing is acknowledged by guesswork');
  assert.ok(document.querySelector('[role="dialog"][aria-label="通知历史"]'), 'the list stays open so the user is never dropped nowhere');
});

test('the browser channel is gone: no permission prompt, no test banner, no second self-test card', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted;
  const asked = [];
  class FakeNotification { constructor() { asked.push('banner'); } }
  Object.defineProperty(FakeNotification, 'permission', { configurable: true, get: () => 'default' });
  FakeNotification.requestPermission = async () => { asked.push('permission'); return 'granted'; };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true, isSecureContext: true, Notification: FakeNotification,
    fetch: async (url) => String(url).includes('/self-test/preflight') ? response({ persist: {} }) : String(url).includes('/sounds') ? response({ custom: [] }) : response({ toastPosition: 'conversation', toastEnabled: true, subtaskNotify: false, soundEnabled: true, sound: 'chime', readRetentionDays: 0 }),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots });
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(components.get('settings.section'), { sessions: {} })); });
  for (let i = 0; i < 60 && !document.querySelector('.dsh-notify-card'); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });

  const titles = [...document.querySelectorAll('.dsh-notify-card-title')].map((node) => node.textContent);
  assert.deepEqual(titles, ['提示通道', '自测', '提示音', '历史'], 'only the in-page channel remains');
  assert.equal([...document.querySelectorAll('.dsh-notify-test')].map((node) => node.getAttribute('aria-label')).join('|'), 'A 页面里', 'the self-test has a single card now');
  const buttons = [...document.querySelectorAll('button')].map((node) => node.textContent);
  assert.equal(buttons.some((text) => text.includes('授权此浏览器系统通知')), false);
  assert.equal(buttons.some((text) => text.includes('发送一条测试通知')), false);
  assert.deepEqual(asked, [], 'nothing asks for the Notification permission any more');
  assert.equal(document.body.textContent.includes('浏览器系统通知'), false);
  assert.match(document.querySelector('.dsh-notify-card').textContent, /已读通知保留/, 'the surviving settings card keeps its own rows');
});
test('in-page toast anchors to the conversation column and the 关闭 option removes it without touching history', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => String(url).includes('/pull?') ? response({ reset: false, epoch: 1, cursor: 0, items: [] }) : response({}),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); setToastConfig({ toastPosition: 'conversation', toastEnabled: true }); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  assert.equal(toastAnchor(), 340, 'innerWidth 1024 minus a conversation right edge at 700 plus the 16px gutter');
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots });
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(components.get('shell.overlay'))); });

  const fire = async (eventId) => { await act(async () => { publishLocalSelfTest({ eventId, localOnly: true, kind: 'completed', title: '任务完成', body: '自检' }); }); };
  await fire('anchor-check'); const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast); assert.equal(toast.style.insetInlineEnd, '340px'); assert.match(toast.textContent, /任务完成/);
  assert.equal(toast.dataset.tone, 'success', 'a completed toast carries its tone for the icon/accent colour');
  assert.ok(toast.querySelector('.dsh-notify-toast-icon'), 'react-toastify-style per-result icon');
  const progress = toast.querySelector('.dsh-notify-toast-progress');
  assert.ok(progress, 'timed toasts expose a progress bar'); assert.equal(progress.style.animationDuration, '6000ms');
  assert.equal(progress.style.animationPlayState, 'running');
  await act(async () => { toast.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true })); });
  assert.equal(document.querySelector('.dsh-notify-toast-progress').style.animationPlayState, 'paused', 'hovering pauses both the timer and the bar');
  const closer = toast.querySelector('button[aria-label="关闭通知"]');
  assert.ok(closer, 'the toast must be closable from its own top-right corner');
  await act(async () => { closer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelector('aside[role="status"]'), null, 'closing dismisses the toast');
  assert.equal(document.querySelector('[role="dialog"]'), null, 'closing must not open the history panel');

  setToastConfig({ toastPosition: 'off' }); await fire('off-check');
  assert.equal(document.querySelector('aside[role="status"]'), null, '关闭（保留铃铛历史）must stop the in-page toast');
  setToastConfig({ toastPosition: 'viewport' }); await fire('viewport-check');
  const viewportToast = document.querySelector('aside[role="status"]');
  assert.ok(viewportToast, 'the off switch must not latch'); assert.equal(viewportToast.style.insetInlineEnd, '16px');
});

test('official slot component contract mounts a real clickable bell and accessible history dialog', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => String(url).includes('/pull?') ? response({ reset: false, epoch: 1, cursor: 0, items: [] }) : response({}),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  const components = new Map();
  const slots = {
    inject(_name, callback) { const dispose = callback(); return () => dispose?.(); },
    register(options, Component) { components.set(options.name, Component); return () => components.delete(options.name); },
  };
  mounted = mountNotifyClient({ slots });
  const Bell = components.get('sidebar.footer.action');
  assert.equal(typeof Bell, 'function');
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Bell, { wide: true })); });

  const button = document.querySelector('button[aria-label="通知"]');
  assert.ok(button); assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.style.flex, '1 1 100%', 'a full-line basis makes the bell wrap onto its own row instead of sharing dsh-mobile 移动访问');
  assert.equal(button.style.width, '', 'a 100% basis collapses the bell to zero width in the shared action row');
  assert.match(button.style.margin, /^4px 0(px)?$/); assert.equal(button.style.borderRadius, '12px'); assert.equal(button.style.justifyContent, 'flex-start');
  assert.ok(button.classList.contains('dsh-notify-bell'), 'the :has() row override needs a stable hook class');
  const rowStyle = document.head.querySelector('style[data-plugin="dsh-notify"]');
  assert.ok(rowStyle, 'the shared footer row must be allowed to wrap'); assert.match(rowStyle.textContent, /footerActions/); assert.match(rowStyle.textContent, /:has\(\.dsh-notify-bell\)/); assert.match(rowStyle.textContent, /flex-wrap:\s*wrap/);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const dialog = document.querySelector('[role="dialog"][aria-label="通知历史"]');
  const panel = dialog?.querySelector('section[aria-label="通知历史"]');
  assert.ok(dialog); assert.equal(dialog.getAttribute('aria-modal'), 'true'); assert.ok(panel); assert.equal(panel.parentElement, dialog); assert.equal(panel.style.position, 'fixed'); assert.equal(panel.style.insetInlineEnd, '16px'); assert.equal(panel.style.bottom, '72px'); assert.match(panel.style.width, /360px/); assert.match(panel.style.width, /100vw - 32px/); assert.equal(panel.style.boxSizing, 'border-box'); assert.match(panel.textContent, /通知历史/); assert.match(panel.textContent, /没有未读通知/);
  assert.equal([...dialog.childNodes].filter((node) => node.nodeType === 1).length, 1, 'dialog content belongs inside its styled panel');

  await act(async () => { dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement, button);

  globalThis.innerWidth = 390;
  await act(async () => { dispatchEvent(new Event('dsh-notify:open-history')); });
  const narrowDialog = document.querySelector('[role="dialog"][aria-label="通知历史"]');
  const narrowPanel = narrowDialog?.querySelector('section[aria-label="通知历史"]');
  assert.ok(narrowDialog, 'cross-seat toast event opens the same history state'); assert.ok(narrowPanel);
  assert.equal(narrowDialog.style.display, 'flex'); assert.equal(narrowDialog.style.alignItems, 'center'); assert.equal(narrowDialog.style.justifyContent, 'center'); assert.equal(narrowDialog.style.boxSizing, 'border-box'); assert.equal(narrowDialog.style.paddingInline, '12px'); assert.match(narrowDialog.style.paddingBlockEnd, /10dvh/);
  assert.equal(narrowPanel.style.position, 'relative'); assert.equal(narrowPanel.style.insetInlineEnd, ''); assert.equal(narrowPanel.style.bottom, ''); assert.equal(narrowPanel.style.width, '100%'); assert.equal(narrowPanel.style.minWidth, '0'); assert.equal(narrowPanel.style.boxSizing, 'border-box'); assert.equal(narrowPanel.style.maxHeight, '100%', 'the panel is capped by its flex container, which already excludes the safe-area paddings (a dvh guess overflowed the top on a phone)'); assert.equal(narrowPanel.style.overflow, 'auto'); assert.match(narrowPanel.textContent, /没有未读通知/);
});

test('invalid navigation and ack failure preserve unread until authoritative ack pull', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer;
  let current; let initial = true; let cursor = 3; const pending = [];
  const records = [
    { eventId: 'missing', sessionId: 'missing-session', title: '无效目标', body: '保留未读', at: 3, unread: true, phase: 'settled' },
    { eventId: 'ack-fail', sessionId: 'session-fail', title: '确认失败', body: '保留未读', at: 2, unread: true, phase: 'settled' },
    { eventId: 'success', sessionId: 'session-ok', title: '有效目标', body: '确认已读', at: 1, unread: true, phase: 'settled' },
  ];
  const calls = []; const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window), innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url, init) => {
      if (String(url).includes('/pull?')) { const items = initial ? records : pending.splice(0); const reset = initial; initial = false; return response({ reset, epoch: 1, cursor, items }); }
      const eventId = JSON.parse(init.body).eventId; calls.push(eventId);
      if (eventId === 'ack-fail') return { ok: false, status: 500 };
      const record = records.find((item) => item.eventId === eventId); record.unread = false; cursor += 1; pending.push({ ...record }); return response({ ok: true });
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  const sessions = { binding: (id) => id === 'session-fail' || id === 'session-ok' ? {} : undefined, open(id) { current = id; }, list: { getSnapshot: () => ({ current }) } };
  let Bell; let bellProps;
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.name === 'sidebar.footer.action') { Bell = Component; bellProps = options.inject(); } return () => {}; } };
  mounted = mountNotifyClient({ slots, sessions }); root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Bell, { ...bellProps, wide: true })); });
  const bell = document.querySelector('button[aria-label^="通知"]'); assert.match(bell.getAttribute('aria-label'), /3 条未读/);
  await act(async () => { bell.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const item = (title) => [...document.querySelectorAll('section[aria-label="通知历史"] button')].find((node) => node.textContent.includes(title));

  await act(async () => { item('无效目标').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, []); assert.equal(current, undefined); assert.match(bell.getAttribute('aria-label'), /3 条未读/);
  await act(async () => { item('确认失败').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, ['ack-fail']); assert.equal(current, 'session-fail'); assert.match(bell.getAttribute('aria-label'), /3 条未读/);
  await act(async () => { item('有效目标').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, ['ack-fail', 'success']); assert.equal(current, 'session-ok');
  assert.match(bell.getAttribute('aria-label'), /2 条未读/, 'a confirmed record stops counting as unread immediately, not after the next poll');
  assert.match(bell.getAttribute('aria-label'), /2 条未读/, 'the acknowledged record stops counting as unread without waiting for a pull');
  await act(async () => { await pullTimer(); });
  assert.match(bell.getAttribute('aria-label'), /2 条未读/);
  const readTab = [...document.querySelectorAll('section[aria-label="通知历史"] [role="tab"]')].find((node) => node.textContent.includes('已读'));
  await act(async () => { readTab.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.doesNotMatch(item('有效目标').textContent, /^●/, 'the acked record moved to 已读 and lost its unread marker');
  assert.match(item('有效目标').textContent, /有效目标/);
});
