// Relay: phone (tracker) -> relay -> Fire TV app. Rooms by code. Also serves /tv.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const rooms = {}; // code -> {tv:Set, phone:Set}
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/tv') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'tv.html')));
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
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: m.t }));
    r[other].forEach(s => s.readyState === 1 && s.send(JSON.stringify(m)));
  });
  ws.on('close', () => { r[role].delete(ws); notify('peer_left'); });
});
server.listen(process.env.PORT || 8080, () => console.log('relay up'));
