'use strict';
// Spielt mit 6 simulierten Spielern ein komplettes Spiel durch und prüft die Ergebnisse.
// Aufruf: node test/bots.js   (startet den Server selbst auf einem freien Port)
// Mit SILENT_BOT=1 lässt ein Bot in der Zeichenrunde absichtlich die Zeit verstreichen (dauert ~20 s länger).

const assert = require('assert');
const { server } = require('../server');

const N = 6;
const SILENT = process.env.SILENT_BOT === '1';
const ANIM = process.env.MODE === 'animation'; // MODE=animation testet den Animationsmodus
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => {
    const r = await fetch(base + '/api/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${j.error}`);
    return j;
  };
  const getState = async (b) => (await fetch(`${base}/api/state?room=${b.code}&pid=${b.pid}`)).json();

  // Raum + Spieler
  const host = await post('create', { name: 'Bot1' });
  const bots = [host];
  for (let i = 2; i <= N; i++) bots.push(await post('join', { code: host.code, name: 'Bot' + i }));
  await post('settings', { room: host.code, pid: host.pid, settings: { firstTime: 15, drawTime: 15, writeTime: 15, mode: ANIM ? 'animation' : 'normal' } });
  await post('start', { room: host.code, pid: host.pid });

  // späte Spieler werden abgelehnt
  await assert.rejects(post('join', { code: host.code, name: 'Spaet' }), /läuft schon/);

  const strokesFor = (i) => [
    { c: '#ef4444', w: 10, p: [100 + i * 10, 100, 200, 150, 300, 120, 400, 300] },
    { c: '#3b82f6', w: 22, p: [50, 500] }, // einzelner Punkt
    { t: 'fill', c: '#22c55e', x: 120 + i, y: 140 },
    { t: 'shape', k: 'rect', c: '#8b5cf6', w: 6, f: true, a: [500, 100, 700, 250] },
    { t: 'shape', k: 'bogus', c: '#000000', w: 6, a: [0, 0, 1, 1] }, // ungültig, muss verworfen werden
  ];

  const seenRounds = new Set();
  const t0 = Date.now();
  let silentDone = false;
  while (true) {
    const states = await Promise.all(bots.map(getState));
    const st = states[0].state;
    if (st === 'reveal') break;
    assert.strictEqual(st, 'play');
    for (let i = 0; i < N; i++) {
      const v = states[i];
      if (v.submitted) continue;
      seenRounds.add(v.round);
      // Eingabe stimmt zur Runde?
      if (v.kind === 'write') assert.ok(!v.input);
      if (ANIM) {
        assert.strictEqual(v.mode, 'animation');
        assert.notStrictEqual(v.kind, 'describe', 'im Animationsmodus wird nicht beschrieben');
        if (v.round >= 1) assert.ok(v.idea && v.idea.startsWith('Text von Bot'), 'Idee bleibt sichtbar');
        if (v.round === 1) assert.strictEqual(v.input.type, 'text');
        if (v.round >= 2) assert.strictEqual(v.input.type, 'drawing');
      } else {
        if (v.kind === 'draw') assert.strictEqual(v.input.type, 'text');
        if (v.kind === 'describe') assert.strictEqual(v.input.type, 'drawing');
      }
      if (SILENT && i === 5 && v.kind === 'draw' && !silentDone) { silentDone = true; continue; }
      if (SILENT && i === 5 && v.kind === 'draw') continue;
      let payload;
      if (v.kind === 'draw') {
        const inherited = ANIM && v.round >= 2 ? v.input.strokes : [];
        payload = { strokes: inherited.concat(strokesFor(i)), from: inherited.length };
      } else payload = { text: `Text von Bot${i + 1} in Runde ${v.round}` };
      await post('submit', { room: host.code, pid: bots[i].pid, round: v.round, ...payload });
    }
    await sleep(50);
    assert.ok(Date.now() - t0 < 120000, 'Timeout im Test');
  }
  assert.strictEqual(seenRounds.size, N, 'alle Runden gespielt');

  // Ergebnisse prüfen
  const v = await getState(host);
  assert.strictEqual(v.chains.length, N);
  const kinds = ANIM ? ['text', 'drawing', 'drawing', 'drawing', 'drawing', 'drawing'] : ['text', 'drawing', 'text', 'drawing', 'text', 'drawing'];
  for (const c of v.chains) {
    assert.strictEqual(c.entries.length, N);
    c.entries.forEach((e, i) => assert.strictEqual(e.type, kinds[i]));
    assert.strictEqual(new Set(c.entries.map((e) => e.author)).size, N, 'jeder Spieler genau einmal pro Kette');
    assert.strictEqual(c.entries[0].author, c.owner);
    if (ANIM) {
      for (let i = 2; i < N; i++) {
        const prev = c.entries[i - 1];
        const cur = c.entries[i];
        if (cur.missing) { // verpasstes Bild übernimmt das vorherige
          assert.deepStrictEqual(cur.strokes, prev.strokes);
          continue;
        }
        assert.strictEqual(cur.from, prev.strokes.length, 'from = Länge des Vorgängerbilds');
        assert.deepStrictEqual(cur.strokes.slice(0, cur.from), prev.strokes, 'Vorgängerbild bleibt erhalten');
      }
    }
    // ungültige Form wurde entfernt, gültige Operationen sind drin
    for (const e of c.entries.filter((x) => x.type === 'drawing' && !x.missing)) {
      assert.ok(e.strokes.some((o) => o.t === 'fill') && e.strokes.some((o) => o.t === 'shape'));
      assert.ok(!e.strokes.some((o) => o.k === 'bogus'));
    }
  }
  if (SILENT) {
    const missing = v.chains.flatMap((c) => c.entries).filter((e) => e.missing && e.type === 'drawing');
    assert.ok(missing.length >= 1, 'stiller Bot erzeugt leere Zeichnung');
  }

  // Auflösung durchsteppen
  let steps = 0;
  let rv = v.reveal;
  while (!rv.finished) {
    await post('reveal', { room: host.code, pid: host.pid, action: 'next' });
    rv = (await getState(host)).reveal;
    steps++;
    assert.ok(steps < 100);
  }
  assert.strictEqual(steps, N * N, 'Anzahl Auflösungsschritte');
  await assert.rejects(post('reveal', { room: host.code, pid: bots[1].pid, action: 'next' }), /Host/);

  // zurück in die Lobby
  await post('lobby', { room: host.code, pid: host.pid });
  assert.strictEqual((await getState(host)).state, 'lobby');

  console.log(`OK – ${N} Bots haben ein komplettes Spiel gespielt (${((Date.now() - t0) / 1000).toFixed(1)} s, ${steps} Reveal-Schritte).`);
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error('TEST FEHLGESCHLAGEN:', e); process.exit(1); });
