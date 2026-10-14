// KiN Assistant — Plausibilitäts-Bremse für den Fahrplan-Roboter.
//
// WARUM: Ein GRÜNER Roboter-Lauf mit leeren Daten ist der gefährlichste Fall.
// Er würde den guten Fahrplan durch einen unbrauchbaren ersetzen, ohne dass es
// jemand merkt — die App hätte dann still keine Fahrten mehr. Diese Prüfung
// läuft deshalb NACH dem Filtern und VOR dem Übernehmen nach feed/.
//
// GRUNDSATZ: Lieber der alte, gute Fahrplan als ein leerer.
//
// Aufruf:
//   node scripts/pruefe-fahrplan.mjs <neu.json> <alt.json>
//        [--min-prozent 50] [--aus] [--grund-datei PFAD]
//
// <neu.json> = scripts/delfi-out/meta.json (frisch gefiltert)
// <alt.json> = feed/meta.json             (der letzte gute Stand)
//
// Rückgabe: 0 = plausibel · 1 = ABBRUCH
//   Der Klartext-Grund steht auf stderr und (falls angegeben) in der Grund-Datei,
//   die der Statuszettel ausliest.

import { readFileSync, writeFileSync } from 'node:fs';

// ── Aufruf-Parameter ───────────────────────────────────────────────────────
let minProzent = 50;
let pruefungAus = false;
let grundDatei = null;
const positionale = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--aus') { pruefungAus = true; continue; }
  if (a === '--min-prozent') { minProzent = Number(args[++i]); continue; }
  if (a === '--grund-datei') { grundDatei = args[++i] ?? null; continue; }
  positionale.push(a);
}

const zahl = (n) => new Intl.NumberFormat('de-DE').format(Number(n) || 0);
const proz = (n) => `${n.toFixed(1).replace('.', ',')} %`;

/** Grund für den Statuszettel festhalten (Fehler hier darf nichts kaputt machen). */
function grundFesthalten(text) {
  if (!grundDatei) return;
  try { writeFileSync(grundDatei, `${text}\n`); } catch { /* nicht kritisch */ }
}

/** Abbruch mit Klartext — im GitHub-Protokoll als Fehlerzeile sichtbar. */
function abbruch(text) {
  console.error(`::error::ABBRUCH: ${text}`);
  grundFesthalten(text);
  process.exit(1);
}

const lies = (pfad) => {
  try { return JSON.parse(readFileSync(pfad, 'utf8')); } catch { return null; }
};

// ── Prüfung ────────────────────────────────────────────────────────────────
const [neuPfad, altPfad] = positionale;
if (!neuPfad) abbruch('Aufruf unvollständig: die Datei mit dem neuen Fahrplan fehlt.');

if (pruefungAus) {
  console.log('[Prüfung] Prüfung ist ausdrücklich AUS — die Daten werden ungeprüft übernommen.');
  process.exit(0);
}

if (!Number.isFinite(minProzent) || minProzent <= 0) {
  abbruch(`Die Schwelle "${minProzent}" ist keine brauchbare Zahl — erwartet wird z. B. --min-prozent 50.`);
}

const neu = lies(neuPfad);
if (!neu) {
  abbruch(`Die Ergebnis-Datei des Filters ist nicht lesbar (${neuPfad}) — es liegen keine neuen Daten vor.`);
}

const c = neu.counts ?? {};
const trips = Number(c.trips ?? 0);
const routen = Number(c.routes ?? 0);
const halte = Number(c.stops ?? 0);
const zeiten = Number(c.stop_times ?? 0);

console.log(`[Prüfung] Neuer Fahrplan: ${zahl(trips)} Fahrten · ${zahl(routen)} Linien · ${zahl(halte)} Halte · ${zahl(zeiten)} Halte-Zeiten`);

// 1) Nichts Brauchbares drin? → Abbruch (das ist die eigentliche Lücke)
const leer = [['Fahrten', trips], ['Linien', routen], ['Halte', halte], ['Halte-Zeiten', zeiten]]
  .filter(([, v]) => !v)
  .map(([n]) => n);

if (leer.length) {
  abbruch(
    `Der neue Fahrplan enthält nichts Brauchbares — leer bei: ${leer.join(', ')}. ` +
    'feed/ wird NICHT überschrieben; der letzte gute Fahrplan bleibt stehen.',
  );
}

// 2) Vergleich mit dem letzten guten Stand
const alt = altPfad ? lies(altPfad) : null;
const altTrips = Number(alt?.counts?.trips ?? 0);

if (altTrips > 0) {
  const anteil = (trips / altTrips) * 100;
  console.log(`[Prüfung] Letzter guter Fahrplan: ${zahl(altTrips)} Fahrten (Stand ${alt.feed_version ?? 'unbekannt'})`);
  console.log(`[Prüfung] Fahrten im Vergleich: ${proz(anteil)} (Schwelle: ${minProzent} %)`);

  if (anteil < minProzent) {
    abbruch(
      `Der neue Fahrplan hat nur ${zahl(trips)} Fahrten — das sind ${proz(anteil)} des letzten guten ` +
      `(${zahl(altTrips)}). Das liegt unter der Schwelle von ${minProzent} %. ` +
      'feed/ wird NICHT überschrieben; der letzte gute Fahrplan bleibt stehen.',
    );
  }

  // 3) Der Stand darf nicht zurückspringen — die App vergleicht Datumsangaben
  if (neu.feed_version && alt.feed_version && neu.feed_version < alt.feed_version) {
    console.log(`::warning::Der neue Stand (${neu.feed_version}) ist ÄLTER als der letzte (${alt.feed_version}) — die App würde ihn ignorieren.`);
  }
} else {
  console.log('[Prüfung] Kein letzter guter Fahrplan zum Vergleichen — es wird nur auf "leer" geprüft.');
}

console.log(`[Prüfung] OK — die neuen Daten sind plausibel (${zahl(trips)} Fahrten, Stand ${neu.feed_version ?? 'unbekannt'}).`);
