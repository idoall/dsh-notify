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
  const one = [...document.querySelectorAll('button')].find((node) => node.textContent === '测试一条');
  const batch = [...document.querySelectorAll('button')].find((node) => node.textContent.startsWith('测试一组'));
  assert.ok(one && batch, 'both self-test buttons are offered');
  const button = one;
  const before = requests;   // the overlay polls on its own; only the click must stay silent
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast, 'the page toast is the only thing this test can prove');
  assert.match(toast.textContent, /自测：页面浮层/);
  assert.equal(requests, before, 'a page test never talks to the host');
  assert.equal(document.querySelector('section[aria-label="通知历史"]'), null, 'and there is no history panel to look in');

  // The group test exists so the stack, the collapse and every tone can be seen at once.
  const beforeBatch = requests;
  await act(async () => { batch.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const cards = [...document.querySelectorAll('aside[role="status"]')];
  assert.equal(cards.length, 5, 'the stack keeps at most five cards: the single test card is the one pushed out');
  assert.equal(document.querySelector('.dsh-notify-toast-more')?.textContent, '+4', 'and the stack says how many sit behind the front card');
  const tones = cards.map((node) => node.getAttribute('data-tone'));
  for (const tone of ['success', 'warning', 'info', 'error', 'neutral']) assert.ok(tones.includes(tone), `the group covers the ${tone} tone`);
  assert.equal(requests, beforeBatch, 'a page test never talks to the host, however many it fires');
});
