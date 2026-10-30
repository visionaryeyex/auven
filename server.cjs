const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {handler} = require('./api-handler.cjs');

const files = new Map([
  ['index.html', 'text/html'],
  ['style.css', 'text/css'],
  ['dashboard.css', 'text/css'],
  ['marketing.css', 'text/css'],
  ['marketing.js', 'text/javascript'],
  ['app.js', 'text/javascript'],
  ['auth.js', 'text/javascript'],
  ['logo-mark.svg', 'image/svg+xml'],
  ['logo-mark-white.svg', 'image/svg+xml'],
  ['logo-horizontal.svg', 'image/svg+xml'],
  ['favicon.svg', 'image/svg+xml'],
  ['fonts/Geist.woff2', 'font/woff2']
]);

const port = Number(process.env.PORT || 4174);
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const name = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  const contentType = files.get(name);
  if (!contentType) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {'content-type': contentType});
  fs.createReadStream(path.join(__dirname, 'dist', name)).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`AUVEN http://127.0.0.1:${port}`));

