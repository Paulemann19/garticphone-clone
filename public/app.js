'use strict';
// Kritzelphone – Client

const W = 800;
const H = 600;
const COLORS = ['#000000', '#6b7280', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e'];
const SIZES = [4, 10, 22];
const IDEAS = [
  'Ein Pinguin im Büro', 'Oma fährt Achterbahn', 'Ein Hund hält eine Rede', 'Der Mond bekommt einen Haarschnitt',
  'Ein Toaster auf Weltreise', 'Drei Enten im Fahrstuhl', 'Ein Dinosaurier beim Zahnarzt', 'Pizza auf dem Mount Everest',
  'Ein Ninja kauft Gemüse ein', 'Die Katze sitzt im Homeoffice', 'Ein Roboter hat Liebeskummer', 'Eine Giraffe im Schwimmbad',
  'Opa spielt E-Gitarre', 'Ein Wal im Wohnzimmer', 'Der Weihnachtsmann im Sommerurlaub', 'Ein Pirat verläuft sich im Supermarkt',
  'Ein Geist macht die Steuererklärung', 'Zwei Kühe spielen Tennis', 'Ein Fahrrad mit Flügeln', 'Der Postbote wird gejagt',
  'Ein Hamster auf Weltherrschaft', 'Schnecken-Rennen in Zeitlupe', 'Ein Zauberer verliert seinen Hut', 'Der Eiffelturm hat Schnupfen',
  'Ein Alien lernt Skateboard fahren', 'Käse-Burger mit Sonnenbrille', 'Ein Bär backt Kuchen', 'Die Sonne hat Montagsstimmung',
];

const S = {
  session: loadSession(), // {code, pid, name}
  view: null,
  es: null,
  offset: 0, // Serverzeit - lokale Zeit
  ui: null, // aktueller UI-Zustand der Runde
  timers: new Set(),
  cancelAnim: null,
};

// ---------- kleine Helfer ----------

const $app = document.getElementById('app');

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem('kritzel-session')) || null; } catch { return null; }
}
function saveSession(s) {
  S.session = s;
  try { s ? localStorage.setItem('kritzel-session', JSON.stringify(s)) : localStorage.removeItem('kritzel-session'); } catch {}
}
function lastName() {
  try { return localStorage.getItem('kritzel-name') || ''; } catch { return ''; }
}
function rememberName(n) {
  try { localStorage.setItem('kritzel-name', n); } catch {}
}

async function api(path, body) {
  const r = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Etwas ist schiefgelaufen');
  return j;
}
const act = (path, extra) => api(path, { room: S.session.code, pid: S.session.pid, ...extra });

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function banner(msg) {
  const b = document.getElementById('banner');
  b.textContent = msg || '';
  b.hidden = !msg;
}

function clearTimers() {
  for (const t of S.timers) { clearInterval(t); clearTimeout(t); }
  S.timers.clear();
  if (S.cancelAnim) { S.cancelAnim(); S.cancelAnim = null; }
}
function later(fn, ms) {
  const t = setTimeout(() => { S.timers.delete(t); fn(); }, ms);
  S.timers.add(t);
  return t;
}

const AV_COLORS = ['#6c4cff', '#ff5c8a', '#19b36b', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#0ea5e9', '#d946ef', '#84cc16', '#f97316', '#14b8a6'];
function avatar(name) {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return h('div', { class: 'avatar', style: `background:${AV_COLORS[sum % AV_COLORS.length]}` }, (name[0] || '?').toUpperCase());
}

const isHost = () => S.view && S.view.hostId === S.view.me;

// ---------- Zeichnen: gemeinsamer Code ----------
// Eine Zeichnung ist eine Liste von Operationen:
//   Stift/Radierer {c,w,p:[x,y,...]} · Füllen {t:'fill',c,x,y} · Form {t:'shape',k,c,w,f,a:[x1,y1,x2,y2]}
// Beim Abspielen werden sie in derselben Reihenfolge ausgeführt, dadurch sieht die Animation exakt wie das Original aus.

const SHAPES = ['line', 'rect', 'ellipse', 'triangle'];

function buildSteps(ops) {
  const steps = [];
  for (const o of ops) {
    if (o.t === 'fill' || o.t === 'shape') { steps.push(o); continue; }
    const p = o.p;
    if (!p || p.length < 2) continue;
    if (p.length === 2) steps.push([o.c, o.w, p[0], p[1], p[0], p[1]]);
    for (let i = 2; i + 1 < p.length; i += 2) steps.push([o.c, o.w, p[i - 2], p[i - 1], p[i], p[i + 1]]);
  }
  return steps;
}
function drawSeg(ctx, g) {
  ctx.strokeStyle = g[0];
  ctx.fillStyle = g[0];
  ctx.lineWidth = g[1];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (g[2] === g[4] && g[3] === g[5]) {
    ctx.arc(g[2], g[3], g[1] / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(g[2], g[3]);
    ctx.lineTo(g[4], g[5]);
    ctx.stroke();
  }
}
function drawShape(ctx, s) {
  const [x1, y1, x2, y2] = s.a;
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (s.k === 'line') {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  } else if (s.k === 'rect') {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (s.k === 'ellipse') {
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(1, Math.abs(x2 - x1) / 2), Math.max(1, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
  } else if (s.k === 'triangle') {
    ctx.moveTo((x1 + x2) / 2, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x1, y2);
    ctx.closePath();
  }
  if (s.f && s.k !== 'line') ctx.fill();
  else ctx.stroke();
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Flächen füllen (Scanline-Flood-Fill mit Toleranz, damit auch die weichen Ränder der Striche mitgefüllt werden).
// Gibt false zurück, wenn sich nichts geändert hat.
function floodFill(ctx, sx, sy, hex) {
  sx = Math.max(0, Math.min(W - 1, sx | 0));
  sy = Math.max(0, Math.min(H - 1, sy | 0));
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const i0 = (sy * W + sx) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  const [fr, fg, fb] = hexRgb(hex);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 12) return false;
  const TOL = 150;
  const seen = new Uint8Array(W * H);
  const ok = (p) => { const i = p * 4; return Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= TOL; };
  const stack = [[sx, sy]];
  let count = 0;
  while (stack.length) {
    const [x0, y] = stack.pop();
    let x = x0;
    let p = y * W + x;
    if (seen[p] || !ok(p)) continue;
    while (x > 0 && !seen[p - 1] && ok(p - 1)) { x--; p--; }
    let up = false, down = false;
    while (x < W && !seen[p] && ok(p)) {
      seen[p] = 1;
      const i = p * 4;
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      count++;
      if (y > 0) {
        const o = p - W;
        const m = !seen[o] && ok(o);
        if (m && !up) { stack.push([x, y - 1]); up = true; } else if (!m) up = false;
      }
      if (y < H - 1) {
        const o = p + W;
        const m = !seen[o] && ok(o);
        if (m && !down) { stack.push([x, y + 1]); down = true; } else if (!m) down = false;
      }
      x++; p++;
    }
  }
  if (!count) return false;
  ctx.putImageData(img, 0, 0);
  return true;
}
function runStep(ctx, st) {
  if (Array.isArray(st)) drawSeg(ctx, st);
  else if (st.t === 'fill') floodFill(ctx, st.x, st.y, st.c);
  else drawShape(ctx, st);
}
function whiteout(ctx) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
}
function makeCanvas(cls) {
  const c = h('canvas', { class: cls, width: W, height: H });
  whiteout(c.getContext('2d'));
  return c;
}
function drawStatic(canvas, ops) {
  const ctx = canvas.getContext('2d');
  whiteout(ctx);
  for (const st of buildSteps(ops)) runStep(ctx, st);
}
// Spielt eine Zeichnung ab. Die ersten `from` Operationen (das übernommene Vorgängerbild) stehen sofort da,
// der Rest wird Schritt für Schritt gezeichnet. Gibt eine Abbruch-Funktion zurück.
function animateStrokes(canvas, ops, from, onDone) {
  const ctx = canvas.getContext('2d');
  whiteout(ctx);
  for (const st of buildSteps(ops.slice(0, from))) runStep(ctx, st);
  const steps = buildSteps(ops.slice(from));
  if (!steps.length) { onDone && later(onDone, 900); return () => {}; }
  const duration = Math.min(10000, Math.max(2500, steps.length * 7));
  const start = performance.now();
  let drawn = 0;
  let raf = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    const p = Math.min(1, (now - start) / duration);
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // Ease-in/out
    const target = Math.floor(eased * steps.length);
    while (drawn < target) runStep(ctx, steps[drawn++]);
    if (p < 1) raf = requestAnimationFrame(tick);
    else {
      while (drawn < steps.length) runStep(ctx, steps[drawn++]);
      onDone && onDone();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// Mini-Film: blättert die Bilder einer Kette in Endlosschleife durch.
function makeFlipbook(entries) {
  const canvas = makeCanvas('rcanvas');
  const ctx = canvas.getContext('2d');
  const frames = entries.map((e) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    drawStatic(c, e.strokes);
    return c;
  });
  let i = 0;
  const show = () => ctx.drawImage(frames[i], 0, 0);
  return {
    el: canvas,
    start() {
      show();
      if (frames.length < 2) return;
      const t = setInterval(() => { i = (i + 1) % frames.length; show(); }, 700);
      S.timers.add(t);
    },
  };
}

function typewriter(el, text, onDone) {
  el.textContent = '';
  el.classList.add('cursor');
  const chars = Array.from(text);
  const step = Math.max(18, Math.min(60, 2200 / Math.max(1, chars.length)));
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.textContent = chars.slice(0, i).join('');
    if (i >= chars.length) {
      clearInterval(t);
      S.timers.delete(t);
      el.classList.remove('cursor');
      onDone && onDone();
    }
  }, step);
  S.timers.add(t);
}

// ---------- Verbindung ----------

function connect() {
  if (S.es) S.es.close();
  const { code, pid } = S.session;
  const es = new EventSource(`/api/events?room=${encodeURIComponent(code)}&pid=${encodeURIComponent(pid)}`);
  S.es = es;
  es.addEventListener('state', (e) => {
    banner('');
    const v = JSON.parse(e.data);
    S.offset = v.now - Date.now();
    S.view = v;
    render();
  });
  es.addEventListener('presence', (e) => {
    if (!S.view) return;
    const d = JSON.parse(e.data);
    const hostChanged = S.view.hostId !== d.hostId;
    S.view.players = d.players;
    S.view.hostId = d.hostId;
    if (S.view.state === 'lobby') render();
    else if (hostChanged && S.view.state === 'reveal') render();
  });
  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    if (S.view && S.view.state === 'play' && S.view.round === d.round) {
      S.view.submittedCount = d.submittedCount;
      updateCount();
    }
  });
  es.addEventListener('reveal', (e) => {
    if (!S.view || S.view.state !== 'reveal') return;
    S.view.reveal = JSON.parse(e.data);
    render();
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      // Server kennt uns nicht mehr (Neustart / Raum weg)
      saveSession(null);
      S.view = null;
      banner('');
      render();
      toast('Der Raum existiert nicht mehr.');
    } else {
      banner('Verbindung unterbrochen – verbinde neu …');
    }
  };
}

// ---------- Rendering ----------

function render() {
  const v = S.view;
  if (!v) { S.ui = null; clearTimers(); return renderHome(); }
  if (v.state === 'lobby') { S.ui = null; clearTimers(); return renderLobby(); }
  if (v.state === 'play') return renderPlay();
  if (v.state === 'reveal') { S.ui = null; return renderReveal(); }
}

function setView(...nodes) {
  $app.replaceChildren(...nodes);
}

// --- Startseite ---

function renderHome() {
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('room') || '').toUpperCase().slice(0, 4);
  const name = h('input', { type: 'text', maxlength: 16, placeholder: 'Dein Name', value: lastName(), autocomplete: 'nickname' });
  const code = h('input', { type: 'text', class: 'code-input', maxlength: 4, placeholder: 'CODE', value: urlCode, autocapitalize: 'characters' });

  const go = async (mode) => {
    const n = name.value.trim();
    if (!n) { toast('Bitte gib erst deinen Namen ein.'); name.focus(); return; }
    rememberName(n);
    try {
      const r = mode === 'create' ? await api('create', { name: n }) : await api('join', { code: code.value, name: n });
      saveSession({ code: r.code, pid: r.pid, name: r.name });
      history.replaceState(null, '', '/?room=' + r.code);
      connect();
    } catch (e) { toast(e.message); }
  };

  setView(
    h('div', { class: 'hero' },
      h('div', { class: 'logo' }, '✏️📞'),
      h('h1', {}, 'Kritzelphone'),
      h('p', {}, 'Schreiben, zeichnen, beschreiben – und am Ende lachen, was aus dem Satz geworden ist.')),
    h('div', { class: 'card stack' },
      h('div', {}, h('label', {}, 'Wie heißt du?'), name),
      urlCode
        ? h('div', { class: 'stack' },
            h('p', { class: 'muted center' }, `Du wurdest in Raum ${urlCode} eingeladen.`),
            h('button', { class: 'big', style: 'width:100%', onclick: () => go('join') }, 'Raum beitreten'),
            h('div', { class: 'divider' }, 'oder'),
            h('button', { class: 'ghost', style: 'width:100%', onclick: () => go('create') }, 'Stattdessen neuen Raum erstellen'))
        : h('div', { class: 'stack' },
            h('button', { class: 'big', style: 'width:100%', onclick: () => go('create') }, 'Neuen Raum erstellen'),
            h('div', { class: 'divider' }, '— oder einem Raum beitreten —'),
            h('div', { class: 'row' }, h('div', { class: 'grow' }, code), h('button', { class: 'ghost', onclick: () => go('join') }, 'Beitreten')))),
    h('p', { class: 'muted center' }, 'Ab 3 Spielern · am besten zu sechst')
  );
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(urlCode ? 'join' : 'create'); });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('join'); });
}

// --- Lobby ---

function renderLobby() {
  const v = S.view;
  const host = isHost();
  const link = `${location.origin}/?room=${v.code}`;
  const linkInput = h('input', { type: 'text', readonly: true, value: link });

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link kopiert!'); }
    catch { linkInput.select(); toast('Link markiert – jetzt kopieren (Strg+C).'); }
  };

  const setting = (key, label, opts) => {
    const sel = h('select', { disabled: !host, onchange: () => act('settings', { settings: { [key]: Number(sel.value) } }).catch((e) => toast(e.message)) },
      opts.map((o) => h('option', { value: o, selected: v.settings[key] === o }, o >= 60 && o % 60 === 0 ? `${o / 60} Min.` : `${o} Sek.`)));
    return h('div', {}, h('label', {}, label), sel);
  };

  const enough = v.players.length >= 3;
  const anim = v.settings.mode === 'animation';
  const modeCard = (m, title, desc) =>
    h('button', {
      class: 'modecard' + (v.settings.mode === m ? ' sel' : ''),
      disabled: !host,
      onclick: () => act('settings', { settings: { mode: m } }).catch((e) => toast(e.message)),
    }, h('strong', {}, title), h('span', {}, desc));
  setView(
    h('div', { class: 'card center' },
      h('p', { class: 'muted' }, 'Raumcode'),
      h('div', { class: 'roomcode' }, v.code),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('div', { class: 'grow' }, linkInput), h('button', { onclick: copy }, 'Link kopieren')),
      h('p', { class: 'muted', style: 'margin-top:10px' }, 'Schick den Link an deine Freunde.')),
    h('div', { class: 'card' },
      h('h3', {}, `Spieler (${v.players.length})`),
      h('div', { class: 'players' },
        v.players.map((p) => h('div', { class: 'chip' + (p.connected ? '' : ' off') }, avatar(p.name), p.name + (p.host ? ' 👑' : '') + (p.id === v.me ? ' (du)' : ''))))),
    h('div', { class: 'card' },
      h('h3', {}, 'Spielmodus'),
      h('div', { class: 'modes' },
        modeCard('normal', '🎨 Normal', 'Schreiben → Zeichnen → Beschreiben → Zeichnen …'),
        modeCard('animation', '🎞️ Animation', 'Eine Idee, dann zeichnet ihr reihum das nächste Bild. Das Bild des Vorgängers bleibt stehen (oder wird gelöscht). Am Ende läuft jede Kette als Mini-Film.')),
      !host && h('p', { class: 'muted', style: 'margin-top:10px' }, 'Den Modus wählt der Host.')),
    h('div', { class: 'card' },
      h('h3', {}, 'Zeit pro Runde'),
      h('div', { class: 'settings' },
        setting('firstTime', anim ? '✍️ Idee schreiben' : '✍️ Satz schreiben', [30, 45, 60, 90, 120]),
        setting('drawTime', anim ? '🎨 Pro Bild' : '🎨 Zeichnen', [30, 45, 60, 90, 120, 180]),
        !anim && setting('writeTime', '💬 Beschreiben', [20, 30, 45, 60, 90])),
      !host && h('p', { class: 'muted', style: 'margin-top:10px' }, 'Nur der Host kann die Zeiten ändern.')),
    host
      ? h('div', { class: 'stack center' },
          h('button', { class: 'big accent', disabled: !enough, onclick: () => act('start').catch((e) => toast(e.message)) }, 'Spiel starten'),
          !enough && h('p', { class: 'muted' }, 'Es braucht mindestens 3 Spieler.'))
      : h('p', { class: 'muted center' }, 'Warte, bis der Host das Spiel startet …')
  );
}

// --- Spielrunde ---

const KIND_LABEL = { write: '✍️ Satz schreiben', draw: '🎨 Zeichnen', describe: '💬 Beschreiben' };
const ANIM_IDEAS = ['Ein Ball hüpft über eine Wiese', 'Eine Blume wächst und blüht', 'Ein Fisch schwimmt vor einem Hai davon', 'Die Sonne geht hinter einem Berg unter', 'Ein Auto fährt durch eine Pfütze', 'Ein Schneemann schmilzt', 'Eine Rakete hebt ab', 'Ein Vogel baut ein Nest'];

function renderPlay() {
  const v = S.view;
  if (S.ui && S.ui.kind === 'play' && S.ui.round === v.round) return updatePlay();
  clearTimers();
  buildPlay();
}

function buildPlay() {
  const v = S.view;
  const ui = { kind: 'play', round: v.round, submitting: false, getPayload: null };
  S.ui = ui;

  const bar = h('div', { class: 'timerbar' });
  const timer = h('div', { class: 'timer' }, bar);
  const tnum = h('span', { class: 'tnum' }, '');
  const count = h('div', { class: 'pcount', id: 'pcount' }, '');
  const head = h('div', { class: 'phead' },
    h('div', { class: 'ptitle' }, titleFor(v)),
    count, tnum, timer);
  Object.assign(ui, { bar, timer, tnum, count });

  const body = h('div', {});
  const submitBtn = h('button', { class: 'big', onclick: () => submitCurrent(false) }, 'Fertig ✓');
  const actions = h('div', { class: 'submitbar' }, submitBtn);
  ui.actions = actions;
  ui.body = body;

  const input = v.input;

  const anim = v.mode === 'animation';
  if (v.kind === 'write') {
    const list = anim ? ANIM_IDEAS : IDEAS;
    const ta = h('textarea', { maxlength: 140, placeholder: anim ? 'z. B. „Ein Ball hüpft über eine Wiese“ – etwas, das sich bewegt oder verändert!' : 'z. B. „Ein Pinguin im Büro“ – etwas Zeichenbares, gern absurd!' });
    const idea = h('button', { class: 'ghost', onclick: () => { ta.value = list[Math.floor(Math.random() * list.length)]; } }, '🎲 Zufällige Idee');
    body.append(
      h('div', { class: 'prompt-box' }, h('small', {}, 'Deine Aufgabe'), anim ? 'Denk dir eine Idee für eine Mini-Animation aus. Die anderen zeichnen sie Bild für Bild.' : 'Denk dir einen Satz aus, den jemand zeichnen soll.'),
      ta, h('div', { style: 'margin-top:10px' }, idea));
    ui.getPayload = () => ({ text: ta.value });
    ui.lock = (locked) => { ta.disabled = locked; idea.disabled = locked; };
    later(() => ta.focus(), 50);
  } else if (v.kind === 'draw') {
    let box;
    let base = [];
    if (anim) {
      const idea = (v.idea || '').trim() || '(keine Idee – lass dir etwas einfallen!)';
      base = v.round >= 2 && input && input.strokes ? input.strokes : [];
      box = h('div', { class: 'prompt-box' }, h('small', {}, 'Idee der Animation'), idea,
        h('div', { class: 'hint' }, v.round === 1
          ? 'Zeichne das erste Bild.'
          : 'Das Bild deines Vorgängers steht schon da. Zeichne weiter oder lösche es mit „Alles löschen“.'));
    } else {
      const text = input && !input.missing ? input.text : '(Der Vorgänger hat nichts geschrieben – zeichne etwas Lustiges!)';
      box = h('div', { class: 'prompt-box' }, h('small', {}, 'Zeichne das'), text);
    }
    const board = makeBoard(base);
    body.append(box, board.el);
    ui.getPayload = () => board.getOps();
    ui.lock = (locked) => board.lock(locked);
  } else {
    const shown = makeCanvas('shown');
    if (input && input.strokes) drawStatic(shown, input.strokes);
    const ta = h('textarea', { maxlength: 140, placeholder: 'Beschreibe in einem Satz, was du siehst …' });
    body.append(h('div', { class: 'prompt-box' }, h('small', {}, 'Was ist das?'), 'Beschreibe die Zeichnung in einem Satz.'), shown, h('div', { style: 'margin-top:12px' }, ta));
    ui.getPayload = () => ({ text: ta.value });
    ui.lock = (locked) => { ta.disabled = locked; };
    later(() => ta.focus(), 50);
  }

  const waiting = h('div', { class: 'card done-box', hidden: true },
    h('div', { class: 'big' }, '✅'), h('h3', {}, 'Abgegeben!'), h('p', { class: 'muted' }, 'Warte auf die anderen …'));
  ui.waiting = waiting;

  setView(head, body, actions, waiting);
  updatePlay();

  const tick = () => {
    const left = Math.max(0, (S.view.deadline - (Date.now() + S.offset)) / 1000);
    const total = ({ write: S.view.settings.firstTime, draw: S.view.settings.drawTime, describe: S.view.settings.writeTime })[S.view.kind];
    bar.style.width = Math.min(100, (left / total) * 100) + '%';
    tnum.textContent = Math.ceil(left) + 's';
    timer.classList.toggle('low', left <= 10);
    if (left <= 0 && !S.view.submitted) submitCurrent(true);
  };
  tick();
  const iv = setInterval(tick, 250);
  S.timers.add(iv);
}

function titleFor(v) {
  if (v.mode === 'animation' && v.kind === 'draw') return `Bild ${v.round}/${v.total - 1} · 🎨 Zeichnen`;
  const label = v.mode === 'animation' && v.kind === 'write' ? '✍️ Idee schreiben' : KIND_LABEL[v.kind];
  return `Runde ${v.round + 1}/${v.total} · ${label}`;
}

function updatePlay() {
  const v = S.view;
  const ui = S.ui;
  ui.lock && ui.lock(v.submitted);
  ui.actions.hidden = v.submitted;
  ui.waiting.hidden = !v.submitted;
  updateCount();
}

function updateCount() {
  const ui = S.ui;
  if (ui && ui.kind === 'play' && ui.count) ui.count.textContent = `${S.view.submittedCount}/${S.view.total} fertig`;
}

async function submitCurrent(auto) {
  const ui = S.ui;
  if (!ui || ui.kind !== 'play' || ui.submitting || S.view.submitted) return;
  ui.submitting = true;
  try {
    await act('submit', { round: S.view.round, ...ui.getPayload() });
    if (S.ui === ui) { S.view.submitted = true; updatePlay(); }
  } catch (e) {
    ui.submitting = false;
    if (!auto) toast(e.message);
  }
}

// --- Zeichenbrett ---

const TOOLS = [
  ['pen', '✏️', 'Stift'],
  ['eraser', '🧽', 'Radierer'],
  ['fill', '🪣', 'Fläche füllen'],
  ['line', '╱', 'Linie'],
  ['rect', '▭', 'Rechteck'],
  ['ellipse', '◯', 'Kreis / Ellipse'],
  ['triangle', '△', 'Dreieck'],
];

// initialOps: das übernommene Vorgängerbild (Animationsmodus), sonst []
function makeBoard(initialOps) {
  const canvas = h('canvas', { class: 'board', width: W, height: H });
  const overlay = h('canvas', { class: 'overlay', width: W, height: H }); // Vorschau für Formen
  const wrap = h('div', { class: 'boardwrap' }, canvas, overlay);
  const ctx = canvas.getContext('2d');
  const octx = overlay.getContext('2d');

  let base = initialOps.slice(); // übernommen, kann komplett gelöscht werden
  let ops = []; // eigene Operationen
  const history = []; // für „Zurück“ (auch nach „Alles löschen“)
  let cur = null;
  let tool = 'pen';
  let color = COLORS[0];
  let size = SIZES[1];
  let filled = false;
  let locked = false;

  const redraw = () => drawStatic(canvas, base.concat(ops));
  const remember = () => { history.push({ base, ops: ops.slice() }); if (history.length > 80) history.shift(); };
  redraw();

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (locked || cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const [x, y] = pos(e);
    if (tool === 'fill') {
      if (floodFill(ctx, x, y, color)) { remember(); ops.push({ t: 'fill', c: color, x, y }); }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    if (SHAPES.includes(tool)) {
      cur = { t: 'shape', k: tool, c: color, w: size, f: filled && tool !== 'line', a: [x, y, x, y] };
      return;
    }
    remember();
    const eraser = tool === 'eraser';
    cur = { c: eraser ? '#ffffff' : color, w: eraser ? Math.round(size * 2.5) : size, p: [x, y] };
    ops.push(cur);
    drawSeg(ctx, [cur.c, cur.w, x, y, x, y]);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    if (cur.t === 'shape') {
      const [x, y] = pos(e);
      cur.a[2] = x;
      cur.a[3] = y;
      octx.clearRect(0, 0, W, H);
      drawShape(octx, cur);
      return;
    }
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const [x, y] = pos(ev);
      const n = cur.p.length;
      const lx = cur.p[n - 2];
      const ly = cur.p[n - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 3) continue;
      cur.p.push(x, y);
      drawSeg(ctx, [cur.c, cur.w, lx, ly, x, y]);
    }
  });

  const finish = (e) => {
    if (!cur) return;
    if (cur.t === 'shape') {
      octx.clearRect(0, 0, W, H);
      const a = cur.a;
      if (e.type === 'pointerup' && Math.abs(a[2] - a[0]) + Math.abs(a[3] - a[1]) >= 6) {
        remember();
        ops.push(cur);
        drawShape(ctx, cur);
      }
    }
    cur = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  // --- Werkzeugleiste ---
  const toolBtns = TOOLS.map(([id, icon, label]) => {
    const b = h('button', { class: 'toolbtn', 'aria-label': label, title: label, onclick: () => { tool = id; sync(); } }, icon);
    b.dataset.t = id;
    return b;
  });
  const fillBtn = h('button', { class: 'ghost small', onclick: () => { filled = !filled; sync(); } }, '');
  const swatches = COLORS.map((c) => {
    const b = h('button', { class: 'swatch', style: `background:${c}`, 'aria-label': 'Farbe ' + c, onclick: () => { color = c; if (tool === 'eraser') tool = 'pen'; sync(); } });
    b.dataset.c = c;
    return b;
  });
  const sizeBtns = SIZES.map((sz) => {
    const b = h('button', { class: 'sizebtn', 'aria-label': 'Strichstärke', onclick: () => { size = sz; sync(); } },
      h('span', { style: `width:${Math.max(5, sz * 0.8)}px;height:${Math.max(5, sz * 0.8)}px` }));
    b.dataset.s = sz;
    return b;
  });
  const undoBtn = h('button', { class: 'ghost small', onclick: () => {
    const snap = history.pop();
    if (!snap) return;
    base = snap.base;
    ops = snap.ops;
    redraw();
  } }, '↩️ Zurück');
  const clearBtn = h('button', { class: 'ghost small', onclick: () => {
    if (!base.length && !ops.length) return;
    remember(); // „Zurück“ macht das Löschen rückgängig
    base = [];
    ops = [];
    redraw();
  } }, base.length ? '🗑️ Alles löschen' : '🗑️ Leeren');

  function sync() {
    toolBtns.forEach((b) => b.classList.toggle('sel', b.dataset.t === tool));
    swatches.forEach((b) => b.classList.toggle('sel', tool !== 'eraser' && b.dataset.c === color));
    sizeBtns.forEach((b) => b.classList.toggle('sel', Number(b.dataset.s) === size));
    fillBtn.hidden = !['rect', 'ellipse', 'triangle'].includes(tool);
    fillBtn.textContent = filled ? '■ Gefüllt' : '□ Nur Umriss';
    canvas.style.cursor = tool === 'fill' ? 'cell' : 'crosshair';
  }
  sync();

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'tools' }, toolBtns, fillBtn),
    h('div', { class: 'swatches' }, swatches),
    h('div', { class: 'row', style: 'gap:6px' }, sizeBtns, undoBtn, clearBtn));

  return {
    el: h('div', {}, wrap, toolbar),
    getOps: () => ({ strokes: base.concat(ops), from: base.length }),
    lock(l) { locked = l; toolbar.hidden = l; if (l) { cur = null; octx.clearRect(0, 0, W, H); } },
  };
}

// --- Auflösung ---

function renderReveal() {
  const v = S.view;
  const rv = v.reveal;
  clearTimers();
  if (rv.finished) return renderFinished();

  const chain = v.chains[rv.chain];
  const host = isHost();
  const token = `${rv.chain}:${rv.step}`;
  S.revealToken = token;

  const anim = v.mode === 'animation';
  const lastStep = chain.entries.length - 1;
  // Animationsmodus: nach dem letzten Bild läuft die ganze Kette als Mini-Film
  const frames = anim ? chain.entries.filter((e) => e.type === 'drawing') : [];
  const fb = anim && rv.step === lastStep && frames.length ? makeFlipbook(frames) : null;
  const fbCard = fb ? h('div', { class: 'entry', hidden: true }, h('div', { class: 'ehead' }, '🎞️ Als Mini-Film:'), fb.el) : null;

  const cards = [];
  let lastCard = null;
  for (let i = 0; i <= rv.step; i++) {
    const e = chain.entries[i];
    const animate = i === rv.step;
    const verb = i === 0 ? (anim ? 'hatte die Idee' : 'schrieb') : e.type === 'drawing' ? (anim ? `zeichnete Bild ${i}` : 'zeichnete') : 'beschrieb';
    const content = e.type === 'text' ? textBubble(e) : makeCanvas('rcanvas');
    const card = h('div', { class: 'entry' }, h('div', { class: 'ehead' }, avatar(e.author), `${e.author} ${verb}:`), content);
    cards.push(card);
    lastCard = card;

    const done = () => {
      if (S.revealToken !== token) return;
      if (fb) {
        fbCard.hidden = false;
        fb.start();
        fbCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (host && S.view.reveal.auto) later(() => { if (S.revealToken === token) act('reveal', { action: 'next' }).catch(() => {}); }, fb ? 8000 : 2200);
    };
    if (e.type === 'text') {
      if (animate && !e.missing) typewriter(content, e.text, done);
      else if (animate) later(done, 1200);
      else if (!e.missing) content.textContent = e.text;
    } else if (animate) {
      S.cancelAnim = animateStrokes(content, e.strokes, e.from || 0, done);
    } else {
      drawStatic(content, e.strokes);
    }
  }
  if (fbCard) cards.push(fbCard);

  const isLast = rv.chain === v.chains.length - 1 && rv.step === lastStep;
  const controls = host
    ? h('div', { class: 'controls' }, h('div', { class: 'inner' },
        h('button', { class: 'ghost', onclick: () => ctl('prev') }, '◀'),
        h('button', { class: 'big', onclick: () => ctl('next') }, isLast ? 'Zum Ergebnis 🎉' : 'Weiter ▶'),
        h('button', { class: 'ghost', onclick: () => ctl('nextChain') }, 'Nächste Kette ⏭'),
        h('label', {}, h('input', { type: 'checkbox', checked: rv.auto, onchange: (e) => act('reveal', { action: 'auto', value: e.target.checked }).catch(() => {}) }), 'Auto')))
    : h('div', { class: 'controls' }, h('div', { class: 'inner muted' }, 'Der Host steuert die Auflösung 🎬'));

  setView(
    h('div', { class: 'rhead' },
      h('h2', {}, `Kette von ${chain.owner}`),
      h('span', { class: 'muted' }, `${rv.chain + 1} von ${v.chains.length} · Schritt ${rv.step + 1}/${chain.entries.length}`)),
    ...cards,
    controls);

  if (rv.step > 0 || rv.chain > 0) lastCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  else window.scrollTo({ top: 0 });
}

function textBubble(e) {
  return e.missing ? h('div', { class: 'bubble empty' }, '(nichts geschrieben)') : h('div', { class: 'bubble' }, '');
}

function ctl(action) {
  act('reveal', { action }).catch((e) => toast(e.message));
}

function renderFinished() {
  const v = S.view;
  const host = isHost();
  const anim = v.mode === 'animation';
  const sections = v.chains.map((c) => {
    const frames = anim ? c.entries.filter((e) => e.type === 'drawing') : [];
    let film = null;
    if (frames.length) {
      const fb = makeFlipbook(frames);
      fb.start();
      film = h('div', {}, h('div', { class: 'ehead' }, '🎞️ Mini-Film'), fb.el);
    }
    return h('div', { class: 'card chain-summary' },
      h('h3', {}, `Kette von ${c.owner}`),
      h('div', { class: 'strip' }, film, c.entries.map((e, i) => {
        const verb = i === 0 ? (anim ? 'hatte die Idee' : 'schrieb') : e.type === 'drawing' ? (anim ? `zeichnete Bild ${i}` : 'zeichnete') : 'beschrieb';
        let content;
        if (e.type === 'text') content = h('div', { class: 'bubble' + (e.missing ? ' empty' : '') }, e.missing ? '(nichts geschrieben)' : e.text);
        else { content = makeCanvas('rcanvas'); drawStatic(content, e.strokes); }
        return h('div', {}, h('div', { class: 'ehead' }, avatar(e.author), `${e.author} ${verb}`), content);
      })));
  });

  setView(
    h('div', { class: 'hero' }, h('div', { class: 'logo' }, '🎉'), h('h1', {}, 'Das war’s!'), h('p', {}, 'Alle Ketten auf einen Blick.')),
    ...sections,
    host
      ? h('div', { class: 'controls' }, h('div', { class: 'inner' },
          h('button', { class: 'ghost', onclick: () => ctl('restart') }, '▶ Auflösung nochmal ansehen'),
          h('button', { class: 'big accent', onclick: () => act('lobby').catch((e) => toast(e.message)) }, 'Neue Runde')))
      : h('div', { class: 'controls' }, h('div', { class: 'inner muted' }, 'Der Host startet die nächste Runde.')));
  window.scrollTo({ top: 0 });
}

// ---------- Start ----------

(async function init() {
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('room') || '').toUpperCase();
  // gespeicherte Sitzung wiederaufnehmen (Seite neu geladen), wenn sie zum Link passt
  if (S.session && (!urlCode || urlCode === S.session.code)) {
    try {
      const r = await api('join', { code: S.session.code, pid: S.session.pid, name: S.session.name });
      saveSession({ code: r.code, pid: r.pid, name: r.name });
      history.replaceState(null, '', '/?room=' + r.code);
      connect();
      return;
    } catch {
      saveSession(null);
    }
  }
  renderHome();
})();
