# Fahrplan-Roboter — Status

> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.
> Zuletzt aktualisiert: **24.11.2026, 16:00 Uhr** (Berliner Zeit)

---

## 1. Roboter-Lauf (dienstags 04:00 UTC)

✅ **OK — neuer Fahrplan übernommen**

| | |
|---|---|
| Zeitpunkt | 24.11.2026, 16:00 Uhr |
| Fahrplan-Stand in `feed/` | 2026-11-21 (vor 3 Tagen) |
| Daten | 33.093 Fahrten · 299 Linien · 3.073 Halte |
| Nach `feed/` übernommen | ja |
| Plausibilitäts-Prüfung | an (Schwelle 50 %) |

---

## 2. Wächter-Lauf (samstags 06:00 UTC)

Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.

✅ **OK — der Fahrplan ist frisch genug**

| | |
|---|---|
| Zeitpunkt | 21.11.2026, 15:26 Uhr |
| Fahrplan-Stand in `feed/` | 2026-11-14 (7 Tage alt) |
| Erlaubt | höchstens 10 Tage |
| Laut Daten gültig bis | 2027-03-31 |

---

## Zeichen-Erklärung

| Zeichen | Bedeutung |
|---|---|
| ✅ OK | alles in Ordnung |
| ⚠️ Keine Änderung | der Lauf war erfolgreich, es gab aber nichts Neues — **kein Fehler** |
| ❌ FEHLGESCHLAGEN | es kamen keine brauchbaren Daten — der alte Fahrplan bleibt stehen |

Der Fahrplan-Inhalt selbst (die `.csv.gz`-Dateien und `feed/meta.json`) wird hier nie beschrieben.
