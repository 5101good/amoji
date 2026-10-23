import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { AmojiImage } from '../src/dsh/media.js';
import { DEFAULT_PREFERENCES } from '../src/library-management.js';
import { builtin } from './helpers/builtin-expressions.js';

test('reduce_motion 偏好决定动图显示封面还是播放，且可手动切换', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  t.after(() => Object.assign(globalThis, old));
  const { expressions, dataUrl } = await builtin();
  const e = expressions.find(x => x.visual.animated && x.visual.poster)!;
  const primary = dataUrl(e.visual.primary); const poster = dataUrl(e.visual.poster!);
  const rpc: any = {
    management: async () => ({ version: 1, ...DEFAULT_PREFERENCES, reduce_motion: 'on' }),
    visual: async () => ({ expression: e, primary, poster }),
    display: async () => null,
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const { act } = React;
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  await act(async () => { root.render(React.createElement(AmojiImage, { rpc, sessionId: 's', refValue: { asset_id: e.asset_id, revision_id: e.revision_id } })); await settle(); await settle(); });
  assert.equal(dom.window.document.querySelector('img')!.src, poster, '偏好“减少动态效果”时显示封面');
  const play = [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === '播放动图')!;
  await act(() => play.click());
  assert.equal(dom.window.document.querySelector('img')!.src, primary, '仍可手动播放');
  await act(async () => root.unmount());
});
