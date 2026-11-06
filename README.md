# PawTrack – Routen-Spike

Wegwerf-Spike für die Transferarbeit *Mobile Apps I* (Idee: PawTrack, Begleit-App für Hundespaziergänge). Der Code ist **nicht** Teil der Abgabe.

**Frage:** Kann PawTrack auf dem iPhone eine Spazierroute bei **gesperrtem Bildschirm** aufzeichnen, wenn die App als unsignierter Release-Build (GitHub Actions, macOS-Runner) in **LiveContainer** (via SideStore) läuft? Und wie brauchbar ist als Rückfallebene die reine **Vordergrund**-Aufzeichnung in Expo Go mit Taschenmodus?

## Stufen

| Stufe | Wann | Technik |
|---|---|---|
| **Hintergrund** | Kein Expo Go, Hintergrund-Standort verfügbar, Berechtigung «Immer» | `Location.startLocationUpdatesAsync` + `TaskManager.defineTask`; der Task schreibt jeden Punkt sofort in eine Datei |
| **Vordergrund** | Expo Go, nur «Beim Verwenden der App» oder Hintergrund nicht verfügbar | `Location.watchPositionAsync`; `AppState` markiert, wann die App verlassen wurde |
| keine | Standortzugriff verweigert | Statuszeile erklärt den Grund, Link zu den Einstellungen |

Beide Stufen: `accuracy: High`, `distanceInterval: 10` m. Hintergrund zusätzlich `activityType: Fitness`, `pausesUpdatesAutomatically: false`, `showsBackgroundLocationIndicator: true` (blaue Anzeige in der Statusleiste).

**Taschenmodus** (Knopf während der Aufnahme): schwarzer Bildschirm, Helligkeit 0, Bildschirm bleibt an. Beenden durch **langes Drücken (1,5 s)**; danach wird die Helligkeit zurückgesetzt.

## Messgrössen

- **Lücke:** mehr als 60 s ohne Punkt (auch Start → erster Punkt und letzter Punkt → Stopp). In der Stufe Vordergrund ist zusätzlich jedes Verlassen der App eine Lücke, weil dann nichts aufgezeichnet wird. Das Ergebnis zeigt, wie viele Lücken in eine Zeit fallen, in der die App verlassen war.
- **Distanz:** Haversine-Summe nur innerhalb der aufgezeichneten Segmente; Lücken zählen nicht (in der Route gestrichelt). Keine Glättung, GPS-Zittern zählt mit.
- **Median-Genauigkeit:** Median des gemeldeten Genauigkeitsradius aller Punkte.
- **Warnung «ungenau»:** wenn ≥ 80 % der Punkte ungenauer als 100 m sind (typisch für «Ungefährer Standort»).
- **Akku:** Ladestand bei Start und Stopp (`expo-battery`, in Expo Go enthalten), Differenz in Prozentpunkten.
- **Export:** «JSON exportieren» öffnet das Teilen-Menü mit Metadaten, Zusammenfassung und allen Rohdaten. Es wird nur die letzte Aufnahme gespeichert – **nach jedem Test exportieren**.

## Stufe Vordergrund in Expo Go starten

Voraussetzung: Node 22, Expo Go (SDK 58) auf dem iPhone, Laptop und iPhone im selben WLAN.

```bash
npm install
npx expo start
```

QR-Code mit der iPhone-Kamera scannen → öffnet in Expo Go. Die Statuszeile zeigt «Vordergrund – Grund: Expo Go unterstützt keinen Hintergrund-Standort.»

Hinweis: Im Entwicklungsmodus hält Expo den Bildschirm automatisch wach, solange `expo-keep-awake` installiert ist (`withDevTools`). In Expo Go sperrt sich das iPhone also nicht von selbst; der Akkuwert von Test B ist deshalb eher pessimistisch.

## IPA aus GitHub Actions holen

Workflow `.github/workflows/ios-unsigned.yml` («iOS unsigned IPA»): läuft bei Push auf `main` oder manuell (*Actions → iOS unsigned IPA → Run workflow*). Er baut auf `macos-26` (Xcode 26.x, SDK 58 braucht ≥ 26.4) einen **Release**-Build für `iphoneos` ohne Signatur. Das JS-Bundle ist eingebettet, es braucht also keinen Metro-Server.

1. Im Workflow-Lauf unter *Artifacts* `PawTrackRoute-unsigned-ipa` herunterladen (ZIP, darin `PawTrackRoute-unsigned.ipa`).
2. Am einfachsten direkt auf dem iPhone in Safari (bei GitHub angemeldet) herunterladen und in der Dateien-App entpacken.

Kostenlose macOS-Minuten gibt es nur in **öffentlichen** Repositories.

## In LiveContainer installieren

1. LiveContainer (über SideStore installiert) öffnen → **+** → `PawTrackRoute-unsigned.ipa` aus der Dateien-App wählen.
2. PawTrackRoute in LiveContainer starten, **Start** tippen und den Standortzugriff erlauben.
3. In den iOS-Einstellungen → *Datenschutz & Sicherheit* → *Ortungsdienste* → **LiveContainer**:
   - **Immer** wählen,
   - **Genauer Standort** einschalten (LiveContainer verlangt standardmässig nur den ungefähren Standort: `NSLocationDefaultAccuracyReduced`).
4. Zurück in die App: Die Statuszeile muss **Hintergrund** zeigen.

Wichtig: In LiveContainer gelten die Berechtigungen für LiveContainer als Ganzes (alle Gast-Apps), und die Dialogtexte stammen von LiveContainer, nicht von dieser App.

## Testprotokoll

| Test | Aufbau | Bestanden |
|---|---|---|
| A – Hintergrund | IPA in LiveContainer, Genauer Standort an, «Immer» erteilt, iPhone gesperrt, 15 Minuten gehen | Keine Lücke > 60 s, Median-Genauigkeit ≤ 20 m, Akku-Differenz notiert |
| B – Vordergrund | Expo Go, Taschenmodus, 20 Minuten gehen | Lücken nur dort, wo die App verlassen wurde; Akku-Differenz notiert |
| C – Rückfall | Standortzugriff verweigern; nur «Beim Verwenden der App» erteilen | Definierter Statustext, kein Absturz, Stufe korrekt angezeigt |

Ablauf pro Test:

1. Ladestand notieren, iPhone nicht am Ladekabel.
2. **Start**, Stufe in der Statuszeile kontrollieren.
3. A: Seitentaste drücken (sperren) und gehen. B: **Taschenmodus**, iPhone in die Tasche.
4. **Durchgehend gehen.** Mit 10 m Distanzfilter liefert iOS beim Stehen keine Punkte; wer länger als 60 s steht (Hund schnüffelt), erzeugt eine Lücke ohne Fehler. Solche Stopps notieren.
5. Entsperren, **Stopp**, Ergebnis ansehen (Zeile «Kriterien Test A»), **JSON exportieren**.
6. C: Berechtigung in den Einstellungen ändern, zurück in die App; die Statuszeile aktualisiert sich ohne Aufnahme. Danach **Start** tippen.

## Ergebnisse

| Test | Datum | Ergebnis |
|---|---|---|
| A – Hintergrund | 06.11.2026 | **Inhaltlich bestanden.** IPA in LiveContainer, Genauer Standort, «Immer», iPhone gesperrt: 32,6 Minuten, 866 m, 90 Punkte, keine Task-Fehler, Median-Genauigkeit 3,8 m (schlechtester Punkt 36 m), Akku 55 % → 55 %. Fünf Lücken von 69–122 s; der nächste Punkt lag jeweils nur 10–12 m entfernt (= Distanzfilter), es waren also Stopps des Hundes, keine Aussetzer. Das Kriterium «keine Lücke > 60 s» ist dadurch formal verfehlt; es unterscheidet Stehen nicht von Aussetzern. |
| B – Vordergrund | – | offen |
| C – Rückfall | – | offen |

Erkenntnisse: Die Aufzeichnung bei gesperrtem Bildschirm funktioniert als Gast-App in LiveContainer. Eine Lücke mit kurzem Abstand zum nächsten Punkt ist ein Stopp; eine Lücke mit grossem Abstand wäre ein Aussetzer. Der Akkuwert ist vermutlich zu grob, weil iOS den Ladestand in 5-%-Schritten meldet.

## Annahmen

- Der CI-Build ist am 05.11.2026 durchgelaufen (Xcode 26.6, `main.jsbundle` eingebettet, `UIBackgroundModes` mit `location`); das IPA startet in LiveContainer und zeichnet im Hintergrund auf (Test A).
- Wird die App beendet (durch dich oder durch iOS), stoppt laut Expo-Doku die Hintergrund-Aufzeichnung. Beim nächsten Öffnen läuft die Aufnahme weiter, wenn der Task noch registriert ist; sonst wird sie beendet und als Fehler gemeldet. Die Zeit dazwischen erscheint als Lücke. Nicht geprüft.

## Aufbau

- `App.tsx` – Aufnahme- und Ergebnisansicht
- `src/recorder.ts` – Stufenwahl, Hintergrund-Task, Vordergrund-Watch
- `src/routeMath.ts` – Lücken, Segmente, Distanz, Median (reine Funktionen)
- `src/sessionStore.ts` – Speicherung (`expo-file-system`, JSON Lines) und Export (`expo-sharing`)
- `src/RouteView.tsx` – Route als SVG-Polyline (`react-native-svg`, keine Kartenkacheln)
- `src/PocketMode.tsx` – Taschenmodus
