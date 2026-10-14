# Fahrplan-Roboter — Status

> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.
> Zuletzt aktualisiert: **14.10.2026, 21:03 Uhr** (Berliner Zeit)

---

## 1. Roboter-Lauf (dienstags 04:00 UTC)

⚠️ **Keine Änderung — es gab nichts Neues** (kein Fehler)

| | |
|---|---|
| Zeitpunkt | 14.10.2026, 21:02 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-10 (vor 4 Tagen) |
| Daten | 25.845 Fahrten · 250 Linien · 3.501 Halte |
| Nach `feed/` übernommen | nein |
| Plausibilitäts-Prüfung | an (Schwelle 50 %) |

---

## 2. Wächter-Lauf (samstags 06:00 UTC)

Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.

✅ **OK — der Fahrplan ist frisch genug**

| | |
|---|---|
| Zeitpunkt | 14.10.2026, 21:03 Uhr |
| Fahrplan-Stand in `feed/` | 2026-10-10 (4 Tage alt) |
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
