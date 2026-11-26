# Designsystem der Planungsoberfläche

Die Stile liegen in `frontend/src/styles/`, nach Bereichen getrennt. `frontend/src/styles.css` bindet sie in fester Reihenfolge ein: Tokens, Basis, Bausteine, Bereiche. Pro Zeile steht eine Deklaration.

## Tokens (`styles/tokens.css`)

| Gruppe | Tokens | Verwendung |
| --- | --- | --- |
| Schrift | `--font-sans` | Inter als Variable Font, selbst gehostet über `@fontsource-variable/inter` |
| Schriftgrößen | `--text-xs` 12 px, `--text-sm` 13 px, `--text-md` 14 px, `--text-base` 15 px, `--text-lg` 18 px, `--text-xl` 24 px, `--text-2xl` 28 px | Angaben in `rem`, damit die Schriftgrößen-Einstellung des Browsers wirkt. Unter 12 px wird nichts gesetzt. |
| Abstände | `--space-half` 2 px, `--space-1` … `--space-10` (4 bis 40 px) | 4er-Raster für `padding`, `margin`, `gap` |
| Radien | `--radius-sm` 4 px, `--radius-md` 8 px, `--radius-lg` 12 px, `--radius-full` | Badges und Streifen `sm`, Buttons, Felder und Karten `md`, Panels und Dialoge `lg` |
| Schatten | `--shadow-sm`, `--shadow-md`, `--shadow-lg` | Karten, Panels/Menüs, Dialoge |
| Höhen | `--control-height` 38 px, `--header-control-height` 44 px | Formularfelder und Buttons, Bedienelemente im Kopfbereich |

Uhrzeiten stehen in `<time>` oder tragen die Klasse `.tabular`. Beides setzt `font-variant-numeric: tabular-nums`, damit Zeiten in Spalten bündig stehen.

Formularfelder (`input`, `select`, `textarea`) haben einen globalen Grundstil in `styles/base.css`. Im jeweiligen Kontext wird nur noch das Layout angepasst.

Die Layouthöhen ergeben sich aus dem Grid. `.app-shell` hat die Zeilen Kopfbereich und Arbeitsfläche. Seitenleiste, Arbeitsfläche und Editor scrollen jeweils für sich. Höhen werden nicht mehr fest aus der Kopfzeile berechnet.

## Bedeutung der Zustandsfarben

Jeder Zustand zeigt neben der Farbe ein Icon und ein Kurzlabel. Auf kleinen oder schmalen Karten erscheint nur das Icon; das Label bleibt für Screenreader und im Tooltip erhalten.

| Familie | Farbe (Tokens) | Zustände | Unterscheidung ohne Farbe |
| --- | --- | --- | --- |
| Fehler / Konflikt | Rot (`--danger-*`) | Raumkonflikt, Rednerkonflikt, Helferkonflikt | Icon und Label. Raumkonflikt mit durchgezogenem Rahmen, Redner- und Helferkonflikt mit gestricheltem Rahmen |
| Handlungsbedarf | Gelb (`--warning-*`) | offener Dienst, freie Helferplätze | Warn-Icon, „Offen“ bzw. „n frei“ |
| Änderung | Lila (`--change-*`) | Verschoben, Geändert | eigenes Icon und Label je Zustand |
| Inaktiv | Grau (`--cancel-*`) | Abgesagt | Icon, Label, durchgestrichener Titel |

Die Legende über dem Raster (`PlanLegend.tsx`) zeigt diese Zuordnung. Wer die Farben ändert, passt Tokens, Legende und dieses Dokument gemeinsam an. Den Kontrast der Text-Tokens prüft `src/contrast.test.ts`.

## Karten im Raster

Wie viel eine Karte zeigt, hängt von der Dauer ab (`cardDensity` in `Schedule.tsx`):

- ab 60 Minuten (`density-full`): Titel (bis drei Zeilen), Zeit, Zustände mit Label, Redner, Kategorien
- 30–59 Minuten (`density-medium`): Titel (zwei Zeilen), Zeit, Zustände als Icon oben rechts
- unter 30 Minuten (`density-compact`): Titel und Zeit in einer Zeile, Zustände als Icon

Die vollständigen Angaben stehen im Tooltip der Karte. Ein Klick auf die Karte öffnet sie zum Bearbeiten (für Helfer: Details). Verschoben wird am Titel, die Dauer ändert sich an der unteren Kante. Die Rasterhöhe lässt sich in drei Stufen zoomen (1,6 / 2,4 / 3,2 px pro Minute); die Stufe wird pro Browser gespeichert.

## Icons

`Icon.tsx` enthält ein Set von Linienicons im Stil von Lucide (24er-Raster, Strichstärke 1,75). Icons sind immer dekorativ (`aria-hidden`). Die Bedeutung trägt der umgebende Button oder Link über seinen Text oder sein `aria-label`. Unicode-Zeichen werden nicht als Icons verwendet.
