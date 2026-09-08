import type {
  MediaItem,
  MediaPlaybackSummary,
  TracearrHistoryItem,
} from '@maintainerr/contracts';
import type { TracearrHistoryIndex } from './tracearr-api.service';

/** Summarizes the already validated, server-scoped public history snapshot. */
export function summarizeTracearrPlayback(
  index: TracearrHistoryIndex,
  item: MediaItem,
): MediaPlaybackSummary | undefined {
  let rows: TracearrHistoryItem[];
  if (item.type === 'movie' || item.type === 'episode') {
    rows = (index.rowsByRatingKey.get(item.id) ?? []).filter(
      (row) => row.media_type === item.type,
    );
  } else if (item.type === 'show' || item.type === 'season') {
    const showId = item.type === 'show' ? item.id : item.parentId;
    if (!showId || (item.type === 'season' && item.index === undefined)) {
      return undefined;
    }
    rows = (index.rowsByShowRatingKey.get(showId) ?? []).filter(
      (row) =>
        row.media_type === 'episode' &&
        (item.type === 'show' || row.season_number === item.index),
    );
  } else {
    return undefined;
  }

  // A missing row does not prove zero playback before the recorded coverage.
  if (rows.length === 0) {
    const addedAt = item.addedAt?.getTime();
    if (
      addedAt === undefined ||
      !Number.isFinite(addedAt) ||
      addedAt < index.earliestStartedAt
    ) {
      return undefined;
    }
  }

  const plays = new Map(rows.map((row) => [row.id, row]));
  let duration: number | null = 0;
  let latest: number | undefined;
  for (const row of plays.values()) {
    if (
      row.duration_ms == null ||
      !Number.isFinite(row.duration_ms) ||
      row.duration_ms < 0
    ) {
      duration = null;
    } else if (duration !== null) {
      duration += row.duration_ms;
      if (!Number.isFinite(duration)) duration = null;
    }
    if (row.stopped_at) {
      const timestamp = new Date(row.stopped_at).getTime();
      if (Number.isFinite(timestamp))
        latest = Math.max(latest ?? timestamp, timestamp);
    }
  }
  return {
    source: 'tracearr',
    playCount: plays.size,
    totalWatchTimeMs: duration,
    lastPlayedAt: latest === undefined ? null : new Date(latest).toISOString(),
  };
}
