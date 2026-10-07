// Petit serveur statique pour tester l'interface dans un navigateur (optionnel).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'app');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json' };
const port = Number(process.env.PORT || 5173);
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('http://localhost:' + port));
