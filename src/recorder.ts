import { isRunningInExpoGo } from 'expo';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type { Level, PointRecord } from './routeMath';
import { appendRecords, startSession, writeMeta, type SessionMeta } from './sessionStore';

const LOCATION_TASK = 'pawtrack-route';

/** Shared by both levels so their results are comparable. */
const LOCATION_OPTIONS = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 10,
} as const satisfies Location.LocationOptions;

function toPoint(location: Location.LocationObject): PointRecord {
  return {
    k: 'p',
    t: location.timestamp,
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    acc: location.coords.accuracy,
  };
}

// Must run at module load: after a background relaunch no component is mounted.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    appendRecords([{ k: 'e', t: Date.now(), message: error.message }]);
    return;
  }
  appendRecords(data.locations.map(toPoint));
});

export interface LevelDecision {
  /** null: no recording possible (location denied). */
  level: Level | null;
  /** German status text explaining a fallback; null when background works. */
  reason: string | null;
  accuracyAuthorization: 'full' | 'reduced' | null;
}

/**
 * Decides which level a walk would run at. With `request: false` only the current permission
 * state is read (no prompts), so the screen can show the level before the walk starts.
 */
export async function decideLevel(request: boolean): Promise<LevelDecision> {
  const foreground = request
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  const accuracyAuthorization = foreground.ios?.accuracy ?? null;

  if (!foreground.granted) {
    const reason =
      foreground.status === 'undetermined'
        ? 'Standortzugriff noch nicht erteilt – «Start» fragt danach.'
        : 'Standortzugriff verweigert – in den Einstellungen erlauben.';
    return { level: null, reason, accuracyAuthorization };
  }
  if (isRunningInExpoGo()) {
    return { level: 'foreground', reason: 'Expo Go unterstützt keinen Hintergrund-Standort.', accuracyAuthorization };
  }
  const available =
    (await Location.isBackgroundLocationAvailableAsync()) && (await TaskManager.isAvailableAsync());
  if (!available) {
    return { level: 'foreground', reason: 'Hintergrund-Standort in diesem Build nicht verfügbar.', accuracyAuthorization };
  }

  const background = request
    ? await Location.requestBackgroundPermissionsAsync()
    : await Location.getBackgroundPermissionsAsync();
  if (background.granted && (background.ios?.scope ?? 'always') === 'always') {
    return { level: 'background', reason: null, accuracyAuthorization };
  }
  return {
    level: 'foreground',
    reason: 'Nur «Beim Verwenden der App» erlaubt – für Hintergrund «Immer» wählen.',
    accuracyAuthorization,
  };
}

async function readBattery(): Promise<number | null> {
  const level = await Battery.getBatteryLevelAsync();
  return level >= 0 ? level : null;
}

let watchSubscription: Location.LocationSubscription | null = null;

async function startForegroundWatch(): Promise<void> {
  watchSubscription?.remove();
  watchSubscription = await Location.watchPositionAsync(LOCATION_OPTIONS, (location) =>
    appendRecords([toPoint(location)]),
  );
}

export async function startWalk(decision: LevelDecision & { level: Level }): Promise<SessionMeta> {
  const startedAt = Date.now();
  const meta: SessionMeta = {
    id: new Date(startedAt).toISOString().replace(/[:.]/g, '-'),
    startedAt,
    endedAt: null,
    level: decision.level,
    fallbackReason: decision.reason,
    accuracyAuthorization: decision.accuracyAuthorization,
    batteryStart: await readBattery(),
    batteryEnd: null,
    expoGo: isRunningInExpoGo(),
  };
  startSession(meta);

  if (decision.level === 'background') {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...LOCATION_OPTIONS,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });
  } else {
    await startForegroundWatch();
  }
  return meta;
}

/**
 * Re-attaches to a walk that was still running when the JS context restarted
 * (reload, or iOS relaunching the app for the background task).
 */
export async function resumeWalk(meta: SessionMeta): Promise<void> {
  if (meta.level === 'foreground') {
    await startForegroundWatch();
  } else if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    throw new Error('Hintergrund-Aufzeichnung lief nicht mehr – Aufnahme beendet.');
  }
}

export async function stopWalk(meta: SessionMeta): Promise<SessionMeta> {
  watchSubscription?.remove();
  watchSubscription = null;
  if (meta.level === 'background' && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  const ended: SessionMeta = { ...meta, endedAt: Date.now(), batteryEnd: await readBattery() };
  writeMeta(ended);
  return ended;
}
