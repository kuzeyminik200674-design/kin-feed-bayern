# Fahrplan-Roboter — Status

> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.
> Zuletzt aktualisiert: **31.10.2026, 12:56 Uhr** (Berliner Zeit)

---

## 1. Roboter-Lauf (dienstags 04:00 UTC)

✅ **OK — neuer Fahrplan übernommen**

| | |
|---|---|
| Zeitpunkt | 27.10.2026, 10:54 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-24 (vor 7 Tagen) |
| Daten | 26.452 Fahrten · 249 Linien · 2.537 Halte |
| Nach `feed/` übernommen | ja |
| Plausibilitäts-Prüfung | an (Schwelle 50 %) |

---

## 2. Wächter-Lauf (samstags 06:00 UTC)

Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.

✅ **OK — der Fahrplan ist frisch genug**

| | |
|---|---|
| Zeitpunkt | 31.10.2026, 12:56 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-24 (7 Tage alt) |
| Erlaubt | höchstens 10 Tage |
| Laut Daten gültig bis | 2026-12-12 |

---

## Zeichen-Erklärung

| Zeichen | Bedeutung |
|---|---|
| ✅ OK | alles in Ordnung |
| ⚠️ Keine Änderung | der Lauf war erfolgreich, es gab aber nichts Neues — **kein Fehler** |
| ❌ FEHLGESCHLAGEN | es kamen keine brauchbaren Daten — der alte Fahrplan bleibt stehen |

Der Fahrplan-Inhalt selbst (die `.csv.gz`-Dateien und `feed/meta.json`) wird hier nie beschrieben.
