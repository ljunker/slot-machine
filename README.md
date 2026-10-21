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

Frontend: <http://127.0.0.1:5173>. API-Dokumentation: <http://127.0.0.1:8000/docs>. Standardmäßig liegt die SQLite-Datenbank in `schedule.db`. Für andere lokale Datenbanken kann `DATABASE_URL` gesetzt werden. Vor der ersten Anmeldung einen Superadmin anlegen:

```bash
uv run python -m app.cli create-superadmin --email admin@example.org
```

## Mit Docker starten

Lokal aus den Quellen bauen und starten:

```bash
docker compose -f compose.yml -f compose.local.yaml up --build -d
```

Für den Server beide Multiarch-Images auf Docker Hub veröffentlichen. Dafür einmal `docker login` ausführen, dann:

```bash
./build-images.sh
```

Das Skript richtet bei Bedarf einen eigenen Buildx-Builder ein. Es baut und pusht `kryptikker/slot-machine-backend:latest` und `kryptikker/slot-machine-frontend:latest` für `linux/amd64` und `linux/arm64`. Auf dem Server `compose.yml` und eine passende `.env` bereitstellen und die fertigen Images starten:

```bash
docker compose pull
docker compose up -d
```

Frontend: <http://127.0.0.1:5173>. API-Dokumentation: <http://127.0.0.1:8000/docs>. Die SQLite-Datenbank liegt im Docker-Volume `schedule_data` und bleibt beim Stoppen der Container erhalten. Den ersten Superadmin im Container anlegen:

```bash
docker compose exec backend python -m app.cli create-superadmin --email admin@example.org
```

```bash
docker compose down
```

## Bedienung

Die Planung verlangt eine Anmeldung. Superadmins verwalten alle Benutzer und Veranstaltungen; nur sie erstellen oder löschen Veranstaltungen. Veranstaltungsadmins verwalten Stammdaten, Tage, Räume, Team und Backups ihrer zugewiesenen Veranstaltungen. Bearbeiter pflegen Sessions, Redner, Helfer und Dienste. Ein Konto kann mehreren Veranstaltungen mit verschiedenen Rollen angehören. Veranstaltungsadmins laden Teammitglieder per E-Mail ein; Superadmins können weitere Superadmins einladen oder Konten sperren. Es gibt keine öffentliche Registrierung.

Für Einladungen und Passwort-Reset `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` und bei Bedarf `SMTP_USERNAME`, `SMTP_PASSWORD` konfigurieren. Für SMTP mit direktem SSL/TLS (Port 465) `SMTP_SSL=true` setzen; für STARTTLS (üblicherweise Port 587) `SMTP_STARTTLS=true` verwenden. `PUBLIC_BASE_URL` muss auf die von Benutzern erreichbare Frontend-Adresse zeigen. Einladungen gelten 48 Stunden, Reset-Links eine Stunde. Für öffentliche Bereitstellung HTTPS verwenden und `AUTH_COOKIE_SECURE=true` setzen. Die Planungssitzung endet nach 12 Stunden; Änderungen verlangen zusätzlich einen CSRF-Token.

Beispiel für ein STRATO-E-Mail-Postfach in der lokalen, nicht einzucheckenden `.env` neben `compose.yml`:

```dotenv
SMTP_HOST=smtp.strato.de
SMTP_PORT=465
SMTP_SSL=true
SMTP_STARTTLS=false
SMTP_FROM=programm@example.org
SMTP_USERNAME=programm@example.org
SMTP_PASSWORD=POSTFACH_PASSWORT
PUBLIC_BASE_URL=https://programm.example.org
AUTH_COOKIE_SECURE=true
```

`SMTP_FROM` und `SMTP_USERNAME` durch die echte STRATO-Postfachadresse ersetzen. Das Passwort ist das Passwort dieses Postfachs. Nach Änderungen an `.env` den Backend-Container mit `docker compose up -d --force-recreate backend` neu erstellen; lokal dabei beide Compose-Dateien mit `-f` angeben.

Veranstaltung, Tage und Räume links anlegen. Slots über **+ Slot** anlegen oder per Formular bearbeiten. Am Kopf einer Slot-Karte ziehen, um Zeit und Raum zu ändern; an der unteren Kante ziehen, um die Endzeit zu ändern. Ziehen rastet in 15-Minuten-Schritten ein. Die API nimmt auch andere gültige Uhrzeiten an.

Über **+ Session** in der Seitenleiste entstehen ungeplante Sessions ohne Tag, Raum und Uhrzeit. Sie gehören zur gewählten Veranstaltung und erscheinen noch nicht im Besucherprogramm oder PDF. Zum Einplanen eine Session in eine Raumspalte des gewählten Tages ziehen; der Beginn rastet in 15-Minuten-Schritten ein und die erste Dauer beträgt 60 Minuten. Alternativ im Editor Tag, Raum und Zeiten wählen. **Planung entfernen** legt eine geplante Session zurück in die Liste. Ist im Tagesplan kein Platz für 60 Minuten, kann im Editor eine kürzere Dauer gewählt werden.

Beim Löschen eines Tages oder Raums bleiben zugehörige Sessions samt Inhalten und Rednern erhalten und werden ungeplant. Beim Löschen einer Veranstaltung werden alle ihre Sessions mitgelöscht. Eine Änderung der Event- oder Tagesgrenzen, die vorhandene Daten ausschließen würde, liefert HTTP `409`. Ungültige Zeiträume oder Beziehungen liefern `400`, fehlende Objekte `404`.

Rednerprofile werden pro Veranstaltung angelegt. Ein Slot kann mehrere Profile erhalten. Gleichzeitige Einsätze eines Redners in verschiedenen Räumen erscheinen als Warnung im Tagesplan; Speichern bleibt möglich. Bestehende Freitextnamen werden beim ersten Start mit der neuen Version einmalig als Profile übernommen. Der gesamte bisherige Feldinhalt wird dabei als ein Name behandelt. Neue Slot-Schreibzugriffe verwenden `speaker_ids` statt `speaker`.

Helfer werden pro Veranstaltung in der Seitenleiste angelegt. Über **+ Dienst** entstehen allgemeine Dienste, Raumdienste oder Dienste für eine Session. Ein Dienst kann offen bleiben oder mehrere Helfer erhalten. Im internen Tagesplan stehen allgemeine Dienste in einer eigenen Spalte; neben jedem Raumprogramm gibt es eine Spalte **Helferdienste**. Die Ansicht **Helferplan** zeigt denselben Tag mit breiteren Dienstspalten vor dem Raumprogramm. Bei parallelen Diensten wachsen die Spalten und der Plan lässt sich horizontal scrollen; Slots bleiben bearbeitbar. Dienste lassen sich am Kopf verschieben, innerhalb ihrer Spalte seitlich anordnen und am unteren Handle verlängern oder verkürzen. Die seitliche Reihenfolge bleibt nach dem Neuladen in beiden Planansichten erhalten. Session-Dienste ändern bei Raum- oder Zeitwechsel ihre zugehörige Session mit. Bei Absage oder Entplanung bleiben sie als inaktiv in den Helferdetails erhalten. Überschneidungen werden für jeden betroffenen Helfer als Warnung im Plan und in der Konfliktübersicht angezeigt; auch allgemeine Dienste zählen als eigenständige Aufgaben. Ein Raumdienst darf eine enthaltene Session im selben Raum abdecken. Das Besucherprogramm und das Programm-PDF enthalten keine Helferdaten. Die Helfer-API verlangt eine zugewiesene Planungsrolle.

Fotos können als JPEG, PNG oder WebP bis 5 MB hochgeladen werden. Lokal liegen sie standardmäßig in `./uploads`, konfigurierbar mit `SPEAKER_UPLOAD_DIR`. Im Docker-Betrieb liegen sie zusammen mit der Datenbank im Volume `schedule_data`. Die Profil-API verlangt eine zugewiesene Planungsrolle; die Besucheroberfläche zeigt nur Rednernamen.

Über **Besucherprogramm ansehen** öffnet sich die öffentliche Tagesansicht unter `/programm/<event_id>`. Besucher können Tage wechseln und Slot-Beschreibungen lesen. Auf Smartphones wechseln Raum-Tabs zwischen den Programmen. Programm, Session-Seiten und Programm-PDF sind ohne Konto per Direktlink erreichbar. Änderungen erscheinen sofort; es gibt keine Veröffentlichungsfreigabe. Die interne Planungs-API bleibt geschützt.

Geplante Sessions haben eine eigene Seite unter `/programm/<event_id>/sessions/<session_id>`. Der Link steht in den Session-Details und auf Smartphones direkt an der Session. Er bleibt bei Zeit- und Raumänderungen gleich. Abgesagte Sessions bleiben erreichbar; ungeplante oder gelöschte Sessions haben keine öffentliche Detailseite.

Über **PDF-Programm herunterladen** lässt sich das aktuelle Gesamtprogramm aus Planungsansicht und Besucherprogramm laden. Jeder Veranstaltungstag belegt eine A4-Querseite mit Zeit-Raum-Raster. Slot-Karten zeigen auch Rednernamen; bei dichten Plänen werden Texte gekürzt.

Die Auswahl **Darstellung** bietet System, Hell und Dunkel. Sie gilt für Planungsansicht und Besucherprogramm und wird im Browser gespeichert. Das PDF bleibt hell.

Im Veranstaltungseditor kann eine Akzentfarbe gewählt und für bestehende Veranstaltungen ein Logo hochgeladen werden. Der Veranstaltungsname gilt auch im Besucherprogramm und PDF. Logo und Akzentfarbe erscheinen nur dort; die Planungsoberfläche behält ihre Bedienfarben. Logos können JPEG, PNG oder WebP bis 5 MB sein. Lokal liegen sie standardmäßig in `./uploads/logos`, konfigurierbar mit `EVENT_LOGO_DIR`. Im Docker-Betrieb liegen sie im Volume `schedule_data`. Das Logo kann ersetzt oder entfernt werden.

Änderungen an Zeit oder Raum markieren eine Session 24 Stunden als **Verschoben**; die vorherige Planung steht in den Details. Im Session-Editor entfernt **Verschoben entfernen** den Hinweis für eine Session. **Alle Verschoben Flags entfernen** in der Seitenleiste entfernt ihn für alle Tage der gewählten Veranstaltung. Andere Hinweise bleiben erhalten. Änderungen an Thema, Beschreibung oder Rednern erscheinen 24 Stunden als **Geändert**. Über **Session abgesagt** bleibt eine Session dauerhaft als **Abgesagt** im Programm, zählt aber nicht zu Konflikten. Nach Aufheben der Absage erscheint sie 24 Stunden als geändert. Im PDF stehen frühere Angaben nur, wenn die Karte genug Platz bietet. Offene Seiten laden neue Änderungen weiterhin erst nach Neuladen.

## Backup und Restore

**Backup herunterladen** sichert die gewählte Veranstaltung als ZIP. Es enthält CSV-Dateien für Veranstaltung, Tage, Räume, Sessions, Redner, Helfer, Dienste und ihre Zuordnungen sowie Logo und Rednerfotos. `manifest.csv` enthält die Formatversion. Die CSV-Dateien verwenden UTF-8, Kommas als Trennzeichen, ISO-Datums- und Zeitwerte sowie `\N` für `null`; führende Backslashes in Textwerten sind verdoppelt.

Über **Restore** kann das ZIP geprüft und anschließend als neue Veranstaltung eingespielt oder über eine gewählte Veranstaltung geschrieben werden. Nur Superadmins können damit neue Veranstaltungen anlegen; Veranstaltungsadmins können ihre zugewiesenen Veranstaltungen ersetzen. Die Vorschau zeigt den Inhalt und mögliche Änderungen öffentlicher Session-Links. Beim Ersetzen bleiben andere Veranstaltungen und Teamrollen erhalten. Bestehende Session-IDs bleiben erhalten, sofern sie nicht inzwischen zu einer anderen Veranstaltung gehören. Die Wiederherstellung prüft das Archiv erneut und verlangt eine Bestätigung. Fehlende oder ungültige Dateien brechen sie ab, ohne vorhandene Planungsdaten zu ändern.

Das ZIP darf höchstens 128 MB groß sein; entpackt höchstens 256 MB. Einzelne CSV-Dateien dürfen höchstens 32 MB groß sein. Für Bilder gelten weiter 5 MB pro Datei. Backup- und Restore-API verlangen Veranstaltungsadmin- oder Superadmin-Rechte. Benutzerkonten und Teamrollen sind nicht Teil des ZIP.

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
