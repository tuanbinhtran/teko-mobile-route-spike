import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { parseTrack, summarize, type Level, type TrackRecord } from './routeMath';

/** One session at a time (spike): starting a new walk overwrites the previous one. */
export interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt: number | null;
  level: Level;
  /** Why the foreground level was used; null for background. */
  fallbackReason: string | null;
  accuracyAuthorization: 'full' | 'reduced' | null;
  /** 0..1, null if the device does not report it (simulator). */
  batteryStart: number | null;
  batteryEnd: number | null;
  expoGo: boolean;
}

const dir = new Directory(Paths.document, 'pawtrack');
const metaFile = new File(dir, 'session.json');
const trackFile = new File(dir, 'track.jsonl');

export function startSession(meta: SessionMeta): void {
  dir.create({ intermediates: true, idempotent: true });
  trackFile.create({ overwrite: true });
  metaFile.create({ overwrite: true });
  metaFile.writeSync(JSON.stringify(meta));
}

export function writeMeta(meta: SessionMeta): void {
  metaFile.writeSync(JSON.stringify(meta));
}

export function readMeta(): SessionMeta | null {
  if (!metaFile.exists) return null;
  return JSON.parse(metaFile.textSync()) as SessionMeta;
}

/** Synchronous append: called from the background task, which may be the only JS running. */
export function appendRecords(records: TrackRecord[]): void {
  if (records.length === 0 || !trackFile.exists) return;
  trackFile.writeSync(records.map((r) => JSON.stringify(r)).join('\n') + '\n', { append: true });
}

export function readRecords(): TrackRecord[] {
  return trackFile.exists ? parseTrack(trackFile.textSync()) : [];
}

export async function shareSession(meta: SessionMeta, records: TrackRecord[]): Promise<void> {
  const endedAt = meta.endedAt ?? Date.now();
  const { segments: _segments, ...summary } = summarize(records, { ...meta, endedAt });
  const file = new File(Paths.cache, `pawtrack-${meta.id}.json`);
  file.create({ overwrite: true });
  file.writeSync(JSON.stringify({ format: 'pawtrack-route-spike/1', meta, summary, records }, null, 2));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Aufnahme exportieren',
  });
}
