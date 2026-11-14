'use strict';
// Kritzelphone – abhängigkeitsfreier Server (Node >= 18).
// HTTP + Server-Sent-Events für Live-Updates, alle Aktionen per POST /api/*.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const GRACE_MS = 4000; // Puffer nach Ablauf der Zeit, bis der Server selbst weiterschaltet
const CANVAS_W = 800;
const CANVAS_H = 600;
const MAX_BODY = 3 * 1024 * 1024;

const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// ---------- Hilfsfunktionen ----------

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const newId = () => crypto.randomBytes(12).toString('hex');

function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += letters[crypto.randomInt(letters.length)];
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function cleanText(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function cleanStrokes(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  let points = 0;
  for (const s of arr.slice(0, 2500)) {
    if (!s || !Array.isArray(s.p)) continue;
    const c = typeof s.c === 'string' && /^#[0-9a-f]{6}$/i.test(s.c) ? s.c.toLowerCase() : '#000000';
    const w = clamp(Math.round(Number(s.w) || 6), 1, 60);
    const p = [];
    for (let i = 0; i + 1 < s.p.length && points < 40000; i += 2) {
      p.push(
        clamp(Math.round(Number(s.p[i]) || 0), 0, CANVAS_W),
        clamp(Math.round(Number(s.p[i + 1]) || 0), 0, CANVAS_H)
      );
      points++;
    }
    if (p.length) out.push({ c, w, p });
    if (points >= 40000) break;
  }
  return out;
}

const DEFAULT_SETTINGS = { firstTime: 60, writeTime: 45, drawTime: 90 };

function cleanSettings(raw, current) {
  const s = { ...current };
  if (raw && typeof raw === 'object') {
    if (raw.firstTime !== undefined) s.firstTime = clamp(Math.round(Number(raw.firstTime) || current.firstTime), 15, 300);
    if (raw.writeTime !== undefined) s.writeTime = clamp(Math.round(Number(raw.writeTime) || current.writeTime), 15, 300);
    if (raw.drawTime !== undefined) s.drawTime = clamp(Math.round(Number(raw.drawTime) || current.drawTime), 15, 600);
  }
  return s;
}

// ---------- Räume & Spiellogik ----------

function createRoom(hostName) {
  const code = newRoomCode();
  const host = makePlayer(hostName);
  const room = {
    code,
    hostId: host.id,
    players: [host],
    settings: { ...DEFAULT_SETTINGS },
    state: 'lobby', // lobby | play | reveal
    order: [], // Spieler-IDs in zufälliger Sitzordnung (Runde r: Spieler j bearbeitet Kette (j+r)%N)
    chains: [],
    round: 0,
    deadline: 0,
    pending: new Map(),
    timer: null,
    reveal: null,
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return { room, host };
}

function makePlayer(name) {
  return { id: newId(), name, streams: new Set() };
}

const kindOf = (r) => (r === 0 ? 'write' : r % 2 === 1 ? 'draw' : 'describe');

function publicPlayer(room, p) {
  return { id: p.id, name: p.name, connected: p.streams.size > 0, host: p.id === room.hostId };
}

function viewFor(room, pid) {
  const view = {
    code: room.code,
    state: room.state,
    hostId: room.hostId,
    me: pid,
    players: room.players.map((p) => publicPlayer(room, p)),
    settings: room.settings,
    now: Date.now(),
  };
  if (room.state === 'play') {
    const N = room.order.length;
    const j = room.order.indexOf(pid);
    const r = room.round;
    view.round = r;
    view.total = N;
    view.kind = kindOf(r);
    view.deadline = room.deadline;
    view.submitted = room.pending.has(pid);
    view.submittedCount = room.pending.size;
    if (j >= 0 && r > 0) {
      const e = room.chains[(j + r) % N].entries[r - 1];
      view.input = { type: e.type, text: e.text, strokes: e.strokes, missing: !!e.missing, author: e.author };
    }
  } else if (room.state === 'reveal') {
    view.total = room.order.length;
    view.chains = room.chains.map((c) => ({ owner: c.ownerName, entries: c.entries }));
    view.reveal = room.reveal;
  }
  return view;
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, dataFn) {
  for (const p of room.players) {
    if (!p.streams.size) continue;
    const data = dataFn(p);
    for (const res of p.streams) sendEvent(res, event, data);
  }
}

const broadcastState = (room) => broadcast(room, 'state', (p) => viewFor(room, p.id));
const broadcastPresence = (room) =>
  broadcast(room, 'presence', () => ({
    hostId: room.hostId,
    players: room.players.map((p) => publicPlayer(room, p)),
  }));

function startGame(room) {
  room.order = shuffle(room.players.map((p) => p.id));
  room.chains = room.order.map((pid) => ({
    ownerName: room.players.find((p) => p.id === pid).name,
    entries: [],
  }));
  room.round = 0;
  room.state = 'play';
  room.reveal = null;
  startRound(room);
}

function roundSeconds(room, r) {
  const k = kindOf(r);
  return k === 'write' ? room.settings.firstTime : k === 'draw' ? room.settings.drawTime : room.settings.writeTime;
}

function startRound(room) {
  clearTimeout(room.timer);
  const r = room.round;
  const secs = roundSeconds(room, r);
  room.pending = new Map();
  room.deadline = Date.now() + secs * 1000;
  room.timer = setTimeout(() => endRound(room, r), secs * 1000 + GRACE_MS);
  broadcastState(room);
}

function endRound(room, r) {
  if (room.state !== 'play' || room.round !== r) return;
  clearTimeout(room.timer);
  const N = room.order.length;
  const kind = kindOf(r);
  room.order.forEach((pid, j) => {
    const player = room.players.find((p) => p.id === pid);
    let entry = room.pending.get(pid);
    if (!entry) {
      entry = kind === 'draw' ? { type: 'drawing', strokes: [], missing: true } : { type: 'text', text: '', missing: true };
    }
    room.chains[(j + r) % N].entries.push({ author: player.name, ...entry });
  });
  if (r + 1 >= N) {
    room.state = 'reveal';
    room.reveal = { chain: 0, step: 0, auto: false, finished: false };
    broadcastState(room);
  } else {
    room.round = r + 1;
    startRound(room);
  }
}

function backToLobby(room) {
  clearTimeout(room.timer);
  room.state = 'lobby';
  room.chains = [];
  room.order = [];
  room.pending = new Map();
  room.reveal = null;
  broadcastState(room);
}

// ---------- API ----------

function ctxFrom(body) {
  const room = rooms.get(String(body.room || '').toUpperCase());
  if (!room) throw fail(404, 'Raum nicht gefunden');
  const player = room.players.find((p) => p.id === body.pid);
  if (!player) throw fail(403, 'Unbekannter Spieler');
  room.lastActive = Date.now();
  return { room, player };
}

function requireHost(room, player) {
  if (room.hostId !== player.id) throw fail(403, 'Nur der Host darf das');
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/events') {
    const room = rooms.get((url.searchParams.get('room') || '').toUpperCase());
    const player = room && room.players.find((p) => p.id === url.searchParams.get('pid'));
    if (!player) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    player.streams.add(res);
    sendEvent(res, 'state', viewFor(room, player.id));
    broadcastPresence(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      player.streams.delete(res);
      if (!player.streams.size) {
        broadcastPresence(room);
        if (player.id === room.hostId) scheduleHostHandover(room, player);
      }
    });
    return;
  }

  if (route === 'GET /api/state') {
    const room = rooms.get((url.searchParams.get('room') || '').toUpperCase());
    if (!room || !room.players.some((p) => p.id === url.searchParams.get('pid'))) throw fail(404, 'Nicht gefunden');
    return sendJson(res, 200, viewFor(room, url.searchParams.get('pid')));
  }

  if (req.method !== 'POST') throw fail(404, 'Nicht gefunden');
  const body = await readJson(req);

  switch (url.pathname) {
    case '/api/create': {
      const name = cleanName(body.name);
      if (!name) throw fail(400, 'Bitte gib einen Namen ein');
      const { room, host } = createRoom(name);
      return sendJson(res, 200, { code: room.code, pid: host.id, name });
    }

    case '/api/join': {
      const room = rooms.get(String(body.code || '').toUpperCase());
      if (!room) throw fail(404, 'Diesen Raum gibt es nicht (mehr)');
      room.lastActive = Date.now();
      const existing = body.pid && room.players.find((p) => p.id === body.pid);
      if (existing) return sendJson(res, 200, { code: room.code, pid: existing.id, name: existing.name });
      if (room.state !== 'lobby') throw fail(403, 'Das Spiel läuft schon – warte auf die nächste Runde');
      if (room.players.length >= MAX_PLAYERS) throw fail(403, `Der Raum ist voll (max. ${MAX_PLAYERS})`);
      let name = cleanName(body.name);
      if (!name) throw fail(400, 'Bitte gib einen Namen ein');
      const base = name;
      let n = 2;
      while (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${base.slice(0, 13)} ${n++}`;
      const player = makePlayer(name);
      room.players.push(player);
      broadcastPresence(room);
      return sendJson(res, 200, { code: room.code, pid: player.id, name });
    }

    case '/api/settings': {
      const { room, player } = ctxFrom(body);
      requireHost(room, player);
      if (room.state !== 'lobby') throw fail(409, 'Einstellungen nur in der Lobby');
      room.settings = cleanSettings(body.settings, room.settings);
      broadcastState(room);
      return sendJson(res, 200, { ok: true });
    }

    case '/api/start': {
      const { room, player } = ctxFrom(body);
      requireHost(room, player);
      if (room.state !== 'lobby') throw fail(409, 'Das Spiel läuft schon');
      if (room.players.length < MIN_PLAYERS) throw fail(400, `Mindestens ${MIN_PLAYERS} Spieler nötig`);
      startGame(room);
      return sendJson(res, 200, { ok: true });
    }

    case '/api/submit': {
      const { room, player } = ctxFrom(body);
      if (room.state !== 'play') throw fail(409, 'Gerade läuft keine Runde');
      if (Number(body.round) !== room.round) throw fail(409, 'Diese Runde ist schon vorbei');
      if (!room.order.includes(player.id)) throw fail(403, 'Du spielst in dieser Runde nicht mit');
      if (room.pending.has(player.id)) return sendJson(res, 200, { ok: true });
      const kind = kindOf(room.round);
      const entry =
        kind === 'draw'
          ? (() => {
              const strokes = cleanStrokes(body.strokes);
              return { type: 'drawing', strokes, missing: strokes.length === 0 };
            })()
          : (() => {
              const text = cleanText(body.text);
              return { type: 'text', text, missing: text === '' };
            })();
      room.pending.set(player.id, entry);
      if (room.pending.size >= room.order.length) {
        endRound(room, room.round);
      } else {
        for (const s of player.streams) sendEvent(s, 'state', viewFor(room, player.id));
        broadcast(room, 'progress', () => ({ round: room.round, submittedCount: room.pending.size }));
      }
      return sendJson(res, 200, { ok: true });
    }

    case '/api/reveal': {
      const { room, player } = ctxFrom(body);
      requireHost(room, player);
      if (room.state !== 'reveal') throw fail(409, 'Keine Auflösung aktiv');
      const rv = room.reveal;
      const N = room.chains.length;
      const lastStep = (c) => room.chains[c].entries.length - 1;
      switch (body.action) {
        case 'next':
          if (rv.finished) break;
          if (rv.step < lastStep(rv.chain)) rv.step++;
          else if (rv.chain < N - 1) {
            rv.chain++;
            rv.step = 0;
          } else rv.finished = true;
          break;
        case 'prev':
          if (rv.finished) {
            rv.finished = false;
          } else if (rv.step > 0) rv.step--;
          else if (rv.chain > 0) {
            rv.chain--;
            rv.step = lastStep(rv.chain);
          }
          break;
        case 'nextChain':
          if (rv.finished) break;
          if (rv.chain < N - 1) {
            rv.chain++;
            rv.step = 0;
          } else {
            rv.finished = true;
          }
          break;
        case 'auto':
          rv.auto = !!body.value;
          break;
        case 'restart':
          room.reveal = { chain: 0, step: 0, auto: false, finished: false };
          break;
        default:
          throw fail(400, 'Unbekannte Aktion');
      }
      broadcast(room, 'reveal', () => room.reveal);
      return sendJson(res, 200, { ok: true });
    }

    case '/api/lobby': {
      const { room, player } = ctxFrom(body);
      requireHost(room, player);
      backToLobby(room);
      return sendJson(res, 200, { ok: true });
    }

    default:
      throw fail(404, 'Nicht gefunden');
  }
}

// Wenn der Host länger weg ist, bekommt ein anderer verbundener Spieler die Host-Rechte.
function scheduleHostHandover(room, oldHost) {
  setTimeout(() => {
    if (!rooms.has(room.code) || room.hostId !== oldHost.id || oldHost.streams.size) return;
    const next = room.players.find((p) => p.streams.size > 0);
    if (!next) return;
    room.hostId = next.id;
    broadcastState(room);
  }, 30000);
}

// ---------- Static Files ----------

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ---------- Start ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    if (res.headersSent) return res.end();
    sendJson(res, err.status || 500, { error: err.status ? err.message : 'Serverfehler' });
    if (!err.status) console.error(err);
  }
});

// Verwaiste Räume nach 6 Stunden ohne Aktivität und ohne Verbindung aufräumen.
setInterval(() => {
  for (const [code, room] of rooms) {
    const connected = room.players.some((p) => p.streams.size > 0);
    if (!connected && Date.now() - room.lastActive > 6 * 3600 * 1000) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 15 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Kritzelphone läuft auf http://localhost:${PORT}`));
}

module.exports = { server };
