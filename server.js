// Relay: phone (tracker) -> relay -> Fire TV app.
// Rooms by code. Also serves /tv

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const rooms = {};

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];

  // TV page
  if (p === '/tv') {
    try {
      const file = fs.readFileSync(
        path.join(__dirname, 'public', 'tv.html')
      );

      res.writeHead(200, {
        'Content-Type': 'text/html'
      });

      return res.end(file);
    } catch (err) {
      res.writeHead(404);
      return res.end('tv page not uploaded');
    }
  }

  // Tracker page
  if (p === '/tracker' || p === '/tracker/') {
    try {
      const file = fs.readFileSync(
        path.join(__dirname, 'public', 'posesend.html')
      );

      res.writeHead(200, {
        'Content-Type': 'text/html'
      });

      return res.end(file);
    } catch (err) {
      res.writeHead(404);
      return res.end('tracker page not uploaded');
    }
  }

  const pages = {
    '/keytest.html': 'keytest.html',
    '/camtest.html': 'camtest.html',
    '/blastertest.html': 'blastertest.html',
    '/blaster.html': 'blaster.html',
    '/handtest.html': 'handtest.html',
    '/posesend.html': 'posesend.html',
    '/fb': 'fastball.html',
    '/qb': 'qb.html',
    '/bat': 'batsend.html',
    '/qr.js': 'qr.js'
  };

  if (pages[p]) {
    try {
      const file = fs.readFileSync(
        path.join(__dirname, 'public', pages[p])
      );

      const ext = path.extname(pages[p]);

      const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png'
      };

      res.writeHead(200, {
        'Content-Type':
          contentTypes[ext] || 'application/octet-stream'
      });

      return res.end(file);
    } catch (err) {
      res.writeHead(404);
      return res.end('test page not uploaded');
    }
  }

  res.writeHead(200);
  res.end('relay ok');
});

const wss = new WebSocketServer({
  server,
  path: '/ws'
});

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;

  const room = (q.get('room') || '')
    .toUpperCase()
    .slice(0, 8);

  const role = q.get('role') === 'tv'
    ? 'tv'
    : 'phone';

  if (!room) {
    ws.close();
    return;
  }

  const r = (rooms[room] ||= {
    tv: new Set(),
    phone: new Set()
  });

  r[role].add(ws);

  const other = role === 'tv'
    ? 'phone'
    : 'tv';

  const notify = (type) => {
    r[other].forEach((s) => {
      if (s.readyState === 1) {
        s.send(JSON.stringify({
          type,
          role
        }));
      }
    });
  };

  notify('peer_joined');

  if (r[other].size > 0) {
    ws.send(JSON.stringify({
      type: 'peer_joined',
      role: other
    }));
  }

  ws.on('message', (data) => {
    let msg;

    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      return ws.send(JSON.stringify({
        type: 'pong',
        t: msg.t
      }));
    }

    r[other].forEach((s) => {
      if (s.readyState === 1) {
        s.send(JSON.stringify(msg));
      }
    });
  });

  ws.on('close', () => {
    r[role].delete(ws);
    notify('peer_left');
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`relay up on ${PORT}`);
});
