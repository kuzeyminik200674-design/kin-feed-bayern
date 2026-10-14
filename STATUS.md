# Fahrplan-Roboter — Status

> **Diese Datei schreibt der Roboter selbst** — bitte nicht von Hand ändern.
> Zuletzt aktualisiert: **14.10.2026, 20:06 Uhr** (Berliner Zeit)

---

## 1. Roboter-Lauf (dienstags 04:00 UTC)

**Noch kein Lauf protokolliert.** Der erste Lauf schreibt hier seinen Status hinein.

---

## 2. Wächter-Lauf (samstags 06:00 UTC)

Der Wächter lädt nichts herunter. Er prüft nur, ob der Fahrplan in `feed/` zu alt geworden ist — also ob der Dienstags-Lauf heimlich nicht mehr stattfindet.

**Noch kein Wächter-Lauf protokolliert.**

---

## Zeichen-Erklärung

| Zeichen | Bedeutung |
|---|---|
| ✅ OK | alles in Ordnung |
| ⚠️ Keine Änderung | der Lauf war erfolgreich, es gab aber nichts Neues — **kein Fehler** |
| ❌ FEHLGESCHLAGEN | es kamen keine brauchbaren Daten — der alte Fahrplan bleibt stehen |

Der Fahrplan-Inhalt selbst (die `.csv.gz`-Dateien und `feed/meta.json`) wird hier nie beschrieben.
