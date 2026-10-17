import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

// Execute the actual split browser bundle. Only the HTTP/module-loading boundary
// is simulated; React, the application and the creator workspace remain real.
async function page(t, { failDynamicImport = false } = {}) {
  const dom = new JSDOM(await readFile('dist/public/index.html', 'utf8'), {
    url: 'https://market.example.test/', runScripts: 'outside-only',
    pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const context = dom.getInternalVMContext(), modules = new Map(), dynamicRequests = [];
  let signedIn = false;
  dom.window.fetch = async (url) => {
    switch (new URL(url, dom.window.location.href).pathname) {
      case '/v1/me': return signedIn
        ? Response.json({ account: { id: 'fixture', name: 'Creator', email: 'creator@example.test', role: 'creator' } })
        : new Response(null, { status: 401 });
      case '/v1/auth/csrf': return Response.json({ csrf: 'fixture' });
      case '/v1/auth/login': signedIn = true; return Response.json({});
      case '/v1/auth/logout': signedIn = false; return Response.json({});
      case '/v1/packs': return Response.json({ packs: [], cursor: null });
      case '/v1/me/deletion-policy': return Response.json({ row_version: 1 });
      case '/v1/me/submissions': return Response.json({ submissions: [], cursor: null });
      default: throw Error(`Unexpected request: ${url}`);
    }
  };
  async function load(url) {
    if (!modules.has(url)) modules.set(url, (async () => new SourceTextModule(
      await readFile('dist/public' + new URL(url).pathname, 'utf8'), {
        context, identifier: url,
        importModuleDynamically: async (specifier, parent) => {
          const target = new URL(specifier, parent.identifier).href;
          dynamicRequests.push(target);
          if (failDynamicImport) throw Error('Failed to fetch dynamically imported module');
          const module = await load(target);
          if (module.status === 'unlinked') await module.link(link);
          if (module.status === 'linked') await module.evaluate();
          return module;
        },
      })
    )());
    return modules.get(url);
  }
  const link = (specifier, parent) => load(new URL(specifier, parent.identifier).href);
  const entry = await load(new URL(document.querySelector('script[type="module"]').src).href);
  await entry.link(link);
  await entry.evaluate();
  const button = (name) => [...document.querySelectorAll('button')].find(b => b.textContent === name);
  const waitFor = async (condition) => {
    for (let n = 0; n < 300; n++) {
      if (condition()) return;
      await setTimeout(10);
    }
    assert.fail(`UI did not reach the expected state: ${document.body.textContent}`);
  };
  await waitFor(() => button('登录') && !button('登录').disabled);
  const login = () => {
    document.querySelector('input[name="email"]').value = 'creator@example.test';
    document.querySelector('input[name="password"]').value = 'synthetic-password';
    button('登录').click();
  };
  return { document, button, waitFor, login, dynamicRequests };
}

test('a failed creator module keeps the catalog and sign-out usable, with localized recovery', async t => {
  const p = await page(t, { failDynamicImport: true });
  p.login();
  await p.waitFor(() => p.document.querySelector('[role="alert"]'));
  assert.match(p.document.querySelector('[role="alert"]').textContent, /创作者工作台.*加载/);
  assert.ok(p.button('刷新页面'));
  assert.match(p.document.body.textContent, /发现场景包/);
  assert.ok(p.dynamicRequests.length > 0);
  p.button('English').click();
  await p.waitFor(() => p.button('Reload page'));
  assert.match(p.document.querySelector('[role="alert"]').textContent, /Creator workspace/);
  p.button('Sign out').click();
  await p.waitFor(() => p.button('Sign in'));
  assert.equal(p.document.querySelector('[role="alert"]'), null);
});

test('anonymous browsing skips creator modules and sign-in loads the real workspace', async t => {
  const p = await page(t);
  assert.match(p.document.body.textContent, /发现场景包/);
  assert.equal(p.dynamicRequests.length, 0);
  assert.equal(p.document.querySelector('input[type="file"]'), null);
  p.login();
  await p.waitFor(() => p.document.querySelector('input[type="file"]'));
  assert.match(p.document.body.textContent, /创作者工作台/);
  assert.ok(p.button('退出登录'));
  assert.ok(p.dynamicRequests.length > 0);
  assert.equal(p.document.querySelector('[role="alert"]'), null);
});
