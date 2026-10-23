import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';

const { startPortable } = await import('../scripts/portable-server.js').catch(() => ({}));

test('portable lifecycle: ready only after listening, close when launcher disconnects', async () => {
  assert.equal(typeof startPortable, 'function', 'portable server lifecycle is implemented');
  const input = new PassThrough();
  const output = new PassThrough();
  let message = '';
  output.on('data', part => { message += part; });
  const server = await startPortable({ port: 0, input, output });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    assert.equal(message, `TEXTMASK_READY ${url}\n`);
    assert.equal((await fetch(url)).status, 200);
    const closed = once(server, 'close');
    input.end();
    await closed;
    assert.equal(server.listening, false);
  } finally { server.close(); }
});

test('portable lifecycle: occupied port is rejected without claiming ready or stopping owner', async () => {
  assert.equal(typeof startPortable, 'function', 'portable server lifecycle is implemented');
  const firstInput = new PassThrough();
  const first = await startPortable({ port: 0, input: firstInput, output: new PassThrough() });
  const output = new PassThrough();
  let message = '';
  output.on('data', part => { message += part; });
  try {
    await assert.rejects(startPortable({ port: first.address().port, input: new PassThrough(), output }), { code: 'EADDRINUSE' });
    assert.equal(message, '');
    assert.equal((await fetch(`http://127.0.0.1:${first.address().port}`)).status, 200);
  } finally { firstInput.end(); first.close(); }
});
