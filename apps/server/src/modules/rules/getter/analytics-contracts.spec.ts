import {
  streamystatsItemDetailsSchema,
  tracearrHistoryItemSchema,
} from '@maintainerr/contracts';

describe('analytics duration contracts', () => {
  const streamystatsDuration =
    streamystatsItemDetailsSchema.shape.totalWatchTime;
  const tracearrDuration = tracearrHistoryItemSchema.shape.duration_ms;

  it('accepts the normalized empty item emitted by Streamystats', () => {
    // getItemTotalStats and getItemCompletionRate normalize SQL null aggregates
    // to zero before serialization; date absence stays null.
    const result = streamystatsItemDetailsSchema.parse({
      item: { id: 'sample-item', type: 'Series' },
      totalViews: 0,
      totalWatchTime: 0,
      completionRate: 0,
      firstWatched: null,
      lastWatched: null,
      usersWatched: [],
      watchHistory: [],
      watchCountByMonth: [],
      episodeStats: {
        totalSeasons: 0,
        totalEpisodes: 0,
        watchedEpisodes: 0,
        watchedSeasons: 0,
      },
    });
    expect(result.totalWatchTime).toBe(0);
    expect(result.firstWatched).toBeNull();
  });

  it.each([0, 1.5, '0', '90.5'])(
    'accepts Streamystats numeric duration %s',
    (value) => {
      expect(streamystatsDuration.parse(value)).toBe(Number(value));
    },
  );

  it.each([
    null,
    undefined,
    '',
    '  ',
    true,
    false,
    -1,
    '-1',
    Infinity,
    'invalid',
  ])('rejects malformed Streamystats duration %s', (value) => {
    expect(streamystatsDuration.safeParse(value).success).toBe(false);
  });

  it.each([-1, Infinity, '100', true])(
    'rejects malformed Tracearr duration %s',
    (value) => {
      expect(tracearrDuration.safeParse(value).success).toBe(false);
    },
  );

  it.each([undefined, null])(
    'preserves unavailable Tracearr duration %s',
    (value) => {
      expect(tracearrDuration.parse(value)).toBe(value);
    },
  );
});
