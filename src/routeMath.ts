// Pure functions only (no React Native imports) so they can run under plain Node.

export type Level = 'background' | 'foreground';

export interface PointRecord {
  k: 'p';
  /** Fix timestamp (ms since epoch). */
  t: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy radius in metres, null if the OS did not report one. */
  acc: number | null;
}

export interface AppStateRecord {
  k: 'a';
  t: number;
  state: 'background' | 'active';
}

export interface TaskErrorRecord {
  k: 'e';
  t: number;
  message: string;
}

export type TrackRecord = PointRecord | AppStateRecord | TaskErrorRecord;

export const GAP_THRESHOLD_MS = 60_000;
/** iOS "approximate location" reports radii in the kilometre range; anything above this is coarse. */
export const COARSE_ACCURACY_M = 100;
/** Share of coarse points above which the reduced-accuracy warning is shown. */
export const COARSE_SHARE_WARNING = 0.8;

const EARTH_RADIUS_M = 6_371_008.8;

export interface Gap {
  fromT: number;
  toT: number;
  durationMs: number;
  /** The app was in the background at some point during the gap. */
  appLeft: boolean;
}

export interface RouteSummary {
  points: number;
  segments: PointRecord[][];
  gaps: Gap[];
  longestGapMs: number;
  distanceM: number;
  durationMs: number;
  medianAccuracyM: number | null;
  coarseShare: number;
  coarseWarning: boolean;
  taskErrors: number;
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Intervals in which the app was not in the foreground; an open interval runs until `endT`. */
export function backgroundIntervals(records: TrackRecord[], endT: number): [number, number][] {
  const intervals: [number, number][] = [];
  let since: number | null = null;
  for (const r of records) {
    if (r.k !== 'a') continue;
    if (r.state === 'background' && since === null) since = r.t;
    if (r.state === 'active' && since !== null) {
      intervals.push([since, r.t]);
      since = null;
    }
  }
  if (since !== null) intervals.push([since, endT]);
  return intervals;
}

function overlaps(intervals: [number, number][], from: number, to: number): boolean {
  return intervals.some(([s, e]) => s < to && e > from);
}

/**
 * Splits the track into recorded segments and gaps.
 * A gap is > GAP_THRESHOLD_MS without a fix (including session start → first fix and last fix → end).
 * In the foreground level, leaving the app also breaks the segment because nothing is recorded then.
 */
export function summarize(
  records: TrackRecord[],
  session: { startedAt: number; endedAt: number; level: Level },
): RouteSummary {
  const points = records
    .filter((r): r is PointRecord => r.k === 'p')
    .sort((a, b) => a.t - b.t);
  const background = backgroundIntervals(records, session.endedAt);

  const gaps: Gap[] = [];
  const addGap = (fromT: number, toT: number) => {
    gaps.push({ fromT, toT, durationMs: toT - fromT, appLeft: overlaps(background, fromT, toT) });
  };

  const segments: PointRecord[][] = [];
  let current: PointRecord[] = [];
  let distanceM = 0;

  const firstT = points.length > 0 ? points[0].t : session.endedAt;
  if (firstT - session.startedAt > GAP_THRESHOLD_MS) addGap(session.startedAt, firstT);

  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev) {
      const dt = p.t - prev.t;
      const leftApp = overlaps(background, prev.t, p.t);
      if (dt > GAP_THRESHOLD_MS || (session.level === 'foreground' && leftApp)) {
        addGap(prev.t, p.t);
        segments.push(current);
        current = [];
      } else {
        distanceM += haversineM(prev, p);
      }
    }
    current.push(p);
  }
  if (current.length > 0) segments.push(current);

  const lastT = points.length > 0 ? points[points.length - 1].t : null;
  if (lastT !== null && session.endedAt - lastT > GAP_THRESHOLD_MS) addGap(lastT, session.endedAt);

  const accuracies = points.map((p) => p.acc).filter((a): a is number => a !== null && a >= 0);
  const coarse = accuracies.filter((a) => a > COARSE_ACCURACY_M).length;
  const coarseShare = accuracies.length > 0 ? coarse / accuracies.length : 0;

  return {
    points: points.length,
    segments,
    gaps,
    longestGapMs: gaps.reduce((max, g) => Math.max(max, g.durationMs), 0),
    distanceM,
    durationMs: session.endedAt - session.startedAt,
    medianAccuracyM: median(accuracies),
    coarseShare,
    coarseWarning: accuracies.length >= 3 && coarseShare >= COARSE_SHARE_WARNING,
    taskErrors: records.filter((r) => r.k === 'e').length,
  };
}

/** Parses JSONL; a torn last line (crash mid-write) is skipped instead of failing the whole read. */
export function parseTrack(text: string): TrackRecord[] {
  const records: TrackRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as TrackRecord);
    } catch {
      // ignore torn line
    }
  }
  return records;
}
