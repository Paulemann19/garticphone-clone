# Kritzelphone ✏️📞

Ein Gartic-Phone-Klon für dich und deine Freunde: Satz schreiben → zeichnen → beschreiben → zeichnen … und am Ende wird jede Kette **animiert abgespielt** (Text tippt sich selbst, Zeichnungen werden Strich für Strich nachgemalt).

## Spielablauf

1. Einer erstellt einen Raum und schickt den Link an die anderen (3–12 Spieler, ideal 6).
2. **Runde 1:** Jeder schreibt einen Satz.
3. **Weitere Runden:** Abwechselnd zeichnen und beschreiben. Man sieht immer nur das, was der Vorgänger gemacht hat.
4. Es gibt so viele Runden wie Spieler, so landet jede Kette einmal bei jedem.
5. **Auflösung:** Der Host klickt sich durch jede Kette (oder schaltet „Auto“ ein). Alle sehen live dasselbe.

## Zeichenwerkzeuge

Stift, Radierer, **Fläche füllen** 🪣, **Formen** (Linie, Rechteck, Kreis/Ellipse, Dreieck – wahlweise nur Umriss oder gefüllt), 12 Farben, 3 Strichstärken sowie „Zurück“ (macht auch „Alles löschen“ rückgängig). Alle Werkzeuge werden bei der Auflösung mit abgespielt.

## Spielmodi (Host wählt in der Lobby)

- **Normal:** Schreiben → Zeichnen → Beschreiben → Zeichnen …
- **Animation:** Jeder schreibt eine Idee (z. B. „Ein Ball hüpft über eine Wiese“). Danach wird nur noch gezeichnet: Jeder bekommt das **Bild des Vorgängers schon auf der Leinwand** und kann darauf weiterzeichnen oder es mit „Alles löschen“ entfernen, um ein neues Bild zu malen. Am Ende läuft jede Kette als **Mini-Film** in Schleife (die Bilder werden nacheinander durchgeblättert). Verpasst jemand sein Bild, wird das vorherige übernommen.

Läuft die Zeit ab, wird automatisch abgegeben. Wer zu spät ist, hinterlässt eine leere Zeichnung bzw. „(nichts geschrieben)“. Die Zeiten stellt der Host in der Lobby ein. Nach einem Reload kommt man automatisch zurück ins Spiel.

## Lokal starten

```bash
node server.js        # Node >= 18, keine Abhängigkeiten, kein npm install nötig
# → http://localhost:3000
```

Test mit 6 simulierten Spielern: `npm test` (Animationsmodus: `MODE=animation npm test`)

## Online mit Freunden spielen

Das Spiel braucht einen laufenden Server (Live-Verbindung per Server-Sent-Events). GitHub Pages reicht deshalb nicht. Zwei einfache Wege:

**Dauerhaft (z. B. Render, kostenlos):**
1. render.com → *New → Web Service* → dieses GitHub-Repo auswählen.
2. Build Command: leer lassen (oder `echo ok`), Start Command: `node server.js`.
3. Nach dem Deploy bekommst du eine URL, die du mit Freunden teilst. Beim kostenlosen Tarif schläft der Dienst nach Inaktivität ein; der erste Aufruf dauert dann ca. 30 s. Spielstände liegen im Arbeitsspeicher, ein Neustart beendet laufende Spiele.

**Nur für heute Abend (vom eigenen Rechner):**
```bash
node server.js
npx cloudflared tunnel --url http://localhost:3000   # oder: npx localtunnel --port 3000
```
Den ausgegebenen Link teilst du mit den Freunden.

## Technik

- `server.js`: HTTP + SSE, Spiellogik (Räume, Runden, Timer, Ketten). Der Server ist maßgeblich, Clients senden nur Eingaben.
- `public/app.js`: Oberfläche, Zeichenbrett (Striche werden als Vektordaten gespeichert), animierte Wiedergabe.
- Kettenrotation: In Runde *r* bearbeitet der Spieler mit Sitzplatz *j* die Kette *(j + r) mod N*. Die Sitzordnung wird pro Spiel zufällig gemischt.
