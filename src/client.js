import React from 'react';
import { BUILTIN_SOUNDS, SOUND_LABELS, SOUND_PRESETS, parseSoundChoice } from './sound-choices.js';

const BASE = '/plugins/dsh-notify';
const CLEAR_EVENT = 'dsh-notify:cleared';
const OPEN_EVENT = 'dsh-notify:open-history';
const LOCAL_TEST_EVENT = 'dsh-notify:self-test-local';
const READ_EVENT = 'dsh-notify:read';
export const inject = ['slots'];
export const BELL_CLASS = 'dsh-notify-bell';
const HISTORY_PAGE = 20;
const ACK_ALL_CAP = 50;
/**
 * In-page toast anchor: the right edge of the conversation column, so the toast stays in the gutter
 * beside the chat and moves when the right sidebar opens or closes. `100vw` cannot express this —
 * it ignores the left sidebar and the right pane's width, which parked the toast over the right
 * sidebar. Falls back to the old centered-content guess only when the DSH hook is absent.
 */
export function toastAnchor({ document: doc = globalThis.document, innerWidth = globalThis.innerWidth, fallbackContentWidth = 720 } = {}) {
  const rect = doc?.querySelector?.('[data-conversation-scroll]')?.getBoundingClientRect?.();
  const right = rect && rect.width > 0 ? Math.min(rect.right, innerWidth) : null;
  return right === null ? Math.max(16, (innerWidth - fallbackContentWidth) / 2 + 16) : Math.max(16, innerWidth - right + 16);
}
/**
 * Official sidebar foot renders `sidebar.footer.action` as ONE nowrap flex line, so every
 * registrant (dsh-mobile 移动访问, Cordis, us) is forced onto the same row. Letting that row wrap
 * is the only way a plugin can occupy its own row there, because the sidebar exposes no row-level
 * foot slot for plugins (`sidebar.settings` is a single seat owned by ui-settings-general).
 * The `:has()` scope keeps the override on the one row that actually holds our bell, and degrades
 * to the shared row (never to an overlap) on engines without `:has()`.
 *
 * The bell's colour and interaction states live here rather than in inline style so they use the
 * SAME set as the two neighbouring rows: ui-settings-general's `.trigger:hover` and dsh-mobile's
 * `.dsh-mobile-control__trigger:hover/:active/:focus-visible` (inline style would out-rank `:hover`).
 */
export const SIDEBAR_ACTION_CSS = `[class*="footerActions"]:has(.${BELL_CLASS}){flex-wrap:wrap}
.${BELL_CLASS}{font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit);background:0 0}
.${BELL_CLASS}:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f3f6)}
.${BELL_CLASS}:active,.${BELL_CLASS}[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-active,#e8ebf0)}
.${BELL_CLASS}:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,currentColor);outline-offset:2px}`;
/**
 * Settings-section presentation. Mirrors the design language of the shipped `dsh-update-status`
 * 「版本与更新」 section (its `.dus-settings*` rules): one heading, bordered cards, full-width
 * labelled fields, secondary hints, and one flat action button style — so our section sits in the
 * same visual system as the app instead of falling back to UA button/checkbox/select defaults.
 * Only `--dsw-*` / `--ds-font-*` tokens are used (03-ui-ux contract), and every class is namespaced.
 */
export const SETTINGS_CSS = `.dsh-notify-settings{display:grid;gap:14px;max-width:640px;min-width:0;padding:4px 0;color:var(--dsw-alias-label-primary)}
.dsh-notify-heading{font-size:16px;font-weight:650;margin:0}
.dsh-notify-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;min-width:0;padding:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-notify-card>*+*{margin-top:10px}
.dsh-notify-card-title{font-size:13px;font-weight:650;margin:0}
.dsh-notify-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0}
.dsh-notify-status{align-items:center;display:flex;gap:8px;font-size:12px;line-height:1.45;margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-notify-status::before{background:var(--dsw-alias-label-tertiary,#98a1ad);border-radius:50%;content:"";flex:none;height:8px;width:8px}
.dsh-notify-status[data-tone=ok]::before{background:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-status[data-tone=warn]::before{background:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-notify-status[data-tone=error]::before{background:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-toggle{align-items:flex-start;cursor:pointer;display:flex;font-size:13px;gap:10px;line-height:1.45}
.dsh-notify-toggle input{accent-color:var(--dsw-alias-state-business-primary);flex:none;height:18px;margin:1px 0 0;min-height:18px;min-width:18px;width:18px}
.dsh-notify-field{display:grid;font-size:13px;font-weight:600;gap:8px;min-width:0}
.dsh-notify-select{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;font:inherit;font-weight:400;max-width:100%;min-height:40px;min-width:0;padding:0 10px;width:100%}
.dsh-notify-actions{align-items:center;display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.dsh-notify-action{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:30px;max-width:100%;min-height:32px;padding:0 10px;touch-action:manipulation}
.dsh-notify-action:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-action:disabled{cursor:not-allowed;opacity:.55}
.dsh-notify-action[data-variant=danger]{background:transparent;border-color:var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-action:focus-visible,.dsh-notify-select:focus-visible,.dsh-notify-toggle input:focus-visible,.dsh-notify-details>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-tests{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))}
.dsh-notify-test{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px}
.dsh-notify-test-head{align-items:center;display:flex;gap:8px;min-width:0}
.dsh-notify-test-badge{align-items:center;background:var(--dsw-alias-label-primary,#111);border-radius:5px;color:var(--dsw-alias-label-primary-inverted,#fff);display:inline-flex;flex:none;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;font-weight:650;height:18px;justify-content:center;line-height:1;min-width:18px;padding:0 5px}
.dsh-notify-test-title{font-size:13px;font-weight:650;line-height:1.4;min-width:0}
.dsh-notify-result{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.dsh-notify-result[data-tone=passed]{color:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-result[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-result[data-tone=active]{color:var(--dsw-alias-state-business-primary)}
.dsh-notify-details{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.dsh-notify-details>summary{cursor:pointer;font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.dsh-notify-details[open]>summary{color:var(--dsw-alias-label-primary);margin-bottom:4px}
.dsh-notify-confirm{border-left:2px solid var(--dsw-alias-state-warn-primary,#d97706);display:grid;gap:8px;min-width:0;padding-left:10px}
.dsh-notify-history-head{align-items:center;display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}
.dsh-notify-history-close{align-items:center;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font-size:16px;height:26px;justify-content:center;line-height:1;padding:0;width:26px}
.dsh-notify-history-close:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}
.dsh-notify-history-tabs{display:flex;gap:4px;margin-bottom:8px}
.dsh-notify-history-tabs button{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:1;font:inherit;font-size:12px;min-height:32px;padding:0 8px}
.dsh-notify-history-tabs button[data-active=true]{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary);font-weight:650}
.dsh-notify-history-actions{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.dsh-notify-history-notice{color:var(--dsw-alias-state-business-primary,#2563eb);font-size:11px;line-height:1.5;margin:0 0 8px}
.dsh-notify-history-list{display:grid;gap:6px;list-style:none;margin:0;padding:0}
[data-chat-turn][data-dsh-notify-turn=highlight]{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:10px;transition:outline-color .2s ease}
.dsh-notify-history-row{align-items:flex-start;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:grid;gap:8px;grid-template-columns:auto minmax(0,1fr) auto;padding:8px 10px;transition:border-color .12s ease,color .12s ease}
.dsh-notify-history-row[data-settling=false]{grid-template-columns:auto minmax(0,1fr)}
.dsh-notify-history-settle{align-self:center;background:transparent;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;font:inherit;font-size:11px;line-height:1;padding:5px 8px;white-space:nowrap}
.dsh-notify-history-settle:hover{color:var(--dsw-alias-label-primary)}
.dsh-notify-history-row[data-read=false]{border-color:var(--dsw-alias-border-l4)}
.dsh-notify-history-row[data-read=false] .dsh-notify-history-title{color:var(--dsw-alias-label-primary)}
.dsh-notify-history-row[data-read=true]{border-color:var(--dsw-alias-border-l2)}
.dsh-notify-history-row[data-read=true] .dsh-notify-history-title{color:var(--dsw-alias-label-secondary);font-weight:500}
.dsh-notify-history-row[data-read=true] .dsh-notify-history-body,
.dsh-notify-history-row[data-read=true] .dsh-notify-history-meta{color:var(--dsw-alias-label-tertiary)}
.dsh-notify-history-check{accent-color:var(--dsw-alias-label-primary);flex:none;height:16px;margin:2px 0 0;min-height:16px;min-width:16px;width:16px}
.dsh-notify-history-open{background:transparent;border:0;color:inherit;cursor:pointer;display:grid;font:inherit;gap:2px;min-height:32px;min-width:0;padding:0;text-align:start}
.dsh-notify-history-meta{align-items:baseline;color:var(--dsw-alias-label-tertiary,#7a8494);display:flex;font-size:11px;gap:6px;justify-content:space-between}
.dsh-notify-history-source{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-notify-history-title{font-size:13px;font-weight:650;line-height:1.45}
.dsh-notify-history-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.dsh-notify-history-more{background:transparent;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;margin-top:8px;min-height:34px;width:100%}
.dsh-notify-history-more:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-guide{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2));border-left:2px solid var(--dsw-alias-state-warn-primary,#d97706);border-radius:0 8px 8px 0;display:grid;gap:6px;min-width:0;padding:8px 10px}
.dsh-notify-guide-title{font-size:12px;font-weight:650;margin:0}
.dsh-notify-guide-steps{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55;margin:0;padding-inline-start:18px}
.dsh-notify-guide-steps li+li{margin-top:3px}
.dsh-notify-guide-notice{color:var(--dsw-alias-state-business-primary,#2563eb);font-size:11px;line-height:1.5;margin:0}
@media (hover:none) and (pointer:coarse){.dsh-notify-action{line-height:42px;min-height:44px}.dsh-notify-select{min-height:44px}.dsh-notify-toggle input{height:22px;min-height:22px;min-width:22px;width:22px}}`;
/**
 * Toast presentation, modelled on react-toastify: one row of [tone icon][title + text][close X],
 * a tone colour per kind, and a progress bar that pauses with the hover-pause timer. The toast also
 * sits above the official settings overlay (z-index 1000) so a self-test fired from 设置 is visible
 * and closable instead of dimmed behind the mask.
 */
export const TOAST_CSS = `.dsh-notify-toast{align-items:flex-start;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-elevation-panel,0 6px 20px rgb(0 0 0 / 18%));box-sizing:border-box;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;gap:10px;margin:0;overflow:hidden;padding:12px 34px 12px 12px;pointer-events:auto;position:fixed;width:min(360px,calc(100vw - 32px));z-index:1100}
.dsh-notify-toast-icon{color:var(--dsw-alias-label-tertiary,#7a8494);flex:none;margin-top:1px}
.dsh-notify-toast[data-tone=success] .dsh-notify-toast-icon{color:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-toast[data-tone=error] .dsh-notify-toast-icon{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-toast[data-tone=warning] .dsh-notify-toast-icon{color:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-notify-toast[data-tone=info] .dsh-notify-toast-icon{color:var(--dsw-alias-state-business-primary,#2563eb)}
.dsh-notify-toast-body{display:grid;gap:2px;min-width:0}
.dsh-notify-toast-source{color:var(--dsw-alias-label-tertiary,#7a8494);font-size:11px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-notify-toast-title{font-size:13px;font-weight:650;line-height:1.45}
.dsh-notify-toast-text{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.dsh-notify-toast-answers{align-items:center;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsh-notify-toast-answer{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:26px;max-width:100%;min-height:28px;overflow:hidden;padding:0 10px;text-overflow:ellipsis;touch-action:manipulation;white-space:nowrap}
.dsh-notify-toast-answer:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-toast-answer:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-toast-answer[data-variant=quiet]{background:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-notify-toast-error{color:var(--dsw-alias-state-error-primary,#dc2626);font-size:11px;line-height:1.45}
.dsh-notify-toast-close{align-items:center;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font-size:15px;height:22px;inset-inline-end:6px;justify-content:center;line-height:1;padding:0;position:absolute;top:6px;width:22px}
.dsh-notify-toast-close:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}
.dsh-notify-toast-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-toast-progress{animation:dsh-notify-toast-progress linear forwards;background:currentColor;bottom:0;height:2px;inset-inline:0;position:absolute;transform-origin:left}
.dsh-notify-toast:hover .dsh-notify-toast-progress{animation-play-state:paused}
@keyframes dsh-notify-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@media (hover:none) and (pointer:coarse){.dsh-notify-toast{padding:12px 44px 12px 12px}.dsh-notify-toast-close{font-size:17px;height:32px;width:32px}}
@media (prefers-reduced-motion:reduce){.dsh-notify-toast-progress{animation:none;transform:scaleX(0)}}`;
export const CLIENT_CSS = `${SIDEBAR_ACTION_CSS}\n${SETTINGS_CSS}\n${TOAST_CSS}`;
export function installClientStyles({ document: doc = globalThis.document } = {}) {
  const head = doc?.head;
  if (!head?.append || !doc.createElement) return () => {};
  const style = doc.createElement('style');
  style.dataset.plugin = 'dsh-notify';
  style.textContent = CLIENT_CSS;
  head.append(style);
  return () => style.remove();
}

export function layoutFor({ width = 1024, coarse = false } = {}) { return { narrow: width < 760, hitTarget: coarse ? 44 : 32 }; }
export function toastPolicy(record, { width = 1024 } = {}) { const open = record.phase === 'open'; return { persistent: width < 760 && open, timeoutMs: open ? (width < 760 ? null : 6000) : (width < 760 ? 8000 : 6000) }; }
export async function syncPull(fetchFn, cursor = 0) { try { const result = await fetchFn(cursor); return { ...result, offline: false }; } catch (error) { return { items: [], cursor, offline: true, error }; } }
export async function clearNotificationHistory({ confirmed = false, onReset } = {}) {
  if (!confirmed) return { status: 'cancelled' };
  const result = await fetchJson('/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
  if (!result?.ok || !result.reset || !Number.isSafeInteger(result.epoch) || result.cursor !== 0 || !Array.isArray(result.items)) throw new Error('invalid clear response');
  onReset?.(result);
  return { status: 'cleared', ...result };
}
/**
 * Tell the host a notification is no longer waiting on the user. The badge counts pending records, so
 * this — not "mark read" — is what clears it. Used when the interaction this page was showing is gone,
 * or when the user says so explicitly.
 */
export async function settleNotificationRecord(eventId, { outcome = 'settled' } = {}) {
  const result = await fetchJson('/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, outcome }) });
  emitRecordsRead([eventId]);
  return result;
}
export async function deleteNotificationRecords({ eventIds = [], confirmed = false, onReset } = {}) {
  if (!confirmed) return { status: 'cancelled' };
  if (!Array.isArray(eventIds) || eventIds.length === 0) return { status: 'empty' };
  const result = await fetchJson('/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, eventIds }) });
  if (!result?.ok || !result.reset || !Number.isSafeInteger(result.epoch) || result.cursor !== 0 || !Array.isArray(result.items)) throw new Error('invalid delete response');
  onReset?.(result);
  return { status: 'deleted', ...result };
}
/** Compact relative time for a history row; never says "in N minutes" for a clock-skewed record. */
/** 已读 retention: how old an acknowledged record may be before the panel hides it (0 = keep). */
export function readRetentionCutoff(days, now = Date.now()) {
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  return Number(now) - days * 24 * 60 * 60 * 1000;
}
export function relativeTimeLabel(at, now = Date.now()) {
  const delta = Number(now) - Number(at);
  if (!Number.isFinite(delta) || delta < 60_000) return '刚刚';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
export function createLocalSelfTestRecord({ now = Date.now(), randomUUID = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) } = {}) {
  const testRunId = `self-test:a:${randomUUID()}`;
  return { eventId: testRunId, mergeKey: `test:${testRunId}`, kind: 'test', deliveryScope: 'a-only', testRunId, title: '自测：页面浮层', body: '只显示在当前页面，不会发送系统通知', at: now, unread: false, phase: 'settled', localOnly: true };
}
export function publishLocalSelfTest(record, dispatch = (event) => globalThis.dispatchEvent(event)) {
  dispatch(typeof CustomEvent === 'function' ? new CustomEvent(LOCAL_TEST_EVENT, { detail: record }) : { type: LOCAL_TEST_EVENT, detail: record });
}
const selfTestRunId = (dimension) => `self-test:${dimension}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export async function submitSelfTest(dimension, { confirmed = false, sessionId } = {}) {
  if (!confirmed) return { status: 'untested', reason: '需要确认' };
  const testRunId = selfTestRunId(dimension);
  return fetchJson('/self-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dimension, confirm: true, testRunId, ...(dimension === 'navigation' ? { sessionId } : {}) }) });
}
export async function cleanupSelfTest(testRunId) { return fetchJson('/self-test/cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, testRunId }) }); }
function validSessionId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value); }
/**
 * Reveal one turn inside the session the user just opened. The chat renders every turn as a flow item
 * carrying `data-chat-turn` (a semantic hook, not a hashed class), so a notification that knows its
 * turn lands on that exact turn instead of the bottom of a long conversation. The first attempt can
 * miss because the session is still mounting, so this retries briefly and gives up silently.
 */
export function revealTurn(turn, { document: doc = globalThis.document, attempts = 24, intervalMs = 80, timers = {} } = {}) {
  const setTimer = timers.setTimeout ?? globalThis.setTimeout;
  const clearTimer = timers.clearTimeout ?? globalThis.clearTimeout;
  if (!doc?.querySelector || typeof setTimer !== 'function' || !Number.isSafeInteger(turn) || turn <= 0) return () => {};
  let done = false; let timer = null; let left = attempts;
  const clear = () => { if (timer !== null) { clearTimer(timer); timer = null; } done = true; };
  const attempt = () => {
    if (done) return;
    const element = doc.querySelector(`[data-chat-turn="${turn}"]`);
    if (element) {
      try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* jsdom and older engines */ }
      element.setAttribute('data-dsh-notify-turn', 'highlight');
      timer = setTimer(() => { try { element.removeAttribute('data-dsh-notify-turn'); } catch { /* gone */ } }, 2400);
      done = true;
      return;
    }
    if (--left <= 0) { done = true; return; }
    timer = setTimer(attempt, intervalMs);
  };
  timer = setTimer(attempt, 0);
  return clear;
}
export async function navigateNotificationRecord(record, { sessions, acknowledge } = {}) {
  const sessionId = record?.sessionId;
  // A record with nowhere to go — a self-test artefact (`sessionId: null`), or a session that has
  // since been deleted — must still be dismissible. Refusing to acknowledge it used to leave the
  // unread badge stuck red forever, so "open" degrades to "mark read" and says so.
  const snapshot = sessions?.list?.getSnapshot?.();
  const goneFromList = Boolean(snapshot?.byId) && !snapshot.byId[sessionId];
  if (!validSessionId(sessionId) || goneFromList) {
    await acknowledge?.(record);
    return { status: 'acknowledged-without-session' };
  }
  if (!sessions?.binding?.(sessionId)) return { status: 'navigation-failed' };
  try {
    const opened = sessions.open(sessionId);
    if (opened === false || sessions.list?.getSnapshot?.().current !== sessionId) return { status: 'navigation-failed' };
    if (Number.isSafeInteger(record.turn) && record.turn > 0) revealTurn(record.turn);
    await acknowledge?.(record);
    return { status: 'acknowledged' };
  } catch (error) { return { status: 'failed', error }; }
}
export function installAudioUnlock({ document: doc = globalThis.document, player = soundPlayer } = {}) {
  if (!doc?.addEventListener) return () => {};
  const unlock = () => { void player.unlock(); };
  doc.addEventListener('pointerdown', unlock, { passive: true });
  doc.addEventListener('keydown', unlock);
  return () => { doc.removeEventListener('pointerdown', unlock); doc.removeEventListener('keydown', unlock); };
}
async function fetchJson(path, init) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) { const error = new Error(`notify request failed: ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
function mergeRecords(previous, items) {
  const merged = new Map(previous.map((record) => [record.eventId, record]));
  for (const record of items) if (record?.eventId) merged.set(record.eventId, record);
  return [...merged.values()].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
export function browserDeliveryItems(data, previousEpoch) { return !data?.reset && previousEpoch !== undefined && Array.isArray(data.items) ? data.items.filter((record) => record?.deliveryScope !== 'a-only') : []; }
function useNotificationState() {
  const [state, setState] = React.useState({ records: [], cursor: 0, epoch: undefined, offline: false, reset: false, revision: 0 });
  React.useEffect(() => {
    const cleared = (event) => { const data = event?.detail; if (data?.reset && Number.isSafeInteger(data.epoch)) setState((old) => ({ records: mergeRecords(old.records.filter((record) => record.localOnly), Array.isArray(data.items) ? data.items : []), cursor: 0, epoch: data.epoch, offline: false, reset: true, revision: old.revision + 1 })); };
    const local = (event) => { const record = event?.detail; if (record?.localOnly) setState((old) => ({ ...old, records: mergeRecords(old.records, [record]), revision: old.revision + 1 })); };
    // Reading only re-colours rows in place; it must not regroup the tabs, or rows jump while the
    // user is still looking at them. The next fetch (revision) moves them into 已读.
    const read = (event) => { const ids = new Set(event?.detail?.eventIds ?? []); if (!ids.size) return; setState((old) => ({ ...old, records: old.records.map((record) => ids.has(record.eventId) ? { ...record, unread: false } : record) })); };
    globalThis.addEventListener?.(CLEAR_EVENT, cleared); globalThis.addEventListener?.(LOCAL_TEST_EVENT, local); globalThis.addEventListener?.(READ_EVENT, read);
    return () => { globalThis.removeEventListener?.(CLEAR_EVENT, cleared); globalThis.removeEventListener?.(LOCAL_TEST_EVENT, local); globalThis.removeEventListener?.(READ_EVENT, read); };
  }, []);
  React.useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const data = await fetchJson(`/pull?cursor=${state.cursor}&epoch=${state.epoch ?? ''}`);
        if (alive) setState((old) => ({ records: data.reset ? mergeRecords(old.records.filter((record) => record.localOnly), data.items) : mergeRecords(old.records, data.items), cursor: data.cursor, epoch: data.epoch, offline: false, reset: Boolean(data.reset), revision: old.revision + 1 }));
      } catch { if (alive) setState((old) => ({ ...old, offline: true })); }
    };
    pull(); const timer = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [state.cursor, state.epoch]);
  return state;
}
export function channelStatus() { return [
  { id: 'A', label: '页面里', state: 'available', detail: 'Toast + 铃铛历史 + 提示音 + 后台标题闪动' },
]; }
/**
 * Full toast order: records waiting on the user come first, then everything else, each group newest
 * first (the store already sorts by `at` descending). A queue — not "the one latest record" — is what
 * keeps a single unanswered record from starving every later notification.
 */
export function toastOrder(records = []) { return [...records.filter((record) => record?.phase === 'open'), ...records.filter((record) => record?.phase !== 'open')]; }
export function prioritizedToastRecords(records = []) { const open = records.filter((record) => record?.phase === 'open'); return open.length ? open : records; }
export function toastQueue(records = [], width = 1024) { return prioritizedToastRecords(records).slice(0, width < 760 ? 2 : 3).map((record) => ({ record, ...toastPolicy(record, { width }), paused: false })); }
export function pwaGuidance({ ios = false, secure = globalThis.isSecureContext, standalone = false } = {}) {
  if (!secure) return { state: 'needs-https', detail: '需要 HTTPS 后才能授权通知或后台推送' };
  if (ios && !standalone) return { state: 'needs-home-screen', detail: '请在 Safari 分享菜单选择“添加到主屏幕”，打开主屏 Web App 后再授权通知/推送（未测）' };
  if (ios) return { state: 'unverified', detail: '主屏 Web App 可在用户手势后授权；真实 iOS 推送投递未测' };
  return { state: 'available', detail: '请在用户操作后授权通知或订阅推送' };
}
export function createToastTimer({ durationMs, now = () => Date.now(), setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, onExpire = () => {} } = {}) {
  let timer = null; let deadline = 0; let remainingMs = durationMs ?? null; let stopped = false;
  const clear = () => { if (timer !== null) { clearTimeoutFn(timer); timer = null; } };
  const start = () => { if (stopped || remainingMs === null || remainingMs <= 0) return; deadline = now() + remainingMs; timer = setTimeoutFn(() => { timer = null; remainingMs = 0; onExpire(); }, remainingMs); };
  const pause = () => { if (timer === null) return remainingMs; remainingMs = Math.max(0, deadline - now()); clear(); return remainingMs; };
  const resume = () => { if (timer === null && remainingMs !== null && remainingMs > 0) start(); return remainingMs; };
  const destroy = () => { stopped = true; clear(); };
  start(); return { pause, resume, destroy, remaining: () => remainingMs };
}
const TOAST_TONE_BY_KIND = Object.freeze({ approval: 'warning', question: 'info', 'plan-review': 'info', completed: 'success', failed: 'error', 'job-end': 'neutral', 'workflow-end': 'neutral', test: 'neutral' });
/** Tone id shared by the toast icon, its accent colour and the progress bar. */
export function toastTone(kind) { return TOAST_TONE_BY_KIND[kind] ?? 'neutral'; }
/** 20px line-art icon per tone (react-toastify's per-result icon, drawn in the DSH stroke style). */
export function toastIcon(tone) {
  const shared = { 'aria-hidden': true, focusable: false, width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'dsh-notify-toast-icon' };
  if (tone === 'success') return React.createElement('svg', shared, React.createElement('path', { d: 'M4.5 10.4l3.6 3.6 7.4-8' }));
  if (tone === 'error') return React.createElement('svg', shared, React.createElement('path', { d: 'M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8' }));
  if (tone === 'warning') return React.createElement('svg', shared, React.createElement('path', { d: 'M10 3.6l7 12.4H3z' }), React.createElement('path', { d: 'M10 8.6v3.1M10 14.3h.01' }));
  if (tone === 'info') return React.createElement('svg', shared, React.createElement('circle', { cx: 10, cy: 10, r: 7 }), React.createElement('path', { d: 'M10 9.2v4M10 6.7h.01' }));
  return React.createElement('svg', shared, React.createElement('path', { d: 'M10 3.2a4.3 4.3 0 0 0-4.3 4.3c0 3.2-1.2 4.2-1.2 4.2h11s-1.2-1-1.2-4.2A4.3 4.3 0 0 0 10 3.2z' }), React.createElement('path', { d: 'M8.6 14.4a1.6 1.6 0 0 0 2.8 0' }));
}
export function toastStyleForKind(kind) { const token = { approval: ['warning', 'var(--dsw-alias-warning, #b26a00)'], question: ['info', 'var(--dsw-alias-info, #2878b8)'], 'plan-review': ['info', 'var(--dsw-alias-info, #2878b8)'], completed: ['success', 'var(--dsw-alias-success, #287a45)'], failed: ['error', 'var(--dsw-alias-danger, #b23a3a)'], 'job-end': ['neutral', 'var(--dsw-alias-text-3, #666)'], 'workflow-end': ['neutral', 'var(--dsw-alias-text-3, #666)'], test: ['neutral', 'var(--dsw-alias-text-3, #666)'] }[kind] || ['neutral', 'var(--dsw-alias-text-3, #666)']; return { token: token[0], color: token[1], borderInlineStart: `4px solid ${token[1]}` }; }
/** Bell sizing contract for the two sidebar forms: an own full-width row when wide, an official-sized rail icon otherwise. */
export function bellActionStyle(wide) {
  return { flex: wide ? '1 1 100%' : '0 0 auto', ...(wide ? { height: 42, borderRadius: 12 } : { width: 36, height: 36, borderRadius: '50%', position: 'relative' }), minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center', gap: 8, padding: wide ? '0 10px 0 8px' : 0, margin: '4px 0', textAlign: 'start', border: 0, cursor: 'pointer' };
}
/** Unread badge: in-flow at the row's end when wide, overlaid on the rail icon so the 36px rail box never widens. */
export function bellBadgeStyle(wide) {
  return { minWidth: 18, height: 18, paddingInline: 4, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1, background: 'var(--dsw-alias-danger, #c33)', color: 'var(--dsw-alias-on-danger, #fff)', ...(wide ? { marginInlineStart: 'auto' } : { position: 'absolute', top: 2, insetInlineEnd: 2, minWidth: 16, height: 16, paddingInline: 3, borderRadius: 8, fontSize: 10 }) };
}
let toastConfig = { toastPosition: 'conversation', toastEnabled: true, soundEnabled: true, sound: 'chime', readRetentionDays: 0 };
/**
 * Plays notification sounds. Built-ins are synthesised with WebAudio (nothing to fetch); uploads are
 * played through an <audio> element served by the exact Host route. Every factory is injectable so
 * the behaviour is testable without a real audio device.
 *
 * Autoplay policy is the one real constraint: a fresh AudioContext starts `suspended` and only a
 * user gesture can resume it, so `unlock()` runs on the first click/keypress and `play()` reports
 * `locked` instead of pretending it made a sound.
 */
export function createSoundPlayer({ audio = globalThis, AudioContextClass, AudioElementClass } = {}) {
  let context = null; let unlocked = false; const elements = new Set();
  // Resolved lazily: the bundle may be evaluated before the page exposes these, and tests inject fakes.
  const contextClass = () => AudioContextClass ?? audio?.AudioContext ?? audio?.webkitAudioContext;
  const elementClass = () => AudioElementClass ?? audio?.Audio;
  const create = () => { if (context) return context; const Klass = contextClass(); if (typeof Klass !== 'function') return null; try { context = new Klass(); } catch { context = null; } return context; };
  const unlock = async () => {
    const target = create();
    if (!target) return false;
    try { if (target.state === 'suspended') await target.resume(); } catch { return false; }
    unlocked = target.state === 'running';
    return unlocked;
  };
  const playPreset = (id) => {
    const notes = SOUND_PRESETS[id] ?? SOUND_PRESETS.chime;
    if (notes.length === 0) return { played: false, reason: 'silent' };
    const target = create();
    if (!target) return { played: false, reason: 'unsupported' };
    if (target.state !== 'running') return { played: false, reason: 'locked' };
    try {
      const start = target.currentTime;
      for (const note of notes) {
        const oscillator = target.createOscillator(); const gain = target.createGain();
        oscillator.type = note.type; oscillator.frequency.value = note.freq;
        gain.gain.setValueAtTime(0, start + note.at);
        gain.gain.linearRampToValueAtTime(note.gain, start + note.at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
        oscillator.connect(gain); gain.connect(target.destination);
        oscillator.start(start + note.at); oscillator.stop(start + note.at + note.dur + 0.02);
      }
      return { played: true, reason: 'played' };
    } catch { return { played: false, reason: 'failed' }; }
  };
  const playCustom = async (name) => {
    const Klass = elementClass(); if (typeof Klass !== 'function') return { played: false, reason: 'unsupported' };
    try {
      const element = new Klass(`${BASE}/sound?name=${encodeURIComponent(name)}`);
      elements.add(element);
      element.addEventListener?.('ended', () => elements.delete(element), { once: true });
      await element.play();
      return { played: true, reason: 'played' };
    } catch (error) { return { played: false, reason: error?.name === 'NotAllowedError' ? 'locked' : 'failed' }; }
  };
  return {
    unlock,
    get unlocked() { return unlocked; },
    get locked() { return Boolean(create()) && !unlocked; },
    /**
     * Play the configured sound. This deliberately plays while the page is in the background: the
     * whole point of the cue is the case where the user is in another app (a movie, an editor) and
     * cannot see the tab title flash or a browser banner. Muting a hidden page made the cue useless
     * exactly when it mattered, so visibility is no longer part of the decision.
     */
    async play(choice = toastConfig.sound, { enabled = toastConfig.soundEnabled } = {}) {
      if (!enabled) return { played: false, reason: 'disabled' };
      const parsed = parseSoundChoice(choice);
      return parsed.kind === 'custom' ? playCustom(parsed.name) : playPreset(parsed.id);
    },
    stop() { for (const element of elements) { try { element.pause?.(); } catch { /* already gone */ } } elements.clear(); },
  };
}
const soundPlayer = createSoundPlayer();
const ATTENTION_DOT = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e5484d"/></svg>')}`;
/**
 * Tab attention indicator: while the DSH tab is in the background and something is still unread, the
 * title and favicon alternate so the user notices without a sound. It stops the moment the tab is
 * looked at again, or as soon as nothing is unread (toast closed / handled / deleted), so it can
 * never nag someone who is already looking at the page.
 */
export function createAttentionIndicator({ document: doc = globalThis.document, timers = {}, intervalMs = 900, reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true } = {}) {
  const setTimer = timers.setInterval ?? globalThis.setInterval;
  const clearTimer = timers.clearInterval ?? globalThis.clearInterval;
  let timer = null; let active = false; let baseTitle = null; let baseIcon = null; let iconNode = null; let phase = false;
  const paint = () => {
    // `phase` alone carries the flash state: with reduced motion it simply never toggles, so the
    // marker stays visible without animating.
    const marked = active && phase;
    if (doc && baseTitle !== null) doc.title = marked ? `🔔 ${baseTitle}` : baseTitle;
    if (iconNode) iconNode.href = marked ? ATTENTION_DOT : baseIcon;
  };
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!active) return;
    active = false; phase = false;
    if (doc && baseTitle !== null) doc.title = baseTitle;
    if (iconNode && baseIcon !== null) iconNode.href = baseIcon;
    if (iconNode && baseIcon === null) { try { iconNode.remove(); } catch { /* gone */ } }
    iconNode = null; baseTitle = null; baseIcon = null;
  };
  return {
    get active() { return active; },
    /** Flashing is worth it only for a background tab with something still unread. */
    update({ unread = 0, visible = true } = {}) {
      const wanted = Boolean(unread > 0 && !visible);
      if (wanted === active) return;
      if (!wanted) { stop(); return; }
      if (!doc) return;
      baseTitle = doc.title ?? '';
      iconNode = doc.querySelector?.('link[rel~="icon"]') ?? null;
      if (iconNode) baseIcon = iconNode.getAttribute?.('href') ?? iconNode.href ?? null;
      active = true; phase = true; paint();
      if (reducedMotion || typeof setTimer !== 'function') return;
      timer = setTimer(() => { phase = !phase; paint(); }, intervalMs);
    },
    stop,
  };
}
const attentionIndicator = createAttentionIndicator();
export function setToastConfig(config = {}) { toastConfig = { ...toastConfig, ...config }; globalThis.dispatchEvent?.(new Event('dsh-notify:toast-config')); }
function ToastOverlay({ sessions, pendingInteractions } = {}) {
  const state = useNotificationState(); const [, refresh] = React.useState(0); const [toast, setToast] = React.useState(null); const [anchor, setAnchor] = React.useState(() => toastAnchor()); const [paused, setPaused] = React.useState(false); const [answerError, setAnswerError] = React.useState(null); const toasted = React.useRef(new Set()); const primed = React.useRef(false);
  // useSyncExternalStore keeps the hook order stable whether or not the host exposes the service.
  const pendingStore = React.useMemo(() => ({ subscribe: (listener) => pendingInteractions?.subscribe?.(listener) ?? (() => {}), getSnapshot: () => pendingInteractions?.getSnapshot?.() ?? null }), [pendingInteractions]);
  const pending = React.useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot, () => null); const toastTimer = React.useRef(null); const toastRef = React.useRef(null);
  React.useEffect(() => { const onConfig = () => refresh((n) => n + 1); globalThis.addEventListener?.('dsh-notify:toast-config', onConfig); return () => globalThis.removeEventListener?.('dsh-notify:toast-config', onConfig); }, []);
  React.useEffect(() => {
    const update = () => setAnchor(toastAnchor());
    update();
    globalThis.addEventListener?.('resize', update);
    let observer;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(update);
      const target = globalThis.document?.querySelector?.('[data-conversation-scroll]') ?? globalThis.document?.body;
      if (target) observer.observe(target);
    }
    return () => { globalThis.removeEventListener?.('resize', update); observer?.disconnect(); };
  }, []);
  React.useEffect(() => { setAnchor(toastAnchor()); }, [toast]);
  // The shell.overlay seat lives inside the official overlayLayer (z-index 20), so no z-index of
  // ours can clear the settings modal (z-index 1000). Promoting the toast to the browser top layer
  // is what actually keeps a self-test fired from 设置 visible and closable; without Popover
  // support the element stays a normal fixed toast and simply degrades to the old stacking.
  React.useEffect(() => {
    const element = toastRef.current;
    if (!toast || !element || typeof element.showPopover !== 'function') return;
    try {
      if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
      if (!element.matches?.(':popover-open')) element.showPopover();
    } catch { return; }
    return () => { try { element.hidePopover?.(); } catch { /* already detached */ } };
  }, [toast]);
  const showToast = (record) => {
    toasted.current.add(record.eventId);
    setToast(record); toastTimer.current?.destroy?.();
    void soundPlayer.play();
    const policy = toastPolicy(record, { width: globalThis.innerWidth });
    if (policy.timeoutMs) toastTimer.current = createToastTimer({ durationMs: policy.timeoutMs, onExpire: () => setToast(null) });
  };
  React.useEffect(() => {
    const local = (event) => { if (event?.detail?.localOnly) showToast(event.detail); };
    globalThis.addEventListener?.(LOCAL_TEST_EVENT, local);
    // The local path arms a countdown too, so it has to disarm on unmount like the queue does.
    return () => { globalThis.removeEventListener?.(LOCAL_TEST_EVENT, local); toastTimer.current?.destroy?.(); toastTimer.current = null; };
  }, []);
  // An open toast must not outlive the thing it asks about. The user can answer in the composer, in
  // another browser, or through the official modal, and none of those paths touch this element: the
  // toast is a snapshot, so it has to watch the two authoritative signals itself.
  const sawPending = React.useRef(false);
  React.useEffect(() => { sawPending.current = false; }, [toast?.eventId]);
  React.useEffect(() => {
    if (!toast || toast.phase !== 'open') return;
    const pendingInteraction = pendingInteractionFor(pending, toast.sessionId);
    if (pendingInteraction) sawPending.current = true;
    const live = state.records.find((record) => record.eventId === toast.eventId);
    if (!shouldCloseOpenToast({ toast, pendingInteraction, liveRecord: live, sawPending: sawPending.current })) return;
    // Resolved elsewhere means handled: stop counting it as unread too, or the bell keeps nagging
    // about something the user already answered.
    if (!toast.localOnly) void acknowledgeRecord(toast).catch(() => {});
    toastTimer.current?.destroy?.(); toastTimer.current = null; setToast(null);
  }, [pending, state.records, toast]);
  React.useEffect(() => {
    const seen = toasted.current;
    const ids = new Set(state.records.map((record) => record.eventId));
    for (const id of seen) if (!ids.has(id)) seen.delete(id);   // keep the set bounded by live records
    // A reset (clear/delete) and the first pull after mount are history: never toast them.
    if (state.reset || !primed.current) { primed.current = true; for (const id of ids) seen.add(id); return; }
    const next = toastOrder(state.records).find((record) => !seen.has(record.eventId));
    if (!next) return;
    showToast(next);
    return () => { toastTimer.current?.destroy?.(); toastTimer.current = null; };
  }, [state.records]);
  if (!toast || !toastConfig.toastEnabled || toastConfig.toastPosition === 'off') return null;
  const tone = toastTone(toast.kind);
  const narrow = layoutFor({ width: globalThis.innerWidth }).narrow;
  const timeoutMs = toastPolicy(toast, { width: globalThis.innerWidth }).timeoutMs;
  const dismiss = () => { toastTimer.current?.destroy?.(); toastTimer.current = null; setToast(null); };
  // Contract: clicking the toast acknowledges and jumps to the session it is about. Opening the
  // history list here made one click feel like "a pile of notifications" instead of navigation.
  const openHistory = () => globalThis.dispatchEvent?.(typeof Event === 'function' ? new Event(OPEN_EVENT) : { type: OPEN_EVENT });
  const activate = async () => { const target = toast; dismiss(); const result = await navigateRecord(target, sessions); if (result?.status === 'navigation-failed' || result?.status === 'failed') openHistory(); };
  // Answering here and answering in the composer mutate the same PendingQuestion.
  const source = toast ? sessionLabel(sessions, toast.sessionId) : null;
  const interaction = toast ? pendingInteractionFor(pending, toast.sessionId) : null;
  const answer = toast ? toastAnswer(toast, interaction) : null;
  const submitAnswer = async (label) => { setAnswerError(null); try { await interaction.answer(answerBatch(answer.id, label)); await acknowledgeRecord(toast).catch(() => {}); dismiss(); } catch (error) { setAnswerError(error?.message || '回答失败，请到会话里回答'); } };
  const answerButtons = () => {
    // A question/plan-review notification always offers the way into its session, even when this
    // page holds no pending interaction (already answered elsewhere, or asked in another browser).
    if (toast?.kind !== 'question' && toast?.kind !== 'plan-review') return null;
    const buttons = answer ? answer.options.map((option) => React.createElement('button', { key: option.label, type: 'button', className: 'dsh-notify-toast-answer', title: option.description, onClick: (event) => { event.stopPropagation(); void submitAnswer(option.label); } }, option.label)) : [];
    return React.createElement('div', { className: 'dsh-notify-toast-answers' }, buttons,
      React.createElement('button', { type: 'button', className: 'dsh-notify-toast-answer', 'data-variant': 'quiet', onClick: (event) => { event.stopPropagation(); void activate(); } }, '去会话里回答'),
      answerError ? React.createElement('span', { className: 'dsh-notify-toast-error', role: 'status' }, answerError) : null);
  };
  const hold = () => { setPaused(true); toastTimer.current?.pause?.(); };
  const release = () => { setPaused(false); toastTimer.current?.resume?.(); };
  return React.createElement('aside', { ref: toastRef, popover: 'manual', role: 'status', 'aria-live': 'polite', className: 'dsh-notify-toast', 'data-tone': tone,
    onClick: () => { void activate(); },
    onPointerEnter: hold, onPointerLeave: release, onFocus: hold, onBlur: release,
    style: { insetBlockStart: 'auto', insetInlineEnd: narrow ? 12 : toastConfig.toastPosition === 'viewport' ? 16 : anchor, insetInlineStart: 'auto', bottom: 'auto', top: 'calc(env(safe-area-inset-top, 0px) + var(--dsh-toast-top-offset, 56px))', width: narrow ? 'calc(100vw - 24px)' : 'min(360px, calc(100vw - 32px))' } },
    toastIcon(tone),
    React.createElement('div', { className: 'dsh-notify-toast-body' },
      source ? React.createElement('span', { className: 'dsh-notify-toast-source', title: toast.sessionId }, source) : null,
      React.createElement('strong', { className: 'dsh-notify-toast-title' }, toast.title),
      toast.body ? React.createElement('p', { className: 'dsh-notify-toast-text' }, toast.body) : null,
      answerButtons()),
    React.createElement('button', { type: 'button', className: 'dsh-notify-toast-close', 'aria-label': '关闭通知', onClick: (event) => { event.stopPropagation(); void acknowledgeRecord(toast).catch(() => {}); dismiss(); } }, '\u00d7'),
    timeoutMs ? React.createElement('span', { className: 'dsh-notify-toast-progress', 'aria-hidden': true, style: { animationDuration: `${timeoutMs}ms`, animationPlayState: paused ? 'paused' : 'running' } }) : null);
}
function BellAction({ wide, sessions }) {
  const state = useNotificationState(); const [open, setOpen] = React.useState(false); const [dialog, setDialog] = React.useState(false);
  const [tab, setTab] = React.useState('pending'); const [selected, setSelected] = React.useState(() => new Set()); const [confirming, setConfirming] = React.useState(null); const [selecting, setSelecting] = React.useState(false);
  const [page, setPage] = React.useState(1); const [busy, setBusy] = React.useState(false); const [notice, setNotice] = React.useState(null);
  const buttonRef = React.useRef(null);
  // Tab membership is snapshotted, while each row's look follows the live record: a row you just
  // confirmed fades in place (二级边框 + 二级字色) and only moves into 已读 on the next fetch.
  // Tabs are 待处理 / 历史 so the panel agrees with the badge: 待处理 is the same set the badge counts,
  // 历史 is everything else (finished work, answered questions, failures).
  const partition = React.useMemo(() => {
    const pendingIds = new Set(); const historyIds = new Set();
    for (const record of state.records) (record.phase === 'open' ? pendingIds : historyIds).add(record.eventId);
    return { pending: pendingIds, history: historyIds };
  }, [open, tab]);   // a poll must never re-order the list under the user's cursor
  const inTab = (record) => {
    const known = partition.pending.has(record.eventId) ? 'pending' : partition.history.has(record.eventId) ? 'history' : (record.phase === 'open' ? 'pending' : 'history');
    return tab === known;
  };
  const knownIds = (bucket) => state.records.filter((record) => partition[bucket].has(record.eventId));
  // The badge answers "does anything still wait on me?" — not "how much history is unread". A
  // finished task is news, not a to-do, and counting both is what made the number impossible to
  // reconcile with the toasts the user actually saw.
  const pending = state.records.filter((record) => record.phase === 'open');
  const pendingTotal = pending.length;
  const cutoff = tab === 'history' ? readRetentionCutoff(toastConfig.readRetentionDays ?? 0) : null;
  const rows = state.records.filter(inTab).filter((record) => cutoff === null || Number(record.at || 0) >= cutoff);
  const hiddenByRetention = tab === 'history' && cutoff !== null ? state.records.filter((record) => partition.history.has(record.eventId) && !record.unread && Number(record.at || 0) < cutoff).length : 0;
  const visible = rows.slice(0, page * HISTORY_PAGE);
  const selectedIds = [...selected].filter((id) => rows.some((record) => record.eventId === id));
  const narrow = layoutFor({ width: globalThis.innerWidth }).narrow;
  const close = () => { setOpen(false); setDialog(false); setSelected(new Set()); setConfirming(null); setNotice(null); setSelecting(false); buttonRef.current?.focus?.(); };
  // Explicit size + margin 0: as a popover the UA would otherwise shrink this to fit-content and
  // auto-centre it, which silently killed the dim layer and the click-outside-to-close target.
  const backdropStyle = { position: 'fixed', inset: 0, margin: 0, width: '100vw', height: '100dvh', background: 'rgb(0 0 0 / 40%)', zIndex: 999, ...(narrow ? { display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', paddingInline: 12, paddingBlockStart: 'max(12px, env(safe-area-inset-top, 0px))', paddingBlockEnd: 'max(calc(12px + 10dvh), calc(env(safe-area-inset-bottom, 0px) + 10dvh))' } : {}) };
  // `100%` (not a dvh guess) keeps the narrow panel inside the flex container's content box, which
  // already excludes the safe-area paddings; a dvh-based cap overflowed the top by ~30px on a phone.
  const panelStyle = { maxHeight: narrow ? '100%' : '60vh', overflow: 'auto', boxSizing: 'border-box', padding: 12, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', background: 'var(--ds-background-1, Canvas)', color: 'var(--ds-text-1, CanvasText)', border: '1px solid var(--ds-border-1, GrayText)', borderRadius: 8, zIndex: 1000, ...(narrow ? { position: 'relative', width: '100%', minWidth: 0 } : { position: 'fixed', insetInlineEnd: 16, bottom: 72, width: 'min(360px, calc(100vw - 32px))' }) };
  const navigateThenAck = async (record) => {
    try {
      const result = await navigateRecord(record, sessions);
      if (result?.status === 'acknowledged-without-session') setNotice('这条通知没有可打开的会话（例如自测记录，或原会话已删除），已直接标记为已读。');
      else if (result?.status === 'navigation-failed') setNotice('打不开对应的会话；这条仍保持未读，可稍后重试或点「全部标记已读」。');
      // A record that still claims to wait on the user, while this page holds no interaction for it,
      // is a leftover: settle it so the pending badge cannot get stuck on something nobody can answer.
      if (record.phase === 'open' && !pendingInteractionFor(pending, record.sessionId) && result?.status !== 'navigation-failed') {
        await settleNotificationRecord(record.eventId).catch(() => {});
        setNotice('这条已不在等待你（对应的提问/审批已结束），已标记为已处理。');
      }
    } catch (error) { setNotice(`标记已读失败：${error?.message || '未知错误'}`); }
  };
  const settleOne = (record) => runHistory(async () => {
    const result = await settleNotificationRecord(record.eventId);
    setNotice(result?.ok ? '这条已不再计入待处理。' : '这条已经处理过了。');
  });
  const settleMany = () => runHistory(async () => {
    const targets = rows.filter((record) => selected.has(record.eventId) && record.phase === 'open');
    for (const record of targets) await settleNotificationRecord(record.eventId);
    setSelected(new Set());
    setNotice(targets.length ? `已把 ${targets.length} 条标记为已处理。` : '选中的里面没有待处理的。');
  });
  const toggleSelected = (eventId) => setSelected((old) => { if (eventId === undefined) return new Set(); const next = new Set(old); if (next.has(eventId)) next.delete(eventId); else next.add(eventId); return next; });
  const runHistory = async (work) => { if (busy) return; setBusy(true); setNotice(null); try { await work(); } catch (error) { setNotice(error?.message || '操作失败'); } finally { setBusy(false); } };
  const deleteSelected = () => runHistory(async () => {
    const result = await deleteNotificationRecords({ eventIds: selectedIds, confirmed: true, onReset: emitClearReset });
    setSelected(new Set()); setConfirming(null); setPage(1);
    setNotice(`已删除 ${result.removed} 条通知${result.removed < result.requested ? `（另外 ${result.requested - result.removed} 条已不在 Host 上）` : ''}`);
  });
  const clearAll = () => runHistory(async () => {
    await clearNotificationHistory({ confirmed: true, onReset: emitClearReset });
    setSelected(new Set()); setConfirming(null); setPage(1); setNotice('通知历史已清空');
  });
  const ackAll = () => runHistory(async () => {
    const targets = unreadRecords.slice(0, ACK_ALL_CAP);
    let failed = 0;
    for (const record of targets) { try { await acknowledgeRecord(record); } catch { failed += 1; } }
    emitRecordsRead(targets.map((record) => record.eventId));
    setNotice(failed ? `已读 ${targets.length - failed} 条，${failed} 条失败` : `已把 ${targets.length} 条标为已读`);
  });
  const dialogRef = React.useRef(null);
  // dsh-mobile renders its right sidebar as a fixed drawer above the official overlay layer our seat
  // lives in, which covered this panel on remote access. The top layer is the only stacking position
  // that always wins, so the dialog is promoted exactly like the toast.
  React.useEffect(() => {
    const element = dialogRef.current;
    if (!open || !element || typeof element.showPopover !== 'function') return;
    try {
      if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
      if (!element.matches?.(':popover-open')) element.showPopover();
    } catch { return; }
    return () => { try { element.hidePopover?.(); } catch { /* already detached */ } };
  }, [open]);
  React.useEffect(() => { if (open) setPage(1); }, [open, tab]);
  React.useEffect(() => { if (!open) setSelecting(false); }, [open]);
  // The flash means "something wants your attention", so it fires for work still waiting on you and
  // for anything unread that arrived while this tab was hidden — never for a stale backlog, which is
  // what used to make it flash every time the user switched away.
  const seenWhenVisible = React.useRef(new Set());
  React.useEffect(() => {
    const sync = () => {
      const visible = !globalThis.document?.hidden;
      const unreadIds = state.records.filter((record) => record.unread).map((record) => record.eventId);
      if (visible) seenWhenVisible.current = new Set(unreadIds);
      const fresh = unreadIds.filter((id) => !seenWhenVisible.current.has(id)).length;
      const signal = pendingTotal > 0 || fresh > 0 ? 1 : 0;
      attentionIndicator.update({ unread: toastConfig.toastPosition === 'off' ? 0 : signal, visible });
    };
    sync();
    globalThis.document?.addEventListener?.('visibilitychange', sync);
    return () => globalThis.document?.removeEventListener?.('visibilitychange', sync);
  }, [state.records, pendingTotal]);
  React.useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const showHistory = () => { setOpen(true); setDialog(true); };
    globalThis.addEventListener?.('keydown', onKey); globalThis.addEventListener?.(OPEN_EVENT, showHistory);
    return () => { globalThis.removeEventListener?.('keydown', onKey); globalThis.removeEventListener?.(OPEN_EVENT, showHistory); };
  }, []);
  const historyRow = (record) => {
    const source = sessionLabel(sessions, record.sessionId);
    return React.createElement('li', { key: record.eventId, className: 'dsh-notify-history-row', 'data-read': record.unread ? 'false' : 'true', 'data-selecting': selecting ? 'true' : 'false', 'data-settling': record.phase === 'open' && !selecting ? 'true' : 'false' },
      selecting ? React.createElement('input', { type: 'checkbox', className: 'dsh-notify-history-check', 'aria-label': `选择通知：${record.title}`, checked: selected.has(record.eventId), onChange: () => toggleSelected(record.eventId) }) : null,
      React.createElement('button', { type: 'button', className: 'dsh-notify-history-open', onClick: () => { if (selecting) { toggleSelected(record.eventId); return; } void navigateThenAck(record); } },
        React.createElement('span', { className: 'dsh-notify-history-meta' },
          React.createElement('span', { className: 'dsh-notify-history-source' }, source || '未知会话'),
          React.createElement('time', null, relativeTimeLabel(record.at))),
        React.createElement('strong', { className: 'dsh-notify-history-title' }, `${record.unread ? '● ' : ''}${record.title}`),
        record.body ? React.createElement('span', { className: 'dsh-notify-history-body' }, record.body) : null),
      record.phase === 'open' && !selecting
        ? React.createElement('button', { type: 'button', className: 'dsh-notify-history-settle', disabled: busy, title: '这条不再等你处理（不删除历史）', onClick: (event) => { event.stopPropagation(); void settleOne(record); } }, '已处理')
        : null);
  };
  const historyPanel = () => React.createElement('section', { id: 'dsh-notify-history', 'aria-label': '通知历史', onClick: (event) => event.stopPropagation(), inert: dialog ? undefined : '', style: panelStyle },
    React.createElement('div', { className: 'dsh-notify-history-head' },
      React.createElement('strong', null, state.offline ? '通知历史（同步离线）' : '通知历史'),
      React.createElement('button', { type: 'button', className: 'dsh-notify-history-close', 'aria-label': '关闭通知历史', onClick: close }, '\u00d7')),
    React.createElement('div', { className: 'dsh-notify-history-tabs', role: 'tablist' },
      React.createElement('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'pending', 'data-active': tab === 'pending', onClick: () => setTab('pending') }, `待处理 ${pendingTotal}`),
      React.createElement('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'history', 'data-active': tab === 'history', onClick: () => setTab('history') }, `历史 ${knownIds('history').length}`)),
    React.createElement('div', { className: 'dsh-notify-history-actions' },
      selecting
        ? React.createElement(React.Fragment, null,
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || visible.length === 0, onClick: () => setSelected(new Set(rows.map((record) => record.eventId))) }, '全选'),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || selectedIds.length === 0, onClick: () => toggleSelected() }, '清除选择'),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || selectedIds.length === 0, onClick: () => void settleMany() }, '标记已处理'),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || selectedIds.length === 0, onClick: () => setConfirming('delete') }, `删除选中${selectedIds.length ? `（${selectedIds.length}）` : ''}`),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', 'data-variant': 'danger', disabled: busy, onClick: () => setConfirming('clear') }, '全部删除'),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', onClick: () => { setSelected(new Set()); setSelecting(false); setConfirming(null); } }, '完成'))
        : React.createElement(React.Fragment, null,
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || state.records.every((record) => !record.unread), onClick: () => void ackAll() }, '全部标记已读'),
          React.createElement('button', { type: 'button', className: 'dsh-notify-action', disabled: busy || rows.length === 0, onClick: () => setSelecting(true) }, '选择…'))),
    confirming === 'delete' && React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': '确认删除选中通知' },
      hint(`将删除选中的 ${selectedIds.length} 条通知；这一步不可撤销。`),
      React.createElement('div', { className: 'dsh-notify-actions' },
        React.createElement('button', { type: 'button', className: 'dsh-notify-action', 'data-variant': 'danger', disabled: busy, onClick: () => void deleteSelected() }, '确认删除'),
        React.createElement('button', { type: 'button', className: 'dsh-notify-action', onClick: () => setConfirming(null) }, '取消'))),
    confirming === 'clear' && React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': '确认清空通知历史' },
      hint('将清空 Host 上的全部通知历史与未读；这一步不可撤销。'),
      React.createElement('div', { className: 'dsh-notify-actions' },
        React.createElement('button', { type: 'button', className: 'dsh-notify-action', 'data-variant': 'danger', disabled: busy, onClick: () => void clearAll() }, '确认清空'),
        React.createElement('button', { type: 'button', className: 'dsh-notify-action', onClick: () => setConfirming(null) }, '取消'))),
    notice ? React.createElement('p', { className: 'dsh-notify-history-notice', role: 'status' }, notice) : null,
    React.createElement('p', { className: 'dsh-notify-hint' }, selecting ? '点条目或复选框勾选，然后点「删除选中」；这一步不可撤销。' : '点任一条通知即可跳到它的会话；还在等你处理的可以点「已处理」或直接回答；要批量清理时点「选择…」。'),
    hiddenByRetention > 0 ? React.createElement('p', { className: 'dsh-notify-hint' }, `按设置已隐藏 ${hiddenByRetention} 条更早的已读历史。`) : null,
    rows.length === 0
      ? React.createElement('p', { className: 'dsh-notify-hint' }, tab === 'pending' ? '没有等你处理的通知' : '还没有历史通知')
      : React.createElement('ul', { className: 'dsh-notify-history-list' }, visible.map(historyRow)),
    rows.length > visible.length ? React.createElement('button', { type: 'button', className: 'dsh-notify-history-more', onClick: () => setPage((value) => value + 1) }, `加载更多（还有 ${rows.length - visible.length} 条）`) : null);
  return React.createElement(React.Fragment, null,
    React.createElement('button', { ref: buttonRef, className: BELL_CLASS, type: 'button', onClick: () => { setOpen((value) => !value); setDialog(true); }, 'aria-expanded': open, 'aria-label': `通知${pendingTotal ? `，${pendingTotal} 条待处理` : ''}`, title: state.offline ? '通知同步离线' : '通知', style: bellActionStyle(wide) }, React.createElement('span', { 'aria-hidden': true, style: { width: wide ? 18 : 20, flex: '0 0 auto', display: 'inline-flex', justifyContent: 'center', fontSize: wide ? 16 : 18, lineHeight: 1 } }, '♧'), wide && React.createElement('span', { style: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '通知'), pendingTotal > 0 && React.createElement('span', { 'aria-label': `${pendingTotal} 条待处理`, style: bellBadgeStyle(wide) }, pendingTotal > 99 ? '99+' : String(pendingTotal))),
    open && React.createElement('div', { ref: dialogRef, popover: 'manual', role: 'dialog', 'aria-modal': true, 'aria-label': '通知历史', style: backdropStyle, onClick: close }, historyPanel()));
}
/**
 * Human name for a session, resolved from the very summary the sidebar row renders
 * (`sessions.list.getSnapshot().byId[id].displayTitle`; blank rows have no title yet).
 * Falls back to a short id so a notification is never anonymous.
 */
export function sessionLabel(sessions, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  try {
    const summary = sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
    const title = summary && summary.blank !== true && typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : '';
    if (title) return title;
  } catch { /* fall through to the id */ }
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
}
/**
 * The official question surface. `dsh-client-ui-session` publishes
 * `pendingInteractions` as a `HostObservable<ReadonlyMap<SessionId, SessionPendingInteraction>>`,
 * and the interaction for a question is the very `PendingQuestion` the in-chat composer renders.
 * Answering that same object resolves the Host waterfall, so the toast and the composer stay in
 * sync for free: whichever one answers first makes the other disappear.
 */
/**
 * Should an open toast close by itself? Two authoritative signals say yes: the record is no longer
 * open (the host settled it, seen through a pull), or this page watched it wait and the official
 * pending interaction is gone (answered in the composer, another browser or the official modal).
 * Never on an empty pending map alone — before the interaction arrives that means "not yet".
 */
export function shouldCloseOpenToast({ toast, pendingInteraction, liveRecord, sawPending = false } = {}) {
  if (!toast || toast.phase !== 'open') return false;
  if (pendingInteraction) return false;
  if (liveRecord && liveRecord.phase !== 'open') return true;
  return Boolean(sawPending);
}
export function pendingInteractionFor(pending, sessionId) {
  if (!pending || typeof pending.get !== 'function' || typeof sessionId !== 'string') return null;
  return pending.get(sessionId) ?? null;
}
/**
 * A 360px toast can only answer honestly when the request is ONE single-select question with a
 * short option list. Everything else (multi-question, multi-select, free text) must go to the
 * session, because guessing a partial batch would answer the Host with something the user never
 * chose. Returns null whenever the toast must not pretend to answer.
 */
export function toastAnswer(record, interaction) {
  if (!interaction || typeof interaction.answer !== 'function') return null;
  if (record?.kind !== 'question' && record?.kind !== 'plan-review') return null;
  const questions = Array.isArray(interaction.questions) ? interaction.questions : [];
  if (questions.length !== 1) return null;
  const question = questions[0] ?? {};
  if (question.multiSelect === true) return null;
  const options = (Array.isArray(question.options) ? question.options : []).filter((option) => option && typeof option.label === 'string' && option.label);
  if (options.length === 0 || options.length > 4) return null;
  return { id: typeof question.id === 'string' ? question.id : String(question.id ?? ''), options: options.map((option) => ({ label: option.label, description: typeof option.description === 'string' ? option.description : undefined })) };
}
/** The answer batch shape the official composer sends; an option is selected by its label. */
export function answerBatch(questionId, label) { return { answers: [{ id: questionId, selected: [label] }] }; }
// Answering in the toast acknowledges, and the auto-close that follows would acknowledge again: one
// record is acknowledged at most once per page session.
const acknowledged = new Set();
const acknowledgeRecord = async (record) => {
  if (acknowledged.has(record.eventId)) { emitRecordsRead([record.eventId]); return; }
  acknowledged.add(record.eventId);
  const result = await fetchJson('/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId: record.eventId }) });
  if (result?.ok !== true) { acknowledged.delete(record.eventId); throw new Error('ack failed'); }
  // The Host appends a change for the ack, but waiting for the next poll left the bell showing an
  // already-confirmed record as unread. Update the local copy the moment the Host confirms.
  emitRecordsRead([record.eventId]);
};
const navigateRecord = (record, sessions) => {
  if (!record?.localOnly) return navigateNotificationRecord(record, { sessions, acknowledge: acknowledgeRecord });
  emitRecordsRead([record.eventId]);
  return Promise.resolve({ status: 'acknowledged-local' });
};
function emitClearReset(result) {
  const event = typeof CustomEvent === 'function' ? new CustomEvent(CLEAR_EVENT, { detail: result }) : { type: CLEAR_EVENT, detail: result };
  globalThis.dispatchEvent?.(event);
}
/** Mark records read locally so the bell and the rows update without waiting for the next pull. */
export function emitRecordsRead(eventIds) {
  const detail = { eventIds };
  globalThis.dispatchEvent?.(typeof CustomEvent === 'function' ? new CustomEvent(READ_EVENT, { detail }) : { type: READ_EVENT, detail });
}
/** Status-line tone for the settings dot: failures read red, degraded states amber, healthy green. */
export function statusTone(text = '') {
  const value = String(text);
  if (/失败|错误/.test(value)) return 'error';
  if (/不可用|未配置/.test(value)) return 'warn';
  if (/已连接|已保存|已清空|已订阅|已退订/.test(value)) return 'ok';
  return 'idle';
}
/** Result-line tone for one self-test dimension. */
export function resultTone(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'running' || status === 'submitted') return 'active';
  return 'idle';
}
const action = (label, onClick, extra = {}) => React.createElement('button', { className: 'dsh-notify-action', type: 'button', onClick, ...extra }, label);
const hint = (children) => React.createElement('p', { className: 'dsh-notify-hint' }, children);
export function NotificationSelfTests({ config = {}, preflight = {}, sessions, request = submitSelfTest } = {}) {
  const [states, setStates] = React.useState({}); const [confirming, setConfirming] = React.useState(null);
  const run = async (dimension, options = {}) => { setStates((old) => ({ ...old, [dimension]: { status: 'running' } })); try { const result = await request(dimension, { confirmed: true, ...options }); setStates((old) => ({ ...old, [dimension]: result })); } catch (error) { setStates((old) => ({ ...old, [dimension]: { status: 'failed', reason: error?.message || '自测失败' } })); } };
  const resultView = (dimension) => { const value = states[dimension]; if (!value) return null; const observe = value.status === 'submitted' ? [action('我看到了', () => setStates((old) => ({ ...old, [dimension]: { ...old[dimension], humanObservation: 'seen' } }))), action('没有看到', () => setStates((old) => ({ ...old, [dimension]: { ...old[dimension], humanObservation: 'not-seen' } })))] : null; const cleanup = value.testRunId && ['a-history', 'navigation'].includes(dimension) ? action('清理此自测记录', async () => { try { await cleanupSelfTest(value.testRunId); setStates((old) => ({ ...old, [dimension]: { status: 'passed', reason: '仅此自测记录已清理' } })); } catch { setStates((old) => ({ ...old, [dimension]: { ...old[dimension], status: 'failed', reason: '自测记录清理失败' } })); } }) : null; return React.createElement('div', { className: 'dsh-notify-result-block' }, React.createElement('p', { className: 'dsh-notify-result', role: 'status', 'data-tone': resultTone(value.status) }, `${value.status}: ${value.reason || ''}${value.humanObservation ? `；人工：${value.humanObservation}` : ''}`), (observe || cleanup) && React.createElement('div', { className: 'dsh-notify-actions' }, observe, cleanup)); };
  const testCard = (id, title, target, button, onClick, disabled = false) => { const dimension = id.toLowerCase(); return React.createElement('article', { className: 'dsh-notify-test', 'aria-label': `${id} ${title}` }, React.createElement('div', { className: 'dsh-notify-test-head' }, React.createElement('span', { className: 'dsh-notify-test-badge', 'aria-hidden': true }, id), React.createElement('strong', { className: 'dsh-notify-test-title' }, title)), hint(target), React.createElement('div', { className: 'dsh-notify-actions' }, action(button, onClick, { disabled: disabled || states[dimension]?.status === 'running', 'aria-busy': states[dimension]?.status === 'running' })), resultView(dimension)); };
  const confirm = (dimension, label, ready, options) => confirming === dimension
    ? React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': `确认${label}` }, hint(`${label}会产生真实外发，submitted 不代表 seen。`), React.createElement('div', { className: 'dsh-notify-actions' }, action('确认发送', () => { setConfirming(null); void run(dimension, options); }), action('取消', () => setConfirming(null))))
    : action(label, () => setConfirming(dimension), { disabled: !ready });
  const current = sessions?.list?.getSnapshot?.().current;
  return React.createElement('section', { className: 'dsh-notify-card', 'aria-label': '通知自测' }, React.createElement('h3', { className: 'dsh-notify-card-title' }, '自测'), hint('只剩页面里这一条通道。测试结果区分 submitted 与人工 seen，页面加载不会自动发送。'), React.createElement('div', { className: 'dsh-notify-tests' },
    testCard('A', '页面里', '当前页面；无系统外发（会响提示音，窗口不在最前也响）', '测试页面浮层', () => { const record = createLocalSelfTestRecord(); publishLocalSelfTest(record); setStates((old) => ({ ...old, a: { status: 'passed', reason: '页面浮层已渲染；不代表真实事件 producer' } })); })),
    React.createElement('details', { className: 'dsh-notify-details' }, React.createElement('summary', null, '高级自测'),
      hint('A 持久历史只验证 Host→存储→当前页拉取；记录明确标为 a-only test，不代表真实事件 producer，且不会外发系统通知。'),
      React.createElement('div', { className: 'dsh-notify-actions' }, action('添加页内自测记录', () => setConfirming('a-history')), action('开始导航与未读测试', () => void run('navigation', { sessionId: current }), { disabled: !validSessionId(current) }), action('检查历史存储', () => setConfirming('persistence-roundtrip'))),
      confirming === 'a-history' && React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': '确认添加页内自测记录' }, hint('将写入一条可单独清理的 A-only 自测历史。'), React.createElement('div', { className: 'dsh-notify-actions' }, action('确认写入自测历史', () => { setConfirming(null); void run('a-history'); }), action('取消', () => setConfirming(null)))),
      confirming === 'persistence-roundtrip' && React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': '确认检查历史存储' }, hint('将在专用命名空间写入、读回并删除随机值。'), React.createElement('div', { className: 'dsh-notify-actions' }, action('确认检查', () => { setConfirming(null); void run('persistence-roundtrip'); }), action('取消', () => setConfirming(null)))),
      resultView('a-history'), resultView('navigation'), resultView('persistence-roundtrip'),
      ));
}
function SettingsSection({ sessions }) {
  const [config, setConfig] = React.useState(null); const [preflight, setPreflight] = React.useState({}); const [status, setStatus] = React.useState('正在加载…'); const [confirmClear, setConfirmClear] = React.useState(false);
  const [customSounds, setCustomSounds] = React.useState([]); const [soundNotice, setSoundNotice] = React.useState(null);
  const loadSounds = () => fetchJson('/sounds').then((value) => setCustomSounds(Array.isArray(value?.custom) ? value.custom : [])).catch(() => setCustomSounds([]));
  const uploadSound = async (file) => {
    setSoundNotice(`正在上传 ${file.name}…`);
    try {
      const bytes = await file.arrayBuffer();
      const result = await fetchJson('/sounds', { method: 'POST', headers: { 'x-sound-name': file.name, 'content-type': 'application/octet-stream' }, body: bytes });
      setSoundNotice(result?.ok ? `已上传 ${result.name}` : `上传失败（${result?.error || 'unknown'}）`);
      await loadSounds();
    } catch (error) { setSoundNotice(error?.status === 413 ? '文件超过 1 MB' : '上传失败：仅支持 mp3 / m4a / aac / wav / ogg / flac，且不能超过 1 MB'); }
  };
  const removeSound = async (name) => {
    try { await fetchJson('/sounds/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, name }) }); setSoundNotice(`已删除 ${name}`); } catch { setSoundNotice('删除失败'); }
    await loadSounds();
  };
  // Every button in this card must answer in the card itself: the section-level status line sits far
  // above the buttons, so clicking used to look like nothing happened at all.
  React.useEffect(() => { Promise.all([fetchJson('/config'), fetchJson('/self-test/preflight')]).then(([value, checks]) => { setConfig(value); setPreflight(checks); setToastConfig(value ?? {}); setStatus(value.persist?.persist === 'disabled' ? '持久化未配置' : '通知已连接'); }).catch(() => setStatus('通知同步不可用')); void loadSounds(); }, []);
  const update = async (patch) => { setToastConfig(patch); try { const next = await fetchJson('/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }); setConfig(next); setStatus('设置已保存'); } catch { setStatus('设置保存失败'); } };
  const clear = async () => { try { const result = await clearNotificationHistory({ confirmed: true, onReset: emitClearReset }); setConfirmClear(false); setStatus(result.status === 'cleared' ? '通知历史已清空' : status); } catch { setStatus('清空失败，历史记录保持不变'); } };
  return React.createElement('section', { className: 'dsh-notify-settings', 'aria-label': '通知设置' },
    React.createElement('h2', { className: 'dsh-notify-heading' }, '通知'),
    React.createElement('p', { className: 'dsh-notify-status', role: 'status', 'data-tone': statusTone(status) }, status),
    config && React.createElement('div', { className: 'dsh-notify-card' },
      React.createElement('h3', { className: 'dsh-notify-card-title' }, '提示通道'),
      React.createElement('label', { className: 'dsh-notify-field' }, React.createElement('span', null, '已读通知保留'),
        React.createElement('select', { className: 'dsh-notify-select', 'aria-label': '已读通知保留', value: String(config.readRetentionDays ?? 0), onChange: (event) => update({ readRetentionDays: Number(event.target.value) }) },
          React.createElement('option', { value: '0' }, '一直保留（默认）'),
          React.createElement('option', { value: '1' }, '已读 1 天后隐藏'),
          React.createElement('option', { value: '7' }, '已读 7 天后隐藏'),
          React.createElement('option', { value: '30' }, '已读 30 天后隐藏'))),
      hint('只影响「已读」列表的显示；主机侧仍按容量上限自动淘汰最早的已读记录。'),
      React.createElement('label', { className: 'dsh-notify-field' }, React.createElement('span', null, 'Toast位置'), React.createElement('select', { className: 'dsh-notify-select', 'aria-label': 'Toast位置', value: config.toastPosition || 'conversation', onChange: (event) => update({ toastPosition: event.target.value }) }, React.createElement('option', { value: 'conversation' }, '会话区右上（默认）'), React.createElement('option', { value: 'viewport' }, '屏幕右上'), React.createElement('option', { value: 'off' }, '关闭（保留铃铛历史）'))),
      hint('Toast 只是页内提示；关闭后铃铛未读与历史照常。'),
      React.createElement('label', { className: 'dsh-notify-toggle' }, React.createElement('input', { type: 'checkbox', checked: Boolean(config.subtaskNotify), onChange: (event) => update({ subtaskNotify: event.target.checked }) }), React.createElement('span', null, '子任务 / 后台任务完成时通知')),
      hint('默认关闭：每个子代理、后台任务结束都会各记一条（标题常常是命令原文），开久了会很乱。需要时再打开。')),
    config && React.createElement(NotificationSelfTests, { config, preflight, sessions }),
    config && React.createElement('div', { className: 'dsh-notify-card' },
      React.createElement('h3', { className: 'dsh-notify-card-title' }, '提示音'),
      React.createElement('label', { className: 'dsh-notify-toggle' }, React.createElement('input', { type: 'checkbox', checked: config.soundEnabled !== false, onChange: (event) => update({ soundEnabled: event.target.checked }) }), React.createElement('span', null, '页内提示音（窗口不在最前也会响）')),
      React.createElement('label', { className: 'dsh-notify-field' }, React.createElement('span', null, '声音'),
        React.createElement('select', { className: 'dsh-notify-select', 'aria-label': '提示音', value: config.sound || 'chime', onChange: (event) => update({ sound: event.target.value }) },
          BUILTIN_SOUNDS.map((id) => React.createElement('option', { key: id, value: id }, SOUND_LABELS[id] ?? id)),
          ...customSounds.map((sound) => React.createElement('option', { key: `custom:${sound.name}`, value: `custom:${sound.name}` }, `自定义：${sound.name}`)))),
      React.createElement('div', { className: 'dsh-notify-actions' },
        React.createElement('button', { className: 'dsh-notify-action', type: 'button', onClick: () => { void soundPlayer.unlock().then((ok) => soundPlayer.play(config.sound || 'chime', { enabled: true })).then((result) => setSoundNotice(result?.reason === 'locked' ? '浏览器要求先点一下页面才能出声：请再点一次「试听」' : result?.played ? '已试听' : `没出声（${result?.reason || 'unknown'}）`)); } }, '试听'),
        React.createElement('label', { className: 'dsh-notify-action', style: { cursor: 'pointer' } }, '上传声音…', React.createElement('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.ogg,.flac', style: { display: 'none' }, onChange: (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadSound(file); } }))),
      hint('窗口不在最前、标签在后台时也会响——这是「浏览器被别的应用挡住」时唯一能提醒你的方式。内置音由浏览器合成（不下载任何文件）；自定义音上传到本 profile 的数据目录，重装插件不会丢。上传上限 1 MB，仅支持 mp3 / m4a / aac / wav / ogg / flac。'),
      soundNotice ? React.createElement('p', { className: 'dsh-notify-result', role: 'status' }, soundNotice) : null,
      customSounds.length > 0 && React.createElement('div', { className: 'dsh-notify-actions' }, customSounds.map((sound) => React.createElement('button', { key: sound.name, type: 'button', className: 'dsh-notify-action', 'data-variant': 'danger', onClick: () => void removeSound(sound.name) }, `删除 ${sound.name}`)))),
    React.createElement('div', { className: 'dsh-notify-card' },
      React.createElement('h3', { className: 'dsh-notify-card-title' }, '历史'),
      hint('清空只删除 Host 历史与未读，不改变浏览器授权与推送订阅。'),
      !confirmClear ? React.createElement('div', { className: 'dsh-notify-actions' }, action('清空通知历史', () => setConfirmClear(true), { 'data-variant': 'danger' })) : React.createElement('div', { className: 'dsh-notify-confirm', role: 'group', 'aria-label': '确认清空通知历史' }, hint('确认清空？'), React.createElement('div', { className: 'dsh-notify-actions' }, action('确认清空', clear), action('取消', () => setConfirmClear(false))))));
}
export const CLIENT_COMPOSITION = Object.freeze({ service: 'slots', modules: Object.freeze(['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general']), seats: Object.freeze(['sidebar.footer.action', 'settings.section', 'shell.overlay']) });
export function mountNotifyClient({ slots, sessions, getSessions, getUiSession } = {}) {
  const status = { service: slots?.inject && slots?.register ? 'available' : 'unavailable', seats: {} };
  if (status.service === 'unavailable') return { status, destroy() {} };
  // Resolved lazily: the host may not expose the question surface at all, and the toast degrades to
  // "go to the session" without it.
  const pendingInteractions = () => getUiSession?.()?.pendingInteractions;
  const disposers = [installClientStyles(), installAudioUnlock()];
  const activate = (name, options, Component) => { status.seats[name] = 'active'; const dispose = slots.register({ name, ...options }, Component); return () => { status.seats[name] = 'waiting'; dispose?.(); }; };
  status.seats['sidebar.footer.action'] = 'waiting';
  try { disposers.push(slots.inject('sidebar.footer.action', () => activate('sidebar.footer.action', { id: 'dsh-notify-bell', order: 100, inject: () => ({ sessions: sessions ?? getSessions?.() }) }, BellAction))); } catch { status.seats['sidebar.footer.action'] = 'unavailable'; }
  status.seats['settings.section'] = 'waiting';
  try { disposers.push(slots.inject('settings.section', () => activate('settings.section', { id: 'dsh-notify', order: 100, label: '通知', inject: () => ({ sessions: sessions ?? getSessions?.() }) }, SettingsSection))); } catch { status.seats['settings.section'] = 'unavailable'; }
  status.seats['shell.overlay'] = 'waiting';
  try { disposers.push(slots.inject('shell.overlay', () => activate('shell.overlay', { id: 'dsh-notify-toast', order: 100, inject: () => ({ sessions: sessions ?? getSessions?.(), pendingInteractions: pendingInteractions() }) }, ToastOverlay))); } catch { status.seats['shell.overlay'] = 'unavailable'; }
  return { status, destroy() { for (const dispose of disposers.reverse()) dispose?.(); } };
}
export function apply(ctx) { return mountNotifyClient({ slots: ctx?.slots, getSessions: () => ctx?.get?.('sessions'), getUiSession: () => ctx?.get?.('uiSession') }); }
