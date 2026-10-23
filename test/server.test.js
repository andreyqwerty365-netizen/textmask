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
  assert.match(index.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  for (const path of ['/src/mask.js', '/src/app.js', '/src/demo.js', '/src/files.js', '/src/docx-worker.js', '/style.css', '/favicon.svg', '/vendor/mammoth/mammoth.browser.min.js', '/vendor/pdfjs/build/pdf.mjs', '/vendor/tesseract/dist/worker.min.js', '/vendor/tessdata/rus.traineddata']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/test/mask.test.js')).status, 404);
  assert.equal((await fetch(base + '/work/files/fixtures/sample.txt')).status, 404);
  const wasm = await fetch(base + '/vendor/ocr-core/tesseract-core-lstm.wasm', { method: 'HEAD' });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(base + '/..%2FREADME.md')).status, 404);
  assert.equal((await fetch(base, { method: 'POST', body: 'synthetic' })).status, 405);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
});
