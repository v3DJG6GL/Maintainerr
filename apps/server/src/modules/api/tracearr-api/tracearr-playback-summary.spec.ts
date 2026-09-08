import {
  getMediaAnalyticsSortSource,
  isMediaAnalyticsSort,
  mediaAnalyticsSortFields,
  type TracearrHistoryItem,
} from '@maintainerr/contracts';
import { createMediaItem } from '../../../../test/utils/data';
import {
  TracearrApiService,
  type TracearrHistoryIndex,
} from './tracearr-api.service';
import { summarizeTracearrPlayback } from './tracearr-playback-summary';

const row = (
  id: string,
  changes: Partial<TracearrHistoryItem> = {},
): TracearrHistoryItem => ({
  id,
  server_id: 'server',
  server_type: 'jellyfin',
  media_type: 'episode',
  rating_key: 'episode',
  parent_rating_key: 'season',
  grandparent_rating_key: 'show',
  season_number: 0,
  episode_number: 1,
  percent_complete: 20,
  watched: false,
  duration_ms: 149001,
  started_at: '2025-01-01T00:00:00Z',
  stopped_at: '2025-01-01T00:02:29Z',
  user: { id: 'user' },
  ...changes,
});
const indexOf = (rows: TracearrHistoryItem[]): TracearrHistoryIndex => {
  const byKey = (key: 'rating_key' | 'grandparent_rating_key') => {
    const result = new Map<string, TracearrHistoryItem[]>();
    for (const item of rows) {
      if (item[key])
        result.set(item[key], [...(result.get(item[key]) ?? []), item]);
    }
    return result;
  };
  return {
    rowsById: new Map(rows.map((item) => [item.id, item])),
    rowsByRatingKey: byKey('rating_key'),
    rowsByShowRatingKey: byKey('grandparent_rating_key'),
    earliestStartedAt: Date.parse('2025-01-01T00:00:00Z'),
    unfinishedChainIds: new Set(),
  };
};
const movie = createMediaItem({
  id: 'movie',
  type: 'movie',
  addedAt: new Date('2025-02-01'),
});

describe('Tracearr playback summaries', () => {
  it('counts all users and unfinished plays once with millisecond precision', () => {
    const first = row('one', { media_type: 'movie', rating_key: 'movie' });
    const second = row('two', {
      media_type: 'movie',
      rating_key: 'movie',
      user: { id: 'other' },
      duration_ms: 120123,
      stopped_at: null,
    });
    expect(
      summarizeTracearrPlayback(indexOf([first, first, second]), movie),
    ).toEqual({
      source: 'tracearr',
      playCount: 2,
      totalWatchTimeMs: 269124,
      lastPlayedAt: '2025-01-01T00:02:29.000Z',
    });
  });

  it.each([null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains the count when duration %s is unknown',
    (duration_ms) => {
      expect(
        summarizeTracearrPlayback(
          indexOf([
            row('a', { media_type: 'movie', rating_key: 'movie', duration_ms }),
          ]),
          movie,
        ),
      ).toMatchObject({ playCount: 1, totalWatchTimeMs: null });
    },
  );

  it('distinguishes confirmed zero from missing history coverage', () => {
    expect(summarizeTracearrPlayback(indexOf([]), movie)).toEqual({
      source: 'tracearr',
      playCount: 0,
      totalWatchTimeMs: 0,
      lastPlayedAt: null,
    });
    expect(
      summarizeTracearrPlayback(indexOf([]), {
        ...movie,
        addedAt: new Date('2024-01-01'),
      }),
    ).toBeUndefined();
  });

  it('rolls up only the requested show and season, including season zero', () => {
    const index = indexOf([
      row('a'),
      row('b', { season_number: 1 }),
      row('c', { grandparent_rating_key: 'other-show' }),
    ]);
    expect(
      summarizeTracearrPlayback(
        index,
        createMediaItem({ type: 'show', id: 'show' }),
      )?.playCount,
    ).toBe(2);
    expect(
      summarizeTracearrPlayback(
        index,
        createMediaItem({ type: 'season', parentId: 'show', index: 0 }),
      )?.playCount,
    ).toBe(1);
    expect(
      summarizeTracearrPlayback(
        index,
        createMediaItem({ type: 'season', parentId: undefined, index: 0 }),
      ),
    ).toBeUndefined();
  });

  it('does not mix parent identifiers or another media type into movie counts', () => {
    const index = indexOf([
      row('a', { grandparent_rating_key: 'movie' }),
      row('b', { rating_key: 'movie' }),
    ]);
    expect(summarizeTracearrPlayback(index, movie)?.playCount).toBe(0);
  });

  it('does not fetch history from the synchronous service capability', () => {
    const getHistoryIndex = jest.fn().mockReturnValue(undefined);
    expect(
      TracearrApiService.prototype.getPlaybackSummary.call(
        { getHistoryIndex },
        movie,
      ),
    ).toBeUndefined();
    getHistoryIndex.mockReturnValue(indexOf([]));
    expect(
      TracearrApiService.prototype.getPlaybackSummary.call(
        { getHistoryIndex },
        movie,
      )?.playCount,
    ).toBe(0);
  });

  it('resolves only explicit analytics sort fields without extending native sort keys', () => {
    for (const field of mediaAnalyticsSortFields)
      expect(isMediaAnalyticsSort(field)).toBe(true);
    expect(isMediaAnalyticsSort('watchCount')).toBe(false);
    expect(getMediaAnalyticsSortSource('tracearrWatchTime')).toBe('tracearr');
    expect(getMediaAnalyticsSortSource('streamystatsPlayCount')).toBe(
      'streamystats',
    );
  });
});
