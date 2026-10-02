const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const root = '/home/site/wwwroot';
const port = Number(process.env.PORT || 8080);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

function sendError(response, statusCode, message) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch (error) {
    sendError(response, 400, 'Bad Request');
    return;
  }

  const relativePath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const candidatePath = path.resolve(root, `.${relativePath}`);
  if (candidatePath !== root && !candidatePath.startsWith(`${root}${path.sep}`)) {
    sendError(response, 403, 'Forbidden');
    return;
  }

  fs.stat(candidatePath, (statError, stats) => {
    if (statError) {
      if (statError.code === 'ENOENT') {
        sendError(response, 404, 'Not Found');
        return;
      }
      console.error(statError);
      sendError(response, 500, 'Internal Server Error');
      return;
    }

    const filePath = stats.isDirectory() ? path.join(candidatePath, 'index.html') : candidatePath;
    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        if (readError.code === 'ENOENT') {
          sendError(response, 404, 'Not Found');
          return;
        }
        console.error(readError);
        sendError(response, 500, 'Internal Server Error');
        return;
      }

      const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    });
  });
});

server.listen(port, () => {
  console.log(`Static server listening on port ${port}`);
});
