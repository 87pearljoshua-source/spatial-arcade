// Relay: phone (tracker) -> relay -> Fire TV app. Rooms by code. Also serves /tv.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const rooms = {}; // code -> {tv:Set, phone:Set}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/tv') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'tv.html')));
  }
  const p = req.url.split('?')[0];
  if (p === '/version') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('server v6 tennis'); }
  if (p === '/tracker') { res.writeHead(302, { Location: '/tracker/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') }); return res.end(); }
  if (p.startsWith('/tracker/')) { // the phone tracker app. Looks in public/tracker/ first, then in public/ itself (in case the files were uploaded loose).
    const pub = path.join(__dirname, 'public');
    const rel = decodeURIComponent(p.slice('/tracker/'.length)) || 'index.html';
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    const tries = [path.join(pub, 'tracker', rel), path.join(pub, rel), path.join(pub, path.basename(rel))];
    for (const t of tries) {
      const fp = path.normalize(t);
      if (!fp.startsWith(pub + path.sep)) continue;
      try { const f = fs.readFileSync(fp); res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' }); return res.end(f); } catch (e) {}
    }
    res.writeHead(404); return res.end('not found');
  }
  const pages = { '/keytest.html': 'keytest.html', '/camtest.html': 'camtest.html', '/blastertest.html': 'blastertest.html', '/blaster.html': 'blaster.html', '/handtest.html': 'handtest.html', '/posesend.html': 'posesend.html', '/fb': 'fastball.html', '/golf': 'golf.html', '/brawl': 'brawl.html', '/duel': 'duel.html', '/tennis': 'tennis.html', '/qb': 'qb.html', '/bat': 'batsend.html', '/qr.js': 'qr.js' }; // small test pages
  if (pages[p]) {
    try {
      const f = fs.readFileSync(path.join(__dirname, 'public', pages[p]));
      res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store, max-age=0' }); // never let a TV browser keep an old copy of a game page
      return res.end(f);
    } catch (e) { res.writeHead(404); return res.end('test page not uploaded'); }
  }
  res.writeHead(200); res.end('relay ok');
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const room = (q.get('room') || '').toUpperCase().slice(0, 8);
  const role = q.get('role') === 'tv' ? 'tv' : 'phone';
  if (!room) return ws.close();
  const r = (rooms[room] ||= { tv: new Set(), phone: new Set() });
  r[role].add(ws);
  const other = role === 'tv' ? 'phone' : 'tv';
  const notify = (t) => r[other].forEach(s => s.readyState === 1 && s.send(JSON.stringify({ type: t, role })));
  notify('peer_joined');
  if (r[other].size > 0) ws.send(JSON.stringify({ type: 'peer_joined', role: other })); // tell newcomer a peer is already here
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: m.t }));
    r[other].forEach(s => s.readyState === 1 && s.send(JSON.stringify(m)));
  });
  ws.on('close', () => { r[role].delete(ws); notify('peer_left'); });
});
server.listen(process.env.PORT || 8080, () => console.log('relay up'));
