# Event Scheduler

MVP für mehrtägige Veranstaltungen mit mehreren Räumen. Die Tagesansicht zeigt Slots auf einer gemeinsamen Zeitachse. Kollisionen bleiben erlaubt und werden rot markiert.

## Starten

Python 3.13, `uv` und Node.js werden benötigt.

```bash
uv sync --dev
uv run uvicorn app.main:app --reload
```

In einem zweiten Terminal:

```bash
cd frontend
npm ci
npm run dev
```

Frontend: <http://127.0.0.1:5173>. API-Dokumentation: <http://127.0.0.1:8000/docs>. Standardmäßig liegt die SQLite-Datenbank in `schedule.db`. Für andere lokale Datenbanken kann `DATABASE_URL` gesetzt werden.

## Bedienung

Veranstaltung, Tage und Räume links anlegen. Slots über **+ Slot** anlegen oder per Formular bearbeiten. Am Kopf einer Slot-Karte ziehen, um Zeit und Raum zu ändern; an der unteren Kante ziehen, um die Endzeit zu ändern. Ziehen rastet in 15-Minuten-Schritten ein. Die API nimmt auch andere gültige Uhrzeiten an.

Beim Löschen einer Veranstaltung, eines Tages oder Raums werden zugehörige Slots mitgelöscht. Eine Änderung der Event- oder Tagesgrenzen, die vorhandene Daten ausschließen würde, liefert HTTP `409`. Ungültige Zeiträume oder Beziehungen liefern `400`, fehlende Objekte `404`.

## Tests

```bash
uv run python -m pytest -q
cd frontend
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Der Browsertest startet Backend und Frontend selbst und nutzt eine eigene temporäre SQLite-Datenbank.
