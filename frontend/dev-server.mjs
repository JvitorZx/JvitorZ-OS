import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.FRONTEND_PORT || 5173);
const root = path.dirname(fileURLToPath(import.meta.url));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
    const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const filePath = path.normalize(path.join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Frontend running on http://localhost:${port}`);
});
