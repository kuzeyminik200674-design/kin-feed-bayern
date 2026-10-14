// KiN Assistant — Statuszettel (STATUS.md) schreiben.
//
// WARUM: Der Roboter und sein Wächter sollen nicht nur im GitHub-Protokoll
// stehen — dort schaut niemand nach. STATUS.md liegt ganz oben im Repo und
// sagt in Klartext: Wann lief was, mit welchem Ergebnis, und was ist zu tun.
//
// Aufbau: Roboter und Wächter schreiben NIE direkt in STATUS.md, sondern in
// ihre eigene kleine Notiz (status/robot.json bzw. status/waechter.json).
// Diese Datei setzt daraus STATUS.md zusammen — so können sich die beiden
// Termine nicht gegenseitig überschreiben.
//
// Aufruf:
//   node scripts/status-schreiben.mjs [--quelle robot] [--grund-datei PFAD]
//
// --quelle robot  → schreibt ZUERST status/robot.json aus den Angaben des
//                   Roboter-Laufs (siehe Umgebungsvariablen unten), danach
//                   wird STATUS.md neu zusammengesetzt.
// ohne --quelle   → setzt nur STATUS.md aus den vorhandenen Notizen zusammen.
//
// Umgebungsvariablen (nur beim Roboter-Lauf gesetzt):
//   JOB_STATUS        success | failure | cancelled
//   DATEN_GEAENDERT   true | false   (wurde feed/ committet?)
//   PRUEFUNG          an | aus
//   MIN_PROZENT       z. B. 50

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// ── Aufruf-Parameter ───────────────────────────────────────────────────────
let quelle = null;
let grundDatei = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--quelle') { quelle = args[++i] ?? null; continue; }
  if (a === '--grund-datei') { grundDatei = args[++i] ?? null; continue; }
}

const ROBOT_NOTIZ = 'status/robot.json';
const WAECHTER_NOTIZ = 'status/waechter.json';
const FEED_META = 'feed/meta.json';
const ZIEL = 'STATUS.md';

const zahl = (n) => new Intl.NumberFormat('de-DE').format(Number(n) || 0);

const lies = (pfad) => {
  try { return JSON.parse(readFileSync(pfad, 'utf8')); } catch { return null; }
};

function schreib(pfad, inhalt) {
  const schnitt = pfad.lastIndexOf('/');
  if (schnitt > 0) mkdirSync(pfad.slice(0, schnitt), { recursive: true });
  writeFileSync(pfad, inhalt);
}

/** ISO-Zeitpunkt → „14.10.2026, 20:12 Uhr" (Berliner Zeit). */
function zeitpunkt(iso) {
  if (!iso) return 'unbekannt';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    const t = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
    }).format(d);
    return `${t} Uhr`;
  } catch {
    return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  }
}

/** „2026-10-10" → „vor 4 Tagen" / „heute". */
function alterText(stand) {
  if (typeof stand !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stand)) return null;
  const tage = Math.floor(Date.now() / 86_400_000) - Math.floor(Date.parse(`${stand}T00:00:00Z`) / 86_400_000);
  if (!Number.isFinite(tage)) return null;
  if (tage <= 0) return 'heute';
  if (tage === 1) return 'vor 1 Tag';
  return `vor ${tage} Tagen`;
}

const grundAusDatei = () => {
  if (!grundDatei) return null;
  try {
    const t = readFileSync(grundDatei, 'utf8').trim();
    return t || null;
  } catch { return null; }
};

// ── 1) Roboter-Notiz schreiben (nur wenn ausdrücklich verlangt) ────────────
if (quelle === 'robot') {
  const jobStatus = (process.env.JOB_STATUS ?? '').trim() || 'success';
  const geaendert = (process.env.DATEN_GEAENDERT ?? '').trim() === 'true';
  const pruefung = (process.env.PRUEFUNG ?? '').trim() || 'an';
  const minProzent = (process.env.MIN_PROZENT ?? '').trim() || '50';
  const meta = lies(FEED_META);

  let ergebnis;
  if (jobStatus === 'cancelled') ergebnis = 'abgebrochen';
  else if (jobStatus === 'failure') ergebnis = 'fehlgeschlagen';
  else ergebnis = geaendert ? 'aktualisiert' : 'keine_aenderung';

  const grund = ergebnis === 'fehlgeschlagen' || ergebnis === 'abgebrochen'
    ? (grundAusDatei() ?? 'Der Lauf ist ohne nähere Angabe fehlgeschlagen — bitte das Protokoll des roten Laufs ansehen.')
    : null;

  schreib(ROBOT_NOTIZ, `${JSON.stringify({
    letzter_lauf: new Date().toISOString(),
    ergebnis,
    grund,
    pruefung,
    min_prozent: Number(minProzent) || 50,
    daten_uebernommen: ergebnis === 'aktualisiert',
    feed_version: meta?.feed_version ?? null,
    fahrten: Number(meta?.counts?.trips ?? 0),
    linien: Number(meta?.counts?.routes ?? 0),
    halte: Number(meta?.counts?.stops ?? 0),
  }, null, 2)}\n`);
}

// ── 1b) Wächter-Notiz nachtragen, wenn die Prüfung abgebrochen ist ─────────
// Im Normalfall schreibt pruefe-alter.mjs die Notiz selbst (ok ODER alarm).
// Bricht das Skript vorher ab, gäbe es sonst einen roten Lauf ohne Alarm-Notiz.
if (quelle === 'waechter') {
  const jobStatus = (process.env.JOB_STATUS ?? '').trim() || 'success';
  const vorhanden = lies(WAECHTER_NOTIZ);
  const abgebrochen = jobStatus === 'failure' || jobStatus === 'cancelled';
  if (abgebrochen && (!vorhanden || vorhanden.ergebnis === 'ok')) {
    const meta = lies(FEED_META);
    schreib(WAECHTER_NOTIZ, `${JSON.stringify({
      letzter_lauf: new Date().toISOString(),
      ergebnis: 'alarm',
      grund: grundAusDatei() ?? 'Die Wächter-Prüfung ist abgebrochen, ohne einen Grund zu nennen — bitte das Protokoll des roten Laufs ansehen.',
      feed_version: meta?.feed_version ?? null,
      fahrten: Number(meta?.counts?.trips ?? 0),
      schwelle_tage: null,
      alter_tage: null,
    }, null, 2)}\n`);
  }
}

// ── 2) STATUS.md zusammensetzen ────────────────────────────────────────────
const robot = lies(ROBOT_NOTIZ);
const waechter = lies(WAECHTER_NOTIZ);
const meta = lies(FEED_META);

const zeilen = [];
zeilen.push('# Fahrplan-Roboter — Status');
zeilen.push('');
zeilen.push('> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.');
zeilen.push(`> Zuletzt aktualisiert: **${zeitpunkt(new Date().toISOString())}** (Berliner Zeit)`);
zeilen.push('');
zeilen.push('---');
zeilen.push('');

// — Abschnitt 1: Roboter (dienstags) —
zeilen.push('## 1. Roboter-Lauf (dienstags 04:00 UTC)');
zeilen.push('');

if (!robot) {
  zeilen.push('**Noch kein Lauf protokolliert.** Der erste Lauf schreibt hier seinen Status hinein.');
} else {
  const stand = robot.feed_version ?? meta?.feed_version ?? null;
  const alt = alterText(stand);
  const fahrten = robot.fahrten || Number(meta?.counts?.trips ?? 0);
  const linien = robot.linien || Number(meta?.counts?.routes ?? 0);
  const halte = robot.halte || Number(meta?.counts?.stops ?? 0);

  const kopf = {
    aktualisiert: '✅ **OK — neuer Fahrplan übernommen**',
    keine_aenderung: '⚠️ **Keine Änderung — es gab nichts Neues** (kein Fehler)',
    fehlgeschlagen: '❌ **FEHLGESCHLAGEN — es kamen keine brauchbaren Daten**',
    abgebrochen: '❌ **ABGEBROCHEN — der Lauf wurde abgebrochen**',
  }[robot.ergebnis] ?? `❓ **Unklarer Zustand (${robot.ergebnis})**`;

  zeilen.push(kopf);
  zeilen.push('');
  zeilen.push('| | |');
  zeilen.push('|---|---|');
  zeilen.push(`| Zeitpunkt | ${zeitpunkt(robot.letzter_lauf)} |`);
  zeilen.push(`| Fahrplan-Stand in \`feed/\` | ${stand ?? 'unbekannt'}${alt ? ` (${alt})` : ''} |`);
  zeilen.push(`| Daten | ${zahl(fahrten)} Fahrten · ${zahl(linien)} Linien · ${zahl(halte)} Halte |`);
  zeilen.push(`| Nach \`feed/\` übernommen | ${robot.daten_uebernommen ? 'ja' : 'nein'} |`);
  zeilen.push(`| Plausibilitäts-Prüfung | ${robot.pruefung === 'aus' ? '**AUS** (Testlauf)' : `an (Schwelle ${robot.min_prozent} %)`} |`);
  if (robot.grund) {
    zeilen.push('');
    zeilen.push(`**Grund (Klartext):** ${robot.grund}`);
  }
}

zeilen.push('');
zeilen.push('---');
zeilen.push('');

// — Abschnitt 2: Wächter (samstags) —
zeilen.push('## 2. Wächter-Lauf (samstags 06:00 UTC)');
zeilen.push('');
zeilen.push('Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.');
zeilen.push('');

if (!waechter) {
  zeilen.push('**Noch kein Wächter-Lauf protokolliert.**');
} else {
  const ok = waechter.ergebnis === 'ok';
  zeilen.push(ok
    ? '✅ **OK — der Fahrplan ist frisch genug**'
    : '❌ **ALARM — der Fahrplan ist zu alt**');
  zeilen.push('');
  zeilen.push('| | |');
  zeilen.push('|---|---|');
  zeilen.push(`| Zeitpunkt | ${zeitpunkt(waechter.letzter_lauf)} |`);
  zeilen.push(`| Fahrplan-Stand in \`feed/\` | ${waechter.feed_version ?? 'unbekannt'}${waechter.alter_tage != null ? ` (${waechter.alter_tage} Tage alt)` : ''} |`);
  zeilen.push(`| Erlaubt | ${waechter.schwelle_tage ? `höchstens ${waechter.schwelle_tage} ${Number(waechter.schwelle_tage) === 1 ? 'Tag' : 'Tage'}` : 'unbekannt (Prüfung abgebrochen)'} |`);
  if (waechter.gueltig_bis) zeilen.push(`| Laut Daten gültig bis | ${waechter.gueltig_bis} |`);
  if (waechter.grund) {
    zeilen.push('');
    zeilen.push(`**Grund (Klartext):** ${waechter.grund}`);
  }
}

// — Abschnitt 3: Was zu tun ist (nur wenn etwas nicht stimmt) —
const robotSchlecht = robot && (robot.ergebnis === 'fehlgeschlagen' || robot.ergebnis === 'abgebrochen');
const waechterSchlecht = waechter && waechter.ergebnis !== 'ok';

if (robotSchlecht || waechterSchlecht) {
  const stand = meta?.feed_version ?? null;
  const alt = alterText(stand);
  zeilen.push('');
  zeilen.push('---');
  zeilen.push('');
  zeilen.push('## ⚠️ Was jetzt zu tun ist');
  zeilen.push('');
  zeilen.push(`- **Die App läuft weiter.** In \`feed/\` steht unverändert der letzte gute Fahrplan (Stand **${stand ?? 'unbekannt'}**${alt ? `, ${alt}` : ''}) — sie liefert ihn weiter aus, nur eben mit älteren Daten.`);
  zeilen.push('- **Nichts überstürzen.** Kein Handeln am Handy, kein Update, keine Einstellung.');
  zeilen.push('- **Nachsehen:** GitHub → *Actions* → den letzten **roten** Lauf öffnen und die Meldung im fehlgeschlagenen Schritt lesen.');
  zeilen.push('- **Wenn der Spiegel wieder liefert:** den Lauf von Hand starten (*Actions* → *Weekly DELFI Bayern-Schiene Feed* → *Run workflow*).');
  zeilen.push('');
  zeilen.push('Häufigste Ursache: der Bezugs-Spiegel (`mobi.nrw`) antwortet nicht oder liefert eine Fehlerseite statt Daten.');
}

zeilen.push('');
zeilen.push('---');
zeilen.push('');
zeilen.push('## Zeichen-Erklärung');
zeilen.push('');
zeilen.push('| Zeichen | Bedeutung |');
zeilen.push('|---|---|');
zeilen.push('| ✅ OK | alles in Ordnung |');
zeilen.push('| ⚠️ Keine Änderung | der Lauf war erfolgreich, es gab aber nichts Neues — **kein Fehler** |');
zeilen.push('| ❌ FEHLGESCHLAGEN | es kamen keine brauchbaren Daten — der alte Fahrplan bleibt stehen |');
zeilen.push('');
zeilen.push('Der Fahrplan-Inhalt selbst (die `.csv.gz`-Dateien und `feed/meta.json`) wird hier nie beschrieben.');
zeilen.push('');

schreib(ZIEL, zeilen.join('\n'));
console.log(`[Status] ${ZIEL} geschrieben (Roboter: ${robot?.ergebnis ?? 'keine Notiz'} · Wächter: ${waechter?.ergebnis ?? 'keine Notiz'}).`);
