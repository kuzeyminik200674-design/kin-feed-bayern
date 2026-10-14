// KiN Assistant — Wächter-Prüfung: Ist der Fahrplan zu alt geworden?
//
// WARUM: Der Dienstags-Roboter schreibt einen Statuszettel — aber nur, wenn er
// tatsächlich läuft. Genau das ist die Lücke: findet der Lauf GAR NICHT statt
// (GitHub-Störung, abgeschalteter Termin), schweigt alles. Dieser Wächter ist
// ein zweiter, winziger Termin (samstags), der nichts herunterlädt und nur
// eine Frage stellt:
//
//   „Ist der Fahrplan in feed/ älter als erlaubt — oder gar nicht mehr gültig?"
//
// Aufruf:
//   node scripts/pruefe-alter.mjs [--max-tage 10] [--feed-datei feed/meta.json]
//        [--status-datei status/waechter.json] [--grund-datei PFAD]
//
// Rückgabe: 0 = alles in Ordnung · 1 = ALARM
// Nebenbei wird status/waechter.json geschrieben (daraus entsteht STATUS.md).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Aufruf-Parameter ───────────────────────────────────────────────────────
let maxTage = 10;
let feedDatei = 'feed/meta.json';
let statusDatei = 'status/waechter.json';
let grundDatei = null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--max-tage') { maxTage = Number(args[++i]); continue; }
  if (a === '--feed-datei') { feedDatei = args[++i] ?? feedDatei; continue; }
  if (a === '--status-datei') { statusDatei = args[++i] ?? statusDatei; continue; }
  if (a === '--grund-datei') { grundDatei = args[++i] ?? null; continue; }
}

const zahl = (n) => new Intl.NumberFormat('de-DE').format(Number(n) || 0);
const lies = (pfad) => {
  try { return JSON.parse(readFileSync(pfad, 'utf8')); } catch { return null; }
};
const tag = (ms) => Math.floor(ms / 86_400_000);

/** „YYYY-MM-DD" → Tagesnummer seit Epoche (UTC), sonst null. */
function tagAusDatum(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) ? tag(ms) : null;
}

/** „YYYYMMDD" (aus feed_end_date) → Tagesnummer seit Epoche (UTC), sonst null. */
function tagAusKompakt(text) {
  if (typeof text !== 'string' || !/^\d{8}$/.test(text)) return null;
  return tagAusDatum(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`);
}

function grundFesthalten(text) {
  if (!grundDatei) return;
  try { writeFileSync(grundDatei, `${text}\n`); } catch { /* nicht kritisch */ }
}

/** Ergebnis festhalten — auch beim Alarm, damit STATUS.md die Zahlen kennt. */
function statusFesthalten(daten) {
  try {
    mkdirSync(dirname(statusDatei), { recursive: true });
    writeFileSync(statusDatei, `${JSON.stringify(daten, null, 2)}\n`);
  } catch (e) {
    console.error(`::warning::Wächter-Status konnte nicht geschrieben werden: ${e?.message ?? e}`);
  }
}

function alarm(text, daten) {
  console.error(`::error::ALARM: ${text}`);
  grundFesthalten(text);
  statusFesthalten({ ...daten, ergebnis: 'alarm', grund: text });
  process.exit(1);
}

// ── Prüfung ────────────────────────────────────────────────────────────────
if (!Number.isFinite(maxTage) || maxTage < 1) {
  alarm(`Die Schwelle "${maxTage}" ist keine brauchbare Zahl — erwartet wird z. B. --max-tage 10.`, {
    letzter_lauf: new Date().toISOString(),
  });
}

const heute = tag(Date.now());
const meta = lies(feedDatei);

if (!meta) {
  alarm(`Es liegt kein Fahrplan im Repo (${feedDatei} nicht lesbar). Die App kann nichts ausliefern.`, {
    letzter_lauf: new Date().toISOString(),
    schwelle_tage: maxTage,
  });
}

const stand = meta.feed_version ?? null;
const standTag = tagAusDatum(stand);
const endeTag = tagAusKompakt(meta.feed_end_date);
const fahrten = Number(meta?.counts?.trips ?? 0);

const basis = {
  letzter_lauf: new Date().toISOString(),
  schwelle_tage: maxTage,
  feed_version: stand,
  fahrten,
  gueltig_bis: /^\d{8}$/.test(String(meta.feed_end_date ?? ''))
    ? `${String(meta.feed_end_date).slice(0, 4)}-${String(meta.feed_end_date).slice(4, 6)}-${String(meta.feed_end_date).slice(6, 8)}`
    : null,
};

console.log(`[Wächter] Fahrplan-Stand: ${stand ?? 'unbekannt'} · ${zahl(fahrten)} Fahrten`);
if (basis.gueltig_bis) console.log(`[Wächter] Laut Daten gültig bis: ${basis.gueltig_bis}`);

// 1) Gültigkeit abgelaufen? Das ist der härteste Fall — die Daten sind tot.
if (endeTag !== null && endeTag < heute) {
  alarm(
    `Der Fahrplan war nur bis ${basis.gueltig_bis} gültig — dieses Datum ist vorbei. ` +
    'Die App hat damit keinen gültigen Fahrplan mehr.',
    { ...basis, alter_tage: standTag === null ? null : heute - standTag },
  );
}

// 2) Zu alt?
if (standTag === null) {
  alarm(`Der Fahrplan-Stand ("${stand}") ist unlesbar — es lässt sich nicht feststellen, wie alt die Daten sind.`, basis);
}

const alter = heute - standTag;
if (alter > maxTage) {
  alarm(
    `Der Fahrplan ist ${alter} Tage alt (Stand ${stand}, erlaubt sind ${maxTage}). ` +
    'Der Dienstags-Roboter hat offenbar keine neuen Daten geliefert.',
    { ...basis, alter_tage: alter },
  );
}

console.log(`[Wächter] Alter: ${alter} Tage (erlaubt: ${maxTage})`);
console.log('[Wächter] OK — der Fahrplan ist frisch genug.');
statusFesthalten({ ...basis, alter_tage: alter, ergebnis: 'ok', grund: null });
