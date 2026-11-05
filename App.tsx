import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { PocketMode } from './src/PocketMode';
import { decideLevel, resumeWalk, startWalk, stopWalk, type LevelDecision } from './src/recorder';
import { backgroundIntervals, GAP_THRESHOLD_MS, summarize, type TrackRecord } from './src/routeMath';
import { RouteView } from './src/RouteView';
import { appendRecords, readMeta, readRecords, shareSession, type SessionMeta } from './src/sessionStore';

const POLL_MS = 2000;
const TEST_A_MAX_MEDIAN_ACCURACY_M = 20;

const LEVEL_LABEL = { background: 'Hintergrund', foreground: 'Vordergrund' } as const;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatBattery(level: number | null): string {
  return level === null ? '–' : `${Math.round(level * 100)} %`;
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export default function App() {
  const [decision, setDecision] = useState<LevelDecision | null>(null);
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [records, setRecords] = useState<TrackRecord[]>([]);
  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<'record' | 'result'>('record');
  const [pocket, setPocket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recording = meta !== null && meta.endedAt === null;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    void (async () => {
      try {
        const stored = readMeta();
        if (stored) {
          setRecords(readRecords());
          if (stored.endedAt === null) {
            try {
              await resumeWalk(stored);
              setMeta(stored);
            } catch (e) {
              setError(message(e));
              setMeta(await stopWalk(stored));
            }
          } else {
            setMeta(stored);
          }
        }
        setDecision(await decideLevel(false));
      } catch (e) {
        setError(message(e));
      }
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && state !== 'background') return;
      if (recordingRef.current) {
        appendRecords([{ k: 'a', t: Date.now(), state }]);
      } else if (state === 'active') {
        // The user may come back from Settings with changed permissions.
        decideLevel(false).then(setDecision, (e: unknown) => setError(message(e)));
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setRecords(readRecords());
      setNow(Date.now());
    }, POLL_MS);
    return () => clearInterval(id);
  }, [recording]);

  const summary = useMemo(
    () => (meta ? summarize(records, { ...meta, endedAt: meta.endedAt ?? now }) : null),
    [meta, records, now],
  );

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      const d = await decideLevel(true);
      setDecision(d);
      if (d.level === null) return;
      const started = await startWalk({ ...d, level: d.level });
      setRecords([]);
      setNow(Date.now());
      setMeta(started);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    if (!meta) return;
    setBusy(true);
    setPocket(false);
    try {
      const ended = await stopWalk(meta);
      setMeta(ended);
      setRecords(readRecords());
      setScreen('result');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function onShare() {
    if (!meta) return;
    try {
      await shareSession(meta, records);
    } catch (e) {
      setError(message(e));
    }
  }

  const shownLevel = recording ? { level: meta.level, reason: meta.fallbackReason } : decision;
  const accuracyAuthorization = recording ? meta.accuracyAuthorization : decision?.accuracyAuthorization;
  const appLeftCount = meta ? backgroundIntervals(records, meta.endedAt ?? now).length : 0;
  const gapSeconds = GAP_THRESHOLD_MS / 1000;
  const gapLabel = meta?.level === 'foreground' ? `Lücken (> ${gapSeconds} s / App verlassen)` : `Lücken > ${gapSeconds} s`;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>PawTrack – Routen-Spike</Text>

          <View style={styles.card}>
            <Text style={styles.label}>{recording ? 'Aktive Stufe' : 'Stufe beim Start'}</Text>
            {shownLevel === null ? (
              <Text style={styles.status}>Prüfe Berechtigungen …</Text>
            ) : shownLevel.level === null ? (
              <Text style={[styles.status, styles.bad]}>Keine Aufzeichnung – {shownLevel.reason}</Text>
            ) : (
              <>
                <Text style={[styles.status, shownLevel.level === 'background' ? styles.good : styles.warn]}>
                  {LEVEL_LABEL[shownLevel.level]}
                </Text>
                {shownLevel.reason && <Text style={styles.reason}>Grund: {shownLevel.reason}</Text>}
              </>
            )}
            {accuracyAuthorization === 'reduced' && (
              <Text style={styles.reason}>
                Ungefährer Standort aktiv – in den Einstellungen «Genauer Standort» einschalten.
              </Text>
            )}
            {!recording && shownLevel !== null && shownLevel.level !== 'background' && (
              <Pressable onPress={() => void Linking.openSettings()}>
                <Text style={styles.link}>Einstellungen öffnen</Text>
              </Pressable>
            )}
          </View>

          {screen === 'record' && (
            <>
              <View style={styles.row}>
                {recording ? (
                  <>
                    <Button label="Stopp" onPress={onStop} disabled={busy} tone="danger" />
                    <Button label="Taschenmodus" onPress={() => setPocket(true)} disabled={busy} />
                  </>
                ) : (
                  <>
                    <Button label="Start" onPress={onStart} disabled={busy} />
                    {meta && <Button label="Letzte Aufnahme" onPress={() => setScreen('result')} />}
                  </>
                )}
              </View>

              {recording && summary && (
                <View style={styles.card}>
                  <Stat label="Dauer" value={formatDuration(summary.durationMs)} />
                  <Stat label="Punkte" value={String(summary.points)} />
                  <Stat
                    label={gapLabel}
                    value={`${summary.gaps.length} (längste ${formatDuration(summary.longestGapMs)})`}
                  />
                  <Stat label="App verlassen" value={`${appLeftCount}×`} />
                  <Stat
                    label="Median-Genauigkeit"
                    value={summary.medianAccuracyM === null ? '–' : `${Math.round(summary.medianAccuracyM)} m`}
                  />
                  <Stat label="Distanz" value={formatDistance(summary.distanceM)} />
                  <Stat label="Akku Start" value={formatBattery(meta.batteryStart)} />
                  {summary.taskErrors > 0 && <Stat label="Task-Fehler" value={String(summary.taskErrors)} />}
                </View>
              )}
            </>
          )}

          {screen === 'result' && meta && summary && (
            <>
              <RouteView segments={summary.segments} />
              <View style={styles.card}>
                <Stat label="Stufe" value={LEVEL_LABEL[meta.level]} />
                <Stat label="Distanz (nur Segmente)" value={formatDistance(summary.distanceM)} />
                <Stat label="Dauer" value={formatDuration(summary.durationMs)} />
                <Stat label="Punkte" value={String(summary.points)} />
                <Stat
                  label={gapLabel}
                  value={`${summary.gaps.length}, davon App verlassen ${summary.gaps.filter((g) => g.appLeft).length}`}
                />
                <Stat label="Längste Lücke" value={formatDuration(summary.longestGapMs)} />
                <Stat
                  label="Median-Genauigkeit"
                  value={summary.medianAccuracyM === null ? '–' : `${Math.round(summary.medianAccuracyM)} m`}
                />
                <Stat
                  label="Akku"
                  value={`${formatBattery(meta.batteryStart)} → ${formatBattery(meta.batteryEnd)}${
                    meta.batteryStart !== null && meta.batteryEnd !== null
                      ? ` (Δ ${Math.round((meta.batteryEnd - meta.batteryStart) * 100)} %-Punkte)`
                      : ''
                  }`}
                />
                {summary.taskErrors > 0 && <Stat label="Task-Fehler" value={String(summary.taskErrors)} />}
                <Stat
                  label="Kriterien Test A"
                  value={`Lücke > ${GAP_THRESHOLD_MS / 1000} s: ${summary.gaps.length === 0 ? 'keine ✓' : 'ja ✗'} · Median ≤ ${TEST_A_MAX_MEDIAN_ACCURACY_M} m: ${
                    summary.medianAccuracyM !== null && summary.medianAccuracyM <= TEST_A_MAX_MEDIAN_ACCURACY_M ? '✓' : '✗'
                  }`}
                />
              </View>
              {summary.coarseWarning && (
                <Text style={[styles.reason, styles.bad]}>
                  Warnung: {Math.round(summary.coarseShare * 100)} % der Punkte ungenauer als 100 m – vermutlich ist
                  «Genauer Standort» ausgeschaltet.
                </Text>
              )}
              <View style={styles.row}>
                <Button label="JSON exportieren" onPress={onShare} />
                <Button label="Zurück" onPress={() => setScreen('record')} />
              </View>
            </>
          )}

          {error && <Text style={[styles.reason, styles.bad]}>Fehler: {error}</Text>}
        </ScrollView>
        {pocket && recording && <PocketMode onExit={() => setPocket(false)} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Button({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === 'danger' && styles.danger, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  card: { backgroundColor: '#f6f8fa', borderRadius: 8, padding: 12, gap: 4 },
  label: { fontSize: 12, color: '#57606a', textTransform: 'uppercase' },
  status: { fontSize: 20, fontWeight: '600' },
  reason: { fontSize: 14, color: '#57606a' },
  link: { fontSize: 14, color: '#0969da', marginTop: 4 },
  good: { color: '#1a7f37' },
  warn: { color: '#9a6700' },
  bad: { color: '#cf222e' },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  button: { backgroundColor: '#1f6feb', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 },
  danger: { backgroundColor: '#cf222e' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  statLabel: { fontSize: 14, color: '#57606a', flexShrink: 0 },
  statValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
