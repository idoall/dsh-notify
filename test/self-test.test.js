import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient, NotificationSelfTests } from '../src/client.js';

const response = (value) => ({ ok: true, json: async () => value });

test('the self-test card only exercises the page: one button, no host request', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let requests = 0;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: () => 1, clearInterval: () => {},
    fetch: async () => { requests += 1; return response({}); },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]') ?? document.body;
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots });
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(components.get('shell.overlay'), components.get('shell.overlay:props')),
      React.createElement(NotificationSelfTests)));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  assert.ok(document.querySelector('[aria-label="通知自测"]'), 'the card is there');
  assert.equal(document.querySelector('[aria-label="A 页面里"]'), null, 'the old dimension grid is gone with the host self-tests');
  const completed = [...document.querySelectorAll('button')].find((node) => node.textContent === '完成');
  const replay = [...document.querySelectorAll('button')].find((node) => node.textContent === '查看四种状态 / 重播动效');
  const folded = [...document.querySelectorAll('button')].find((node) => node.textContent === '折叠通知为一摞');
  const clear = [...document.querySelectorAll('button')].find((node) => node.textContent === '清空通知，先看文档');
  assert.ok(completed && replay && folded && clear, 'the demo-style state, replay, fold, and clear controls are offered');
  const button = completed;
  const before = requests;   // the overlay polls on its own; only the click must stay silent
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast, 'the page toast is the only thing this test can prove');
  assert.match(toast.textContent, /程序修复已完成/);
  assert.equal(toast.getAttribute('data-tone'), 'success', 'the enhanced success self-test carries a real status tone instead of neutral gray');
  assert.equal(requests, before, 'a page test never talks to the host');
  assert.equal(document.querySelector('section[aria-label="通知历史"]'), null, 'and there is no history panel to look in');

  await act(async () => { replay.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const all = [...document.querySelectorAll('aside[role="status"]')];
  const live = all.filter((node) => node.getAttribute('data-leaving') !== 'true');
  assert.equal(live.length, 4, 'replay clears prior examples and renders exactly the four status examples');
  const tones = all.map((node) => node.getAttribute('data-tone'));
  for (const tone of ['success', 'warning', 'info', 'error']) assert.ok(tones.includes(tone), `the group covers the ${tone} tone`);
  await act(async () => { folded.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelector('.dsh-notify-stack').getAttribute('data-collapsed'), 'true', 'the fold control uses the approved piled presentation');
  await act(async () => { clear.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelectorAll('aside[role="status"]').length, 0, 'clear removes page-local examples only');
  assert.equal(requests, before, 'a page test never talks to the host, however many it fires');
});
