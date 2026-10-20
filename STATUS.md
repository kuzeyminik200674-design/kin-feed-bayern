# Fahrplan-Roboter — Status

> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.
> Zuletzt aktualisiert: **20.10.2026, 11:31 Uhr** (Berliner Zeit)

---

## 1. Roboter-Lauf (dienstags 04:00 UTC)

✅ **OK — neuer Fahrplan übernommen**

| | |
|---|---|
| Zeitpunkt | 20.10.2026, 11:31 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-17 (vor 3 Tagen) |
| Daten | 26.786 Fahrten · 248 Linien · 3.478 Halte |
| Nach `feed/` übernommen | ja |
| Plausibilitäts-Prüfung | an (Schwelle 50 %) |

---

## 2. Wächter-Lauf (samstags 06:00 UTC)

Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.

✅ **OK — der Fahrplan ist frisch genug**

| | |
|---|---|
| Zeitpunkt | 17.10.2026, 12:23 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-10 (7 Tage alt) |
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
