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

Über **+ Session** in der Seitenleiste entstehen ungeplante Sessions ohne Tag, Raum und Uhrzeit. Sie gehören zur gewählten Veranstaltung und erscheinen noch nicht im Besucherprogramm oder PDF. Zum Einplanen eine Session in eine Raumspalte des gewählten Tages ziehen; der Beginn rastet in 15-Minuten-Schritten ein und die erste Dauer beträgt 60 Minuten. Alternativ im Editor Tag, Raum und Zeiten wählen. **Planung entfernen** legt eine geplante Session zurück in die Liste. Ist im Tagesplan kein Platz für 60 Minuten, kann im Editor eine kürzere Dauer gewählt werden.

Beim Löschen eines Tages oder Raums bleiben zugehörige Sessions samt Inhalten und Rednern erhalten und werden ungeplant. Beim Löschen einer Veranstaltung werden alle ihre Sessions mitgelöscht. Eine Änderung der Event- oder Tagesgrenzen, die vorhandene Daten ausschließen würde, liefert HTTP `409`. Ungültige Zeiträume oder Beziehungen liefern `400`, fehlende Objekte `404`.

Rednerprofile werden pro Veranstaltung angelegt. Ein Slot kann mehrere Profile erhalten. Gleichzeitige Einsätze eines Redners in verschiedenen Räumen erscheinen als Warnung im Tagesplan; Speichern bleibt möglich. Bestehende Freitextnamen werden beim ersten Start mit der neuen Version einmalig als Profile übernommen. Der gesamte bisherige Feldinhalt wird dabei als ein Name behandelt. Neue Slot-Schreibzugriffe verwenden `speaker_ids` statt `speaker`.

Helfer werden pro Veranstaltung in der Seitenleiste angelegt. Über **+ Dienst** entstehen allgemeine Dienste, Raumdienste oder Dienste für eine Session. Ein Dienst kann offen bleiben oder mehrere Helfer erhalten. Im internen Tagesplan stehen allgemeine Dienste in einer eigenen Spalte; neben jedem Raumprogramm gibt es eine Spalte **Helferdienste**. Session-Dienste folgen automatisch Zeit und Raum ihrer Session. Bei Absage oder Entplanung bleiben sie als inaktiv in den Helferdetails erhalten. Überschneidungen eines Helfers werden als Warnung angezeigt; eine allgemeine Schicht darf einen kürzeren Dienst abdecken, ein Raumdienst eine enthaltene Session im selben Raum. Das Besucherprogramm und das Programm-PDF enthalten keine Helferdaten. Die Helfer-API ist wie die übrige Planungs-API nicht durch eine Anmeldung geschützt.

Fotos können als JPEG, PNG oder WebP bis 5 MB hochgeladen werden. Lokal liegen sie standardmäßig in `./uploads`, konfigurierbar mit `SPEAKER_UPLOAD_DIR`. Im Docker-Betrieb liegen sie zusammen mit der Datenbank im Volume `schedule_data`. Die Profil-API hat wie die übrige Planungs-API keine Anmeldung; die Besucheroberfläche zeigt nur Rednernamen.

Über **Besucherprogramm ansehen** öffnet sich die öffentliche Tagesansicht unter `/programm/<event_id>`. Besucher können Tage wechseln und Slot-Beschreibungen lesen. Auf Smartphones wechseln Raum-Tabs zwischen den Programmen. Die Oberfläche bietet keine Bearbeitung; die API hat weiterhin keine Anmeldung oder Veröffentlichungsfreigabe.

Geplante Sessions haben eine eigene Seite unter `/programm/<event_id>/sessions/<session_id>`. Der Link steht in den Session-Details und auf Smartphones direkt an der Session. Er bleibt bei Zeit- und Raumänderungen gleich. Abgesagte Sessions bleiben erreichbar; ungeplante oder gelöschte Sessions haben keine öffentliche Detailseite.

Über **PDF-Programm herunterladen** lässt sich das aktuelle Gesamtprogramm aus Planungsansicht und Besucherprogramm laden. Jeder Veranstaltungstag belegt eine A4-Querseite mit Zeit-Raum-Raster. Slot-Karten zeigen auch Rednernamen; bei dichten Plänen werden Texte gekürzt.

Die Auswahl **Darstellung** bietet System, Hell und Dunkel. Sie gilt für Planungsansicht und Besucherprogramm und wird im Browser gespeichert. Das PDF bleibt hell.

Im Veranstaltungseditor kann eine Akzentfarbe gewählt und für bestehende Veranstaltungen ein Logo hochgeladen werden. Der Veranstaltungsname gilt auch im Besucherprogramm und PDF. Logo und Akzentfarbe erscheinen nur dort; die Planungsoberfläche behält ihre Bedienfarben. Logos können JPEG, PNG oder WebP bis 5 MB sein. Lokal liegen sie standardmäßig in `./uploads/logos`, konfigurierbar mit `EVENT_LOGO_DIR`. Im Docker-Betrieb liegen sie im Volume `schedule_data`. Das Logo kann ersetzt oder entfernt werden.

Änderungen an Zeit oder Raum markieren eine Session 24 Stunden als **Verschoben**; die vorherige Planung steht in den Details. Änderungen an Thema, Beschreibung oder Rednern erscheinen 24 Stunden als **Geändert**. Über **Session abgesagt** bleibt eine Session dauerhaft als **Abgesagt** im Programm, zählt aber nicht zu Konflikten. Nach Aufheben der Absage erscheint sie 24 Stunden als geändert. Im PDF stehen frühere Angaben nur, wenn die Karte genug Platz bietet. Offene Seiten laden neue Änderungen weiterhin erst nach Neuladen.

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
