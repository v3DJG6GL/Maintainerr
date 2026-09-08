import type {
  MediaItem,
  MediaPlaybackSummary,
  MediaPlaybackDetails,
  TracearrHistoryItem,
} from '@maintainerr/contracts';
import type { TracearrHistoryIndex } from './tracearr-api.service';

function scopedPlays(
  index: TracearrHistoryIndex,
  item: MediaItem,
): TracearrHistoryItem[] | undefined {
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

  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function summarizePlays(plays: TracearrHistoryItem[]): MediaPlaybackSummary {
  let duration: number | null = 0;
  let latest: number | undefined;
  for (const row of plays) {
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
    playCount: plays.length,
    totalWatchTimeMs: duration,
    lastPlayedAt: latest === undefined ? null : new Date(latest).toISOString(),
  };
}

/** Summarizes the already validated, server-scoped public history snapshot. */
export function summarizeTracearrPlayback(
  index: TracearrHistoryIndex,
  item: MediaItem,
): MediaPlaybackSummary | undefined {
  const plays = scopedPlays(index, item);
  return plays === undefined ? undefined : summarizePlays(plays);
}

/** Detail metrics use exactly the same scope, chain deduplication and units. */
export function describeTracearrPlayback(
  index: TracearrHistoryIndex,
  item: MediaItem,
): { details: MediaPlaybackDetails; mediaId: string | null } | undefined {
  const plays = scopedPlays(index, item);
  if (plays === undefined) return undefined;
  const summary = summarizePlays(plays);
  const users = new Map<string, TracearrHistoryItem[]>();
  for (const play of plays) {
    const rows = users.get(play.user.id);
    if (rows) rows.push(play);
    else users.set(play.user.id, [play]);
  }
  const percentages = plays.map((play) => play.percent_complete);
  const completePercentages =
    percentages.length > 0 &&
    percentages.every(
      (value) =>
        value !== null && Number.isFinite(value) && value >= 0 && value <= 100,
    );
  // A season has no canonical ID on an episode history row. Never substitute
  // its show's ID or the last episode's ID as a season detail link.
  const mediaIds = new Set(
    plays
      .map((play) =>
        item.type === 'show'
          ? play.show_media_id
          : item.type === 'season'
            ? null
            : play.media_id,
      )
      .filter((id): id is string => Boolean(id)),
  );
  const episodic = item.type === 'show' || item.type === 'season';
  return {
    mediaId: mediaIds.size === 1 ? [...mediaIds][0] : null,
    details: {
      ...summary,
      externalUrl: null,
      averageCompletionPercent: completePercentages
        ? percentages.reduce((sum, value) => sum + value, 0) /
          percentages.length
        : null,
      users: [...users]
        .map(([id, rows]) => {
          const userSummary = summarizePlays(rows);
          return {
            id,
            name:
              rows.find((row) => row.user.username?.trim())?.user.username ??
              null,
            playCount: userSummary.playCount,
            totalWatchTimeMs: userSummary.totalWatchTimeMs,
            lastPlayedAt: userSummary.lastPlayedAt,
          };
        })
        .sort(
          (a, b) =>
            (a.name ?? a.id).localeCompare(b.name ?? b.id) ||
            a.id.localeCompare(b.id),
        ),
      episodes: episodic
        ? {
            playedEpisodes: plays.every((play) => Boolean(play.rating_key))
              ? new Set(plays.map((play) => play.rating_key)).size
              : null,
            totalEpisodes: null,
            seasonsWithPlayback: plays.every(
              (play) =>
                play.season_number !== null && play.season_number !== undefined,
            )
              ? new Set(plays.map((play) => play.season_number)).size
              : null,
          }
        : null,
    },
  };
}
