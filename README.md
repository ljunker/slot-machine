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

## Mit Docker starten

```bash
docker compose up --build -d
```

Frontend: <http://127.0.0.1:5173>. API-Dokumentation: <http://127.0.0.1:8000/docs>. Frontend und Backend werden getrennt gebaut. Die SQLite-Datenbank liegt im Docker-Volume `schedule_data` und bleibt beim Stoppen der Container erhalten.

```bash
docker compose down
```

## Bedienung

Veranstaltung, Tage und Räume links anlegen. Slots über **+ Slot** anlegen oder per Formular bearbeiten. Am Kopf einer Slot-Karte ziehen, um Zeit und Raum zu ändern; an der unteren Kante ziehen, um die Endzeit zu ändern. Ziehen rastet in 15-Minuten-Schritten ein. Die API nimmt auch andere gültige Uhrzeiten an.

Beim Löschen einer Veranstaltung, eines Tages oder Raums werden zugehörige Slots mitgelöscht. Eine Änderung der Event- oder Tagesgrenzen, die vorhandene Daten ausschließen würde, liefert HTTP `409`. Ungültige Zeiträume oder Beziehungen liefern `400`, fehlende Objekte `404`.

Rednerprofile werden pro Veranstaltung angelegt. Ein Slot kann mehrere Profile erhalten. Gleichzeitige Einsätze eines Redners in verschiedenen Räumen erscheinen als Warnung im Tagesplan; Speichern bleibt möglich. Bestehende Freitextnamen werden beim ersten Start mit der neuen Version einmalig als Profile übernommen. Der gesamte bisherige Feldinhalt wird dabei als ein Name behandelt. Neue Slot-Schreibzugriffe verwenden `speaker_ids` statt `speaker`.

Fotos können als JPEG, PNG oder WebP bis 5 MB hochgeladen werden. Lokal liegen sie standardmäßig in `./uploads`, konfigurierbar mit `SPEAKER_UPLOAD_DIR`. Im Docker-Betrieb liegen sie zusammen mit der Datenbank im Volume `schedule_data`. Die Profil-API hat wie die übrige Planungs-API keine Anmeldung; die Besucheroberfläche zeigt nur Rednernamen.

Über **Besucherprogramm ansehen** öffnet sich die öffentliche Tagesansicht unter `/programm/<event_id>`. Besucher können Tage wechseln und Slot-Beschreibungen lesen. Auf Smartphones wechseln Raum-Tabs zwischen den Programmen. Die Oberfläche bietet keine Bearbeitung; die API hat weiterhin keine Anmeldung oder Veröffentlichungsfreigabe.

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
