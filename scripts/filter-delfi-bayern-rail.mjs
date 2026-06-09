#!/usr/bin/env node
// KiN Assistant — DELFI -> Bayern-Schiene Filter (Stufe 2, Schritt 1)
//
// Liest das deutschlandweite DELFI-GTFS-Bundle (opendata-oepnv.de), filtert auf
// BAYERN + NUR SCHIENE (kein Bus/SEV) und schreibt ein kleines gzip-CSV-Bundle
// in der GLEICHEN Struktur wie assets/gtfs/ -> der App-Importer bleibt unveraendert.
//
// Strategie laut Docs/DELFI-Inventur.md:
//   - Bayern: stop_id-Praefix de:09 (amtl. Gemeindeschluessel, 09 = Bayern),
//     inkl. Normalisierung der ~12 IDs mit fehlender fuehrender Null (de:9... -> 09...).
//   - Schiene-Whitelist: route_type in {2,101,102,103,106,109}. KEIN Bus.
//   - Border-Crossing: Trip komplett behalten, sobald >=1 Halt in Bayern liegt.
//
// SCOPE (Product Owner): NUR SCHIENE. SEV/Bus kommt spaeter als eigenes Modul.
//
// Nutzung:
//   node scripts/filter-delfi-bayern-rail.mjs [pfad/zur/delfi.zip]
//   Default-Input: C:\Users\Admin\Downloads\20260518_fahrplaene_gesamtdeutschland_gtfs.zip
//   Output:        scripts/delfi-out/   (UEBERSCHREIBT NICHT assets/gtfs/)
//
// Daten: (c) DELFI e.V. (opendata-oepnv.de), CC BY -- Namensnennung Pflicht.

import {
  createReadStream, createWriteStream, existsSync, mkdirSync, rmSync,
  statSync, readFileSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ZIP = 'C:\\Users\\Admin\\Downloads\\20260518_fahrplaene_gesamtdeutschland_gtfs.zip';
const ZIP_PATH = process.argv[2] || DEFAULT_ZIP;
const OUT_DIR = join(__dirname, 'delfi-out');
const WORK_DIR = join(tmpdir(), 'delfi-filter-work');
const REPORT = join(OUT_DIR, '_report.txt');

// Schiene-Whitelist (Docs/DELFI-Inventur.md 4.3). NUR Schiene, kein Bus.
const RAIL_TYPES = new Set(['2', '101', '102', '103', '106', '109']);
// Bekannte NICHT-Schiene-Codes (zur Klassifikation der Verteilung).
const KNOWN_NONRAIL = new Set([
  '0', '1', '3', '4', '5', '6', '7',           // GTFS-Basis (Tram/U-Bahn/Bus/Faehre/...)
  '400', '900', '1000', '201', '700', '704', '715', '1501',
  '800', '1100', '1200', '1300', '1400', '1700', // Trolleybus/Air/Ferry/Aerial/Funicular/Misc
]);

const log = (m) => { process.stderr.write(m + '\n'); };
const report = (m) => { process.stderr.write(m + '\n'); appendFileSync(REPORT, m + '\n'); };

// ---- CSV-Helfer (bewusst self-contained, fetch-gtfs.mjs bleibt unangetastet) ----

// RFC4180-naher Parser: behandelt quoted fields mit Kommas/Quotes. Fuer kleine
// Dateien (routes/trips/stops/calendar/agency) und die Header-Zeilen.
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function escapeCsv(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

// Schneller Feld-Extraktor OHNE Quote-Handling -- nur fuer die fruehen, garantiert
// unquoted Spalten von stop_times (trip_id/stop_id/stop_sequence/zeiten, alle vor
// optionalen Textspalten wie stop_headsign). Vermeidet 43,9 Mio Voll-Parses x2.
function getField(line, n) {
  let start = 0;
  for (let i = 0; i < n; i++) {
    const c = line.indexOf(',', start);
    if (c === -1) return '';
    start = c + 1;
  }
  let end = line.indexOf(',', start);
  if (end === -1) end = line.length;
  let v = line.slice(start, end);
  // DELFI quotet Textfelder ("de:09..."): umschliessende Quotes entfernen.
  // NUR sicher fuer Spalten OHNE internes Komma und VOR der ersten Komma-
  // behafteten Spalte (stop_headsign). Felder dahinter (arrival/departure)
  // duerfen NICHT per getField geholt werden -> dort Voll-Parser nutzen.
  if (v.length >= 2 && v.charCodeAt(0) === 34 && v.charCodeAt(v.length - 1) === 34) {
    v = v.slice(1, -1);
  }
  return v;
}

// Bayern-Test inkl. Normalisierung. BL-Code = erste 2 Ziffern des amtl. Gemeinde-
// schluessels; gueltige BL-Codes sind 01..16, beginnen also IMMER mit 0 oder 1.
// Ein "de:9..." (einzelne 9) kann daher nur eine 09 mit verschluckter fuehrender
// Null sein (dokumentierte ~12 Faelle, davon 2 Bayern/Traunstein) -> Bayern.
function isBayern(stopId) {
  return stopId.startsWith('de:09') || stopId.startsWith('de:9');
}

// gzip-CSV aus einem Array (nur kleine Dateien). Mit Backpressure.
async function writeGzCsv(path, header, rows) {
  const gzip = createGzip({ level: 9 });
  const out = createWriteStream(path);
  const done = pipeline(gzip, out);
  gzip.write(header.join(',') + '\n');
  for (const row of rows) {
    const line = header.map((h) => escapeCsv(row[h])).join(',') + '\n';
    if (!gzip.write(line)) await once(gzip, 'drain');
  }
  gzip.end();
  await done;
  return statSync(path).size;
}

// Voll-Parse-Streaming fuer kleine/mittlere Dateien.
async function streamCsv(path, onRow) {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf-8' }), crlfDelay: Infinity });
  let header = null, count = 0;
  for await (const line of rl) {
    if (header === null) { header = parseCsvLine(line); continue; }
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = f[i] ?? '';
    onRow(row, count++);
  }
  return count;
}

function readFeedInfo(path) {
  const leer = { feed_version: '', feed_start_date: '', feed_end_date: '', feed_publisher_name: '' };
  try {
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return leer;
    const h = parseCsvLine(lines[0]);
    const v = parseCsvLine(lines[1]);
    const o = {};
    for (let i = 0; i < h.length; i++) o[h[i]] = v[i] ?? '';
    // RAW-Werte aus feed_info.txt; die Normalisierung auf YYYY-MM-DD macht
    // feedVersionDatum() — KEIN hartcodiertes Fallback-Datum mehr (waere im
    // unbeaufsichtigten Wochen-Job eine stille Falsch-Version).
    return {
      feed_version: (o.feed_version || '').trim(),
      feed_start_date: (o.feed_start_date || '').trim(),
      feed_end_date: (o.feed_end_date || '').trim(),
      feed_publisher_name: (o.feed_publisher_name || '').trim(),
    };
  } catch {
    return leer;
  }
}

/**
 * Bestimmt feed_version als reines YYYY-MM-DD (monoton, in der App per ===
 * vergleichbar). Fallback-Kette fuer den unbeaufsichtigten Server-Job — ohne
 * stilles Falsch-Datum: schlaegt alles fehl -> throw (Wochen-Job bricht ab,
 * die App behaelt den gecachten Feed = offline-tolerant).
 *   1) feed_info.feed_version[0:10], wenn YYYY-MM-DD   (Primaer, monoton steigend)
 *   2) feed_start_date "YYYYMMDD" -> "YYYY-MM-DD"      (Notnagel, NICHT monoton)
 *   3) Datum aus ZIP-Dateiname ^...(YYYY)(MM)(DD)      (nur datierte manuelle ZIP)
 *   4) sonst: throw
 */
function feedVersionDatum(fi, zipPath) {
  const isoDatum = /^\d{4}-\d{2}-\d{2}$/;
  // 1) feed_version-Stempel (z.B. "2026-05-16T13:26:00") -> erste 10 Zeichen
  const v10 = (fi.feed_version || '').slice(0, 10);
  if (isoDatum.test(v10)) return v10;
  // 2) feed_start_date "YYYYMMDD"
  const sd = (fi.feed_start_date || '').trim();
  if (/^\d{8}$/.test(sd)) {
    const datum = `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}`;
    log(`[WARN] feed_version unbrauchbar ("${fi.feed_version}") -> Fallback feed_start_date ${datum} (NICHT monoton!)`);
    return datum;
  }
  // 3) Datum aus dem ZIP-Dateinamen (greift nur bei datierter manueller ZIP)
  const m = String(zipPath).match(/(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const datum = `${m[1]}-${m[2]}-${m[3]}`;
    log(`[WARN] feed_version + feed_start_date unbrauchbar -> Fallback ZIP-Dateiname ${datum}`);
    return datum;
  }
  // 4) nichts Verwertbares -> harter Abbruch (kein stilles Falsch-Datum)
  throw new Error(
    `Kann feed_version nicht als YYYY-MM-DD bestimmen ` +
    `(feed_version="${fi.feed_version}", feed_start_date="${fi.feed_start_date}", zip="${zipPath}")`,
  );
}

const norm = (s) => (s || '').replace(/\s+/g, '').toUpperCase();
const mb = (b) => (b / 1048576).toFixed(2);

// ---- Hauptlauf ----

async function run() {
  const t0 = Date.now();
  if (!existsSync(ZIP_PATH)) throw new Error(`ZIP nicht gefunden: ${ZIP_PATH}`);
  if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(REPORT, ''); // Report frisch

  report('===== DELFI -> Bayern-Schiene Filter =====');
  report(`Input : ${ZIP_PATH}`);
  report(`Output: ${OUT_DIR}  (assets/gtfs/ bleibt unangetastet)`);
  report('');

  // --- 0) selektiv entpacken (nur benoetigte Dateien) ---
  const NEEDED = ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt',
    'calendar.txt', 'calendar_dates.txt', 'agency.txt', 'feed_info.txt'];
  log('[Extract] entpacke benoetigte Dateien nach Temp (tar/bsdtar)...');
  // bsdtar entpackt ZIPs selektiv. Windows-`tar` IST bsdtar; auf Linux/CI heisst
  // es `bsdtar` (Paket libarchive-tools). GNU tar kann KEINE ZIPs -> Plattform-Wahl.
  const tarCmd = process.platform === 'win32' ? 'tar' : 'bsdtar';
  execSync(`${tarCmd} -xf "${ZIP_PATH}" -C "${WORK_DIR}" ${NEEDED.join(' ')}`, { stdio: 'inherit' });
  for (const f of NEEDED) {
    if (!existsSync(join(WORK_DIR, f))) throw new Error(`fehlt nach Extract: ${f}`);
  }
  const P = (f) => join(WORK_DIR, f);

  const fi = readFeedInfo(P('feed_info.txt'));
  const feedVersion = feedVersionDatum(fi, ZIP_PATH); // YYYY-MM-DD oder throw
  report(`feed_info: feed_version roh="${fi.feed_version}" -> normalisiert="${feedVersion}" | gueltig ${fi.feed_start_date}..${fi.feed_end_date} publisher="${fi.feed_publisher_name}"`);
  report('');

  // --- PASS A: routes.txt -> route_type-Verteilung + Schiene-Whitelist ---
  log('[Pass A] routes.txt ...');
  const railRoutes = [];
  const railRouteIds = new Set();
  const typeCounts = new Map();
  await streamCsv(P('routes.txt'), (row) => {
    const rt = (row.route_type ?? '').trim();
    typeCounts.set(rt, (typeCounts.get(rt) || 0) + 1);
    if (RAIL_TYPES.has(rt)) {
      railRouteIds.add(row.route_id);
      railRoutes.push({
        route_id: row.route_id,
        short_name: (row.route_short_name || '').trim(),
        long_name: (row.route_long_name || '').trim(),
        agency_id: row.agency_id,
        route_color: row.route_color || '',
        route_type: rt,
      });
    }
  });

  report('--- (2) route_type-Verteilung (alle Linien deutschlandweit) ---');
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const unknownRail = [];
  for (const [rt, c] of sortedTypes) {
    const isRail = RAIL_TYPES.has(rt);
    const known = isRail || KNOWN_NONRAIL.has(rt);
    const n = Number(rt);
    // GTFS-Erweiterungsbereich 100..117 = "Railway Service" -> potenziell Schiene
    const potRail = !known && Number.isFinite(n) && n >= 100 && n <= 117;
    if (potRail) unknownRail.push([rt, c]);
    const tag = isRail ? 'SCHIENE (Whitelist)' : (potRail ? '!!! UNBEKANNT-EVTL-SCHIENE' : (known ? 'nicht-Schiene' : 'unbekannt (nicht-Schiene)'));
    report(`  route_type=${String(rt).padEnd(5)} ${String(c).padStart(7)}  ${tag}`);
  }
  report(`  -> ${railRoutes.length} Schienen-Routen (von ${[...typeCounts.values()].reduce((a, b) => a + b, 0)} gesamt)`);
  report('');

  if (unknownRail.length) {
    report('!!!!! STOP: unbekannte route_type-Codes im Schienen-Bereich (100..117) gefunden:');
    for (const [rt, c] of unknownRail) report(`        route_type=${rt} (${c} Linien) -- NICHT in Whitelist {2,101,102,103,106,109}`);
    report('        Kein Raten. Bitte entscheiden, ob diese Codes Schiene sind, bevor weitergefiltert wird.');
    log('\nABBRUCH wegen unbekannter Schienen-Codes -- siehe _report.txt');
    rmSync(WORK_DIR, { recursive: true, force: true });
    process.exit(2);
  }

  // Referenzlinien-Definitionen (Cross-Validation). Match ueber route_short_name.
  const refDefs = [
    { label: 'RE 10', match: (r) => norm(r.short_name) === 'RE10' },
    { label: 'S 2 Muenchen', match: (r) => norm(r.short_name) === 'S2' },
    { label: 'S 4 Muenchen', match: (r) => norm(r.short_name) === 'S4' },
    { label: 'ICE 28', match: (r) => norm(r.short_name) === 'ICE28' || (norm(r.short_name) === '28' && ['101', '102', '103'].includes(r.route_type)) },
  ];
  const refToRouteIds = new Map();
  const refRouteIdSet = new Set();
  for (const def of refDefs) {
    const ids = railRoutes.filter(def.match).map((r) => r.route_id);
    refToRouteIds.set(def.label, ids);
    ids.forEach((id) => refRouteIdSet.add(id));
  }

  // --- PASS B: stops.txt -> Bayern-Set (de:09, normalisiert) ---
  log('[Pass B] stops.txt -> Bayern-Set ...');
  const bayernStopIds = new Set();
  let stopsTotal = 0;
  await streamCsv(P('stops.txt'), (row) => {
    stopsTotal++;
    if (isBayern(row.stop_id)) bayernStopIds.add(row.stop_id);
  });
  log(`  -> ${bayernStopIds.size} Bayern-Halte von ${stopsTotal}`);

  // --- PASS C: trips.txt -> Rail-Trips (route_id in railRouteIds) ---
  log('[Pass C] trips.txt -> Rail-Trips ...');
  const railTrips = new Map(); // trip_id -> { route_id, service_id }
  await streamCsv(P('trips.txt'), (row) => {
    if (railRouteIds.has(row.route_id)) {
      railTrips.set(row.trip_id, { route_id: row.route_id, service_id: row.service_id });
    }
  });
  log(`  -> ${railTrips.size} Rail-Trips`);

  // --- PASS D: stop_times Stream #1 -> bayernTripIds (Border-Crossing-Erkennung) ---
  log('[Pass D] stop_times Stream #1 (Border-Crossing) ...');
  const bayernTripIds = new Set();
  {
    const rl = createInterface({ input: createReadStream(P('stop_times.txt'), { encoding: 'utf-8' }), crlfDelay: Infinity });
    let tIdx = -1, sIdx = -1, scanned = 0, headerDone = false;
    for await (const line of rl) {
      if (!headerDone) {
        const h = parseCsvLine(line);
        tIdx = h.indexOf('trip_id'); sIdx = h.indexOf('stop_id');
        if (tIdx < 0 || sIdx < 0) throw new Error('stop_times: trip_id/stop_id Spalte fehlt');
        headerDone = true;
        continue;
      }
      if (line.length === 0) continue;
      scanned++;
      if (scanned % 5_000_000 === 0) log(`    [D] ${(scanned / 1e6).toFixed(0)}M Zeilen ...`);
      const tid = getField(line, tIdx);
      if (!railTrips.has(tid)) continue;
      if (bayernTripIds.has(tid)) continue;
      if (isBayern(getField(line, sIdx))) bayernTripIds.add(tid);
    }
    log(`  -> ${bayernTripIds.size} Bayern-Schiene-Trips (von ${scanned} stop_times gescannt)`);
  }

  // --- PASS E: stop_times Stream #2 -> stop_times.csv.gz schreiben + keptStopIds ---
  log('[Pass E] stop_times Stream #2 (schreiben) ...');
  const keptStopIds = new Set();
  const crossBorder = new Map(); // trip_id -> bool (hat >=1 Nicht-Bayern-Halt)
  const refTrips = new Map();    // route_id -> Set<trip_id>  (nur Referenzlinien)
  const refStops = new Map();    // route_id -> Set<stop_id>  (nur Referenzlinien)
  const sizes = {};
  let stWritten = 0;
  {
    const gzip = createGzip({ level: 9 });
    const out = createWriteStream(join(OUT_DIR, 'stop_times.csv.gz'));
    const done = pipeline(gzip, out);
    gzip.write('trip_id,stop_sequence,stop_id,arrival_time,departure_time\n');
    const rl = createInterface({ input: createReadStream(P('stop_times.txt'), { encoding: 'utf-8' }), crlfDelay: Infinity });
    let tIdx = -1, seqIdx = -1, sIdx = -1, aIdx = -1, dIdx = -1, scanned = 0, headerDone = false;
    for await (const line of rl) {
      if (!headerDone) {
        const h = parseCsvLine(line);
        tIdx = h.indexOf('trip_id'); seqIdx = h.indexOf('stop_sequence'); sIdx = h.indexOf('stop_id');
        aIdx = h.indexOf('arrival_time'); dIdx = h.indexOf('departure_time');
        if ([tIdx, seqIdx, sIdx, aIdx, dIdx].some((x) => x < 0)) throw new Error('stop_times: Pflichtspalte fehlt');
        headerDone = true;
        continue;
      }
      if (line.length === 0) continue;
      scanned++;
      if (scanned % 5_000_000 === 0) log(`    [E] ${(scanned / 1e6).toFixed(0)}M Zeilen ...`);
      const tid = getField(line, tIdx);
      if (!bayernTripIds.has(tid)) continue;
      // Voll-Parse NUR fuer behaltene Zeilen: arrival_time/departure_time liegen
      // bei DELFI hinter stop_headsign (kann Kommas enthalten) -> Komma-Scan
      // waere unsicher. Behaltene Zeilen sind die Minderheit -> Kosten ok.
      const f = parseCsvLine(line);
      const sid = f[sIdx];
      const seq = f[seqIdx];
      const arr = f[aIdx];
      const dep = f[dIdx];
      keptStopIds.add(sid);
      if (!isBayern(sid)) crossBorder.set(tid, true);
      else if (!crossBorder.has(tid)) crossBorder.set(tid, false);
      const rid = railTrips.get(tid).route_id;
      if (refRouteIdSet.has(rid)) {
        let ts = refTrips.get(rid); if (!ts) { ts = new Set(); refTrips.set(rid, ts); } ts.add(tid);
        let ss = refStops.get(rid); if (!ss) { ss = new Set(); refStops.set(rid, ss); } ss.add(sid);
      }
      const outLine = `${escapeCsv(tid)},${seq},${escapeCsv(sid)},${arr},${dep}\n`;
      if (!gzip.write(outLine)) await once(gzip, 'drain');
      stWritten++;
    }
    gzip.end();
    await done;
    sizes.stop_times = statSync(join(OUT_DIR, 'stop_times.csv.gz')).size;
    log(`  -> ${stWritten} stop_times geschrieben, ${keptStopIds.size} Unique Stops (inkl. Nicht-Bayern auf Grenz-Trips)`);
  }

  // --- abgeleitete Mengen ---
  const keptTrips = [];
  const keptRouteIds = new Set();
  const keptServiceIds = new Set();
  for (const tid of bayernTripIds) {
    const r = railTrips.get(tid);
    keptTrips.push({ trip_id: tid, route_id: r.route_id, service_id: r.service_id });
    keptRouteIds.add(r.route_id);
    keptServiceIds.add(r.service_id);
  }
  const keptRoutes = railRoutes.filter((r) => keptRouteIds.has(r.route_id));
  const keptAgencyIds = new Set(keptRoutes.map((r) => r.agency_id).filter(Boolean));

  // --- PASS F: stops.txt erneut -> nur keptStopIds ---
  log('[Pass F] stops.txt -> behaltene Halte ...');
  const keptStops = [];
  await streamCsv(P('stops.txt'), (row) => {
    if (keptStopIds.has(row.stop_id)) {
      keptStops.push({
        stop_id: row.stop_id,
        name: row.stop_name,
        lat: row.stop_lat,
        lon: row.stop_lon,
        parent_station: row.parent_station || '',
        platform_code: row.platform_code || '',
      });
    }
  });

  // calendar + calendar_dates (nur kept service_ids)
  log('[Rest] calendar / calendar_dates / agency ...');
  const calendar = [];
  await streamCsv(P('calendar.txt'), (row) => { if (keptServiceIds.has(row.service_id)) calendar.push(row); });
  const calendarDates = [];
  await streamCsv(P('calendar_dates.txt'), (row) => { if (keptServiceIds.has(row.service_id)) calendarDates.push(row); });
  const agencies = [];
  await streamCsv(P('agency.txt'), (row) => { if (keptAgencyIds.has(row.agency_id)) agencies.push({ agency_id: row.agency_id, agency_name: row.agency_name }); });

  // --- gzip-Ausgabe (gleiche Struktur/Spalten wie assets/gtfs/) ---
  log('[Write] gzip-CSVs ...');
  sizes.stops = await writeGzCsv(join(OUT_DIR, 'stops.csv.gz'),
    ['stop_id', 'name', 'lat', 'lon', 'parent_station', 'platform_code'], keptStops);
  sizes.routes = await writeGzCsv(join(OUT_DIR, 'routes.csv.gz'),
    ['route_id', 'short_name', 'long_name', 'agency_id', 'route_color'], keptRoutes);
  sizes.trips = await writeGzCsv(join(OUT_DIR, 'trips.csv.gz'),
    ['trip_id', 'route_id', 'service_id'], keptTrips);
  sizes.calendar = await writeGzCsv(join(OUT_DIR, 'calendar.csv.gz'),
    ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], calendar);
  sizes.calendar_dates = await writeGzCsv(join(OUT_DIR, 'calendar_dates.csv.gz'),
    ['service_id', 'date', 'exception_type'], calendarDates);
  sizes.agencies = await writeGzCsv(join(OUT_DIR, 'agencies.csv.gz'),
    ['agency_id', 'agency_name'], agencies);

  // --- meta.json (Attribution auf DELFI umgestellt) ---
  const totalGz = Object.values(sizes).reduce((a, b) => a + b, 0);
  const meta = {
    source: 'opendata-oepnv.de (DELFI)',
    license: 'CC BY',
    license_url: 'http://opendefinition.org/licenses/cc-by/',
    attribution: '© DELFI e.V.',
    scope: 'bayern-rail',
    generated_at: new Date().toISOString(),
    feed_version: feedVersion,
    feed_start_date: fi.feed_start_date,
    feed_end_date: fi.feed_end_date,
    counts: {
      routes: keptRoutes.length,
      trips: keptTrips.length,
      stops: keptStops.length,
      stop_times: stWritten,
      calendar: calendar.length,
      calendar_dates: calendarDates.length,
      agencies: agencies.length,
    },
    sizes_gz_bytes: sizes,
  };
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  // --- (3) VALIDIERUNG: 5 Referenzlinien + Border-Crossing (Hard-Gate) ---
  report('--- (3) VALIDIERUNG Referenzlinien (Hard-Gate) ---');
  report(`  ${'Linie'.padEnd(16)} ${'route_id(s)'.padEnd(10)} ${'#Trips'.padStart(7)} ${'#Halte'.padStart(7)}  Status`);
  let allOk = true;
  for (const def of refDefs) {
    const ids = refToRouteIds.get(def.label);
    const tripSet = new Set(), stopSet = new Set();
    for (const id of ids) {
      const ts = refTrips.get(id); if (ts) ts.forEach((t) => tripSet.add(t));
      const ss = refStops.get(id); if (ss) ss.forEach((s) => stopSet.add(s));
    }
    const ok = tripSet.size > 0;
    if (!ok) allOk = false;
    report(`  ${def.label.padEnd(16)} ${String(ids.length).padEnd(10)} ${String(tripSet.size).padStart(7)} ${String(stopSet.size).padStart(7)}  ${ok ? 'OK' : 'FEHLT'}`);
  }
  let crossBorderTrips = 0;
  for (const v of crossBorder.values()) if (v) crossBorderTrips++;
  const cbOk = crossBorderTrips > 0;
  if (!cbOk) allOk = false;
  report(`  ${'Border-Crossing'.padEnd(16)} ${'(strukt.)'.padEnd(10)} ${String(crossBorderTrips).padStart(7)} ${'-'.padStart(7)}  ${cbOk ? 'OK' : 'FEHLT'}`);
  report('    (Border-Crossing = Bayern-Trips mit >=1 Nicht-Bayern-Halt; deckt die');
  report('     "RE Aschaffenburg-Frankfurt"- und "ICE 28 ->Hamburg"-Klasse ab)');

  // erreichte Bundeslaender (Beleg, dass Grenz-Halte mitkamen)
  const blPrefix = new Map();
  for (const sid of keptStopIds) {
    const m = sid.match(/^de:(\d)(\d)?/);
    let bl = '?';
    if (m) bl = sid.startsWith('de:9') ? '09' : (m[1] + (m[2] ?? '0'));
    blPrefix.set(bl, (blPrefix.get(bl) || 0) + 1);
  }
  const blSorted = [...blPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  report('    erreichte stop-Praefixe (Top): ' + blSorted.map(([k, v]) => `de:${k}=${v}`).join('  '));
  report('');

  // --- (4) Mengengeruest-Vergleich ---
  report('--- (4) Mengengeruest: DELFI-Bayern-Schiene vs. heutiger gtfs.de-Feed ---');
  report(`  ${'Metrik'.padEnd(16)} ${'NEU (DELFI)'.padStart(14)} ${'ALT (gtfs.de)'.padStart(14)}`);
  report(`  ${'routes'.padEnd(16)} ${String(keptRoutes.length).padStart(14)} ${String(1063).padStart(14)}`);
  report(`  ${'trips'.padEnd(16)} ${String(keptTrips.length).padStart(14)} ${String(119274).padStart(14)}`);
  report(`  ${'stop_times'.padEnd(16)} ${String(stWritten).padStart(14)} ${String(1712193).padStart(14)}`);
  report(`  ${'stops'.padEnd(16)} ${String(keptStops.length).padStart(14)} ${String(9082).padStart(14)}`);
  report(`  ${'agencies'.padEnd(16)} ${String(agencies.length).padStart(14)} ${String(145).padStart(14)}`);
  report(`  ${'Bundle gz (MB)'.padEnd(16)} ${mb(totalGz).padStart(14)} ${'~12.0'.padStart(14)}`);
  report('  Groessen je Datei (gz):');
  for (const [k, v] of Object.entries(sizes)) report(`    ${k.padEnd(16)} ${(v / 1024).toFixed(0).padStart(8)} KB`);
  report('');

  // --- (5) Lizenz-Wortlaut ---
  report('--- (5) Lizenz / Namensnennung (aus feed_info.txt + Beschreibung-PDF) ---');
  report(`  feed_publisher_name : "${fi.feed_publisher_name}"`);
  report('  PDF Lizenz-URL      : http://opendefinition.org/licenses/cc-by/  (= CC BY, unversioniert)');
  report('  PDF Nutzungsbeding. : "Lizenzpflichtig, derzeit ohne Gebuehren"');
  report('  PDF Dateneigner     : DELFI e.V., Am Hauptbahnhof 6, 60329 Frankfurt am Main');
  report(`  -> meta.json: source="${meta.source}" license="${meta.license}" attribution="(c) DELFI e.V."`);
  report('');

  report(`Gesamtlaufzeit: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  report(allOk ? '>>> VALIDIERUNG OK (alle Referenzlinien + Border-Crossing > 0)' : '>>> VALIDIERUNG FEHLGESCHLAGEN -- NICHT freigeben');

  rmSync(WORK_DIR, { recursive: true, force: true });
  if (!allOk) process.exit(3);
}

run().catch((err) => {
  log(`\nFatal: ${err.stack || err.message}`);
  try { appendFileSync(REPORT, `\nFatal: ${err.message}\n`); } catch {}
  process.exit(1);
});
