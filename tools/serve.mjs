#!/usr/bin/env node
/**
 * Minimal static file server for local development, so the ES module version
 * of the page can be opened over http:// instead of file://.
 *
 *     node tools/serve.mjs [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${port}`);
    let filePath = path.join(root, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = path.join(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(port, () => {
  console.log(`serving ${root}`);
  console.log(`open http://localhost:${port}/`);
});
