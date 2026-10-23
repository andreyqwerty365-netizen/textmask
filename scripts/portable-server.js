import { createAppServer } from '../server.js';
import { pathToFileURL } from 'node:url';

// The launcher owns stdin. Closing the pipe also stops the server after a crash.
// No HTTP shutdown route, document writes, or persistent instance files.
export async function startPortable({ port = 4175, input = process.stdin, output = process.stdout } = {}) {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const stop = () => { server.close(); server.closeAllConnections(); };
  input.once('end', stop);
  input.once('error', stop);
  input.resume();
  server.once('close', () => {
    input.removeListener('end', stop);
    input.removeListener('error', stop);
    input.pause();
  });
  output.write(`TEXTMASK_READY http://127.0.0.1:${server.address().port}\n`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPortable().catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'TEXTMASK_PORT_BUSY' : 'TEXTMASK_START_FAILED');
    process.exitCode = 1;
  });
}
