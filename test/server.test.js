import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

test('локальный HTTP-сервер отдаёт только разрешённые ресурсы и не принимает данные', async t => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /TextMask/);
  assert.match(index.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  for (const path of ['/src/mask.js', '/src/app.js', '/src/demo.js', '/style.css', '/favicon.svg']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/test/mask.test.js')).status, 404);
  assert.equal((await fetch(base + '/..%2FREADME.md')).status, 404);
  assert.equal((await fetch(base, { method: 'POST', body: 'synthetic' })).status, 405);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
});
