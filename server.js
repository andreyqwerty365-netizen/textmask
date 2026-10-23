import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readdirSync, statSync } from 'node:fs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/src/app.js', ['src/app.js', 'text/javascript; charset=utf-8']],
  ['/src/mask.js', ['src/mask.js', 'text/javascript; charset=utf-8']],
  ['/src/demo.js', ['src/demo.js', 'text/javascript; charset=utf-8']],
  ['/src/files.js', ['src/files.js', 'text/javascript; charset=utf-8']],
  ['/src/docx-worker.js', ['src/docx-worker.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
for (const path of readdirSync(new URL('./vendor/', import.meta.url), { recursive: true })) {
  const normalized = path.replaceAll('\\', '/');
  if (!statSync(new URL(`./vendor/${normalized}`, import.meta.url)).isFile()) continue;
  const mime = /\.m?js$/.test(normalized) ? 'text/javascript; charset=utf-8' : /\.wasm$/.test(normalized) ? 'application/wasm' : 'application/octet-stream';
  files.set(`/vendor/${normalized}`, [`vendor/${normalized}`, mime]);
}
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      request.resume();
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let file;
    try { file = files.get(new URL(request.url, 'http://127.0.0.1').pathname); } catch { /* invalid URL is a 404 */ }
    if (!file) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    try {
      const body = await readFile(new URL(file[0], import.meta.url));
      response.writeHead(200, { ...headers, 'Content-Type': file[1] });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500, headers);
      response.end('Не удалось прочитать файл приложения.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createAppServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Порт 4175 занят. Остановите другой локальный сервер.' : `Ошибка запуска: ${error.code}`);
    process.exitCode = 1;
  });
  server.listen(4175, '127.0.0.1', () => console.log('TextMask: http://127.0.0.1:4175 — Ctrl+C для остановки'));
}
