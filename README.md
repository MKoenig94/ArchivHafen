# Archiv Hafen

Archiv Hafen ist ein lokales, selbst gehostetes E-Mail-Archiv für Linux. Es verbindet IMAP-Postfächer, speichert jede Nachricht unverändert als `.eml`, indexiert den Inhalt in SQLite und bietet eine schnelle deutschsprachige Oberfläche zum Suchen und Lesen.

## Funktionen

- Mehrere IMAP-Postfächer verbinden
- Inkrementeller Download anhand IMAP-UID und UIDVALIDITY
- Automatische Archivierung alle 15 Minuten (konfigurierbar)
- Anbieter-Voreinstellungen für Gmail, Microsoft 365, GMX, WEB.DE und iCloud
- Originale RFC-822-Nachrichten inklusive Headern und Anhängen
- Volltextsuche über Betreff, Absender, Empfänger und Nachrichtentext
- Filter nach Postfach, Ordner und Anhängen
- Einzelne oder mehrere archivierte Nachrichten im Anbieter-Postfach in den Papierkorb verschieben
- Bereinigungsregeln für Nachrichten älter als X Tage oder von einer exakten Absenderadresse
- Treffer-Vorschau und Bestätigung vor dem Aktivieren oder manuellen Ausführen einer Regel
- Download einzelner Anhänge oder der unveränderten `.eml`-Datei
- Deduplizierung identischer Nachrichten innerhalb eines Postfachs
- AES-256-GCM-verschlüsselte Zugangsdaten mit lokalem Schlüssel
- Datenschutzfreundliche Leseransicht ohne externe Bilder oder aktive Inhalte
- Trennen eines Postfachs ohne Löschen des vorhandenen Archivs

Papierkorb und Spam werden bewusst nicht synchronisiert. Die Archivierung greift ausschließlich lesend auf die Postfächer zu. Nur eine ausdrücklich bestätigte Auswahl oder eine aktivierte Bereinigungsregel darf Nachrichten per IMAP in den Papierkorb des Anbieters verschieben; die lokale Archivkopie wird dabei nicht gelöscht.

## Docker Compose

Der schnellste produktive Start benötigt nur Docker mit dem Compose-Plugin:

```bash
docker compose up --build -d
```

Danach ist Archiv Hafen unter `http://127.0.0.1:4174` erreichbar. Status und Protokoll:

```bash
docker compose ps
docker compose logs -f archivhafen
```

Das Archiv liegt im benannten Volume `archivhafen-data`. Es enthält die SQLite-Datenbank, alle EML-Originale und den lokalen `master.key`. Ein normales `docker compose down` entfernt dieses Volume nicht.

Der Container läuft als unprivilegierte UID `10001`, besitzt keine Linux-Capabilities, verwendet ein schreibgeschütztes Root-Dateisystem und veröffentlicht den Port ausschließlich auf `127.0.0.1`. Das Lauschen auf `0.0.0.0` findet nur innerhalb des isolierten Docker-Netzwerks statt.

Optionale Einstellungen lassen sich beim Start setzen:

```bash
ARCHIVHAFEN_HTTP_PORT=8080 \
ARCHIVHAFEN_SYNC_INTERVAL_MINUTES=30 \
docker compose up --build -d
```

Für ein konsistentes Backup wird der Container kurz angehalten:

```bash
docker compose stop archivhafen
docker compose cp archivhafen:/data ./archivhafen-backup
docker compose start archivhafen
```

Sichere immer das komplette Verzeichnis inklusive `master.key`. Verwende `docker compose down -v` nur, wenn das gesamte Archiv-Volume ausdrücklich gelöscht werden soll.

## Schnellstart zur Entwicklung

Voraussetzung ist Node.js 22.12 oder neuer.

```bash
npm install
npm run dev
```

Anschließend ist die Oberfläche unter `http://127.0.0.1:5173` erreichbar. Der lokale API-Dienst läuft auf Port `4174`.

Für ein separates Demoarchiv:

```bash
ARCHIVHAFEN_DATA_DIR=/tmp/archivhafen-demo npm run seed:demo
ARCHIVHAFEN_DATA_DIR=/tmp/archivhafen-demo npm run dev
```

## Installation unter Linux

Das Installationsskript baut die Anwendung, legt sie im Benutzerverzeichnis ab, installiert einen `systemd --user`-Dienst und erstellt einen Eintrag im Anwendungsmenü.

```bash
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh
```

Danach startet Archiv Hafen automatisch mit deiner Benutzersitzung. Status und Protokoll:

```bash
systemctl --user status archivhafen
journalctl --user -u archivhafen -f
```

Alternativ lässt sich der Produktionsbetrieb direkt starten:

```bash
npm run build
npm start
```

## Postfächer verbinden

Archiv Hafen verwendet die klassische IMAP-Anmeldung. Bei Gmail und iCloud muss ein App-Passwort angelegt werden. GMX und WEB.DE verlangen, dass POP3/IMAP im jeweiligen Konto aktiviert ist. Microsoft-Konten funktionieren nur, wenn der Server die IMAP-Anmeldung mit Passwort oder App-Passwort zulässt; reine OAuth2-Tenants benötigen derzeit eine vorgeschaltete IMAP-Bridge oder eine entsprechend freigeschaltete Authentifizierung.

Beim ersten Lauf werden alle auswählbaren Ordner außer Spam und Papierkorb archiviert. Folgeläufe laden ausschließlich neue UIDs. Ändert ein Server seine UIDVALIDITY, prüft Archiv Hafen den Ordner erneut und verhindert doppelte Archivdateien über SHA-256.

## Nachrichten im Anbieter-Postfach bereinigen

Im Archiv kann eine Nachricht über die Leseransicht oder per Checkbox ausgewählt werden. Die Mehrfachauswahl wirkt auf alle aktuell geladenen Treffer. Vor dem Verschieben zeigt Archiv Hafen immer eine Bestätigung an. Die Nachricht wird ausschließlich in den IMAP-Papierkorb des verbundenen Anbieters verschoben und bleibt als unveränderte `.eml`-Datei im lokalen Archiv erhalten.

Unter **Regeln** lassen sich zwei Bedingungen anlegen:

- Nachrichten älter als eine festgelegte Zahl von Tagen
- Nachrichten von einer exakten Absenderadresse

Vor dem Aktivieren zeigt eine Vorschau die aktuelle Trefferzahl und einige Beispiele. Eine aktivierte Regel läuft nach jeder erfolgreichen Archivierung. Sie kann pausiert, erneut mit Vorschau aktiviert oder nach einer weiteren Bestätigung sofort ausgeführt werden. Archiv Hafen führt dabei keine endgültige Löschung und kein Leeren des Papierkorbs aus.

Beim Trennen eines Postfachs werden dessen Regeln automatisch pausiert. Nach dem erneuten Verbinden müssen sie mit einer aktuellen Vorschau bewusst wieder aktiviert werden.

Der IMAP-Server muss einen auswählbaren Ordner mit der Spezialkennzeichnung `\Trash` melden. Fehlt diese eindeutige Kennzeichnung oder hat sich die UIDVALIDITY eines Quellordners geändert, bricht Archiv Hafen für die betroffenen Nachrichten sicher ab und fordert zuerst eine neue Synchronisierung an.

## Daten und Backups

Standardmäßig folgt Archiv Hafen der XDG-Konvention und speichert unter:

```text
~/.local/share/archivhafen/
├── archivhafen.sqlite
├── master.key
└── archive/<konto>/<jahr>/<monat>/<sha256>.eml
```

Sichere immer das komplette Verzeichnis einschließlich `master.key`. Ohne diesen Schlüssel können gespeicherte IMAP-Zugangsdaten nicht wieder entschlüsselt werden; die `.eml`-Nachrichten selbst bleiben trotzdem mit gewöhnlichen Mailprogrammen lesbar.

Konfiguration über Umgebungsvariablen:

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ARCHIVHAFEN_DATA_DIR` | `$XDG_DATA_HOME/archivhafen` | Datenbank, Schlüssel und Archiv |
| `ARCHIVHAFEN_MASTER_KEY` | automatisch erzeugte Datei | Optionaler externer Master-Schlüssel |
| `ARCHIVHAFEN_HOST` | `127.0.0.1` | Bind-Adresse des lokalen Diensts |
| `ARCHIVHAFEN_PORT` | `4174` | HTTP-Port |
| `ARCHIVHAFEN_SYNC_INTERVAL_MINUTES` | `15` | Intervall; `0` deaktiviert automatische Läufe |

Bei einer Installation über das Linux-Skript liegt die systemd-Konfiguration in `~/.config/archivhafen/environment`. Im Projektverzeichnis wird außerdem eine vorhandene `.env`-Datei automatisch geladen; [.env.example](.env.example) dient als Vorlage. Nach Änderungen an der systemd-Konfiguration genügt:

```bash
systemctl --user restart archivhafen
```

Installationen der früheren Entwicklungsversion werden automatisch erkannt: Die alten `MAILSTORE_*`-Variablen, das Verzeichnis `~/.local/share/mailstore` und eine vorhandene `mailstore.sqlite` bleiben als kompatible Fallbacks lesbar.

Die Bind-Adresse sollte ohne vorgeschaltete Authentifizierung nicht auf `0.0.0.0` geändert werden.

## Qualitätssicherung

```bash
npm run typecheck
npm test
npm run build
```

Die Tests decken die authentifizierte Verschlüsselung, unveränderte EML-Ablage, Volltextindexierung, Anhangserkennung, Deduplizierung, Datenbankmigration sowie die sichere IMAP-Papierkorbverschiebung mit erhaltenem Lokalarchiv ab.

## Lizenz

Archiv Hafen ist unter der [Apache License 2.0](LICENSE) veröffentlicht.
