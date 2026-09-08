import {
  MediaItem,
  MediaServerType,
  TracearrHistoryItem,
} from '@maintainerr/contracts';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createMediaItem, createMockLogger } from '../../../test/utils/data';
import { MediaItemEnrichmentService } from '../api/media-server/media-item-enrichment.service';
import { MediaServerFactory } from '../api/media-server/media-server.factory';
import { StreamystatsApiService } from '../api/streamystats-api/streamystats-api.service';
import {
  TracearrApiService,
  TracearrHistoryIndex,
} from '../api/tracearr-api/tracearr-api.service';
import { CollectionsService } from '../collections/collections.service';
import type { AnalyticsBrowseRequest } from './media-analytics.controller';
import { SettingsDataService } from '../settings/settings-data.service';
import { MediaAnalyticsService } from './media-analytics.service';

const movie = (id: string, changes: Partial<MediaItem> = {}): MediaItem =>
  createMediaItem({
    id,
    title: 'Sample Movie',
    type: 'movie',
    addedAt: new Date('2025-02-01'),
    parentTitle: undefined,
    grandparentTitle: undefined,
    ...changes,
  });
const request = (
  changes: Partial<AnalyticsBrowseRequest> = {},
): AnalyticsBrowseRequest => ({
  scope: 'library',
  id: 'library',
  type: 'movie',
  sort: 'tracearrPlayCount',
  sortOrder: 'desc',
  offset: 0,
  limit: 30,
  ...changes,
});
const history = (counts: Record<string, number>): TracearrHistoryIndex => {
  const rowsByRatingKey = new Map<string, TracearrHistoryItem[]>();
  const rowsById = new Map<string, TracearrHistoryItem>();
  for (const [id, count] of Object.entries(counts)) {
    const rows = Array.from(
      { length: count },
      (_, position): TracearrHistoryItem => ({
        id: `${id}-${position}`,
        rating_key: id,
        media_type: 'movie',
        server_id: 'server',
        server_type: 'jellyfin',
        user: { id: 'user' },
        parent_rating_key: null,
        grandparent_rating_key: null,
        season_number: null,
        episode_number: null,
        duration_ms: 120001,
        watched: false,
        percent_complete: 10,
        started_at: '2025-01-01T00:00:00Z',
        stopped_at: '2025-01-01T00:02:00Z',
      }),
    );
    rowsByRatingKey.set(id, rows);
    rows.forEach((row) => rowsById.set(row.id, row));
  }
  return {
    rowsByRatingKey,
    rowsById,
    rowsByShowRatingKey: new Map(),
    earliestStartedAt: Date.parse('2025-01-01'),
    unfinishedChainIds: new Set(),
  };
};
const details = (id: string, plays = 1, seconds = 1.25) => ({
  status: 'ready',
  data: {
    item: { id },
    totalViews: plays,
    totalWatchTime: seconds,
    lastWatched: null,
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe('MediaAnalyticsService complete analytics snapshots', () => {
  let service: MediaAnalyticsService;
  let media: MediaItem[];
  const server = {
    getStatus: jest.fn(),
    getLibraryContents: jest.fn(),
    getMetadata: jest.fn(),
    itemExists: jest.fn(),
    searchContent: jest.fn(),
    getLibraries: jest.fn(),
  };
  const factory = { getService: jest.fn(), getConfiguredServerType: jest.fn() };
  const tracearr = {
    api: {},
    prefetchHistory: jest.fn(),
    getHistoryIndex: jest.fn(),
    getPlaybackSummary: jest.fn(),
  };
  const streamystats = {
    api: {},
    getItemDetailsResult: jest.fn(),
    getResolvedServerId: jest.fn(),
  };
  const collections = {
    getCollectionMediaWithServerDataAndPaging: jest.fn(),
    getCollectionExclusionsWithServerDataAndPaging: jest.fn(),
  };
  const enrichment = { enrichItems: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    media = [movie('a'), movie('b')];
    tracearr.api = {};
    streamystats.api = {};
    factory.getService.mockResolvedValue(server);
    factory.getConfiguredServerType.mockResolvedValue(MediaServerType.JELLYFIN);
    server.getStatus.mockResolvedValue(true);
    server.getMetadata.mockImplementation((id: string) =>
      Promise.resolve(media.find((item) => item.id === id)),
    );
    server.getLibraryContents.mockImplementation(
      (_id: string, options: { offset: number; limit: number }) =>
        Promise.resolve({
          items: media.slice(options.offset, options.offset + options.limit),
          totalSize: media.length,
        }),
    );
    tracearr.getHistoryIndex.mockReturnValue(history({ a: 2, b: 1 }));
    streamystats.getItemDetailsResult.mockImplementation((id: string) =>
      Promise.resolve(details(id)),
    );
    enrichment.enrichItems.mockImplementation((items: MediaItem[]) =>
      Promise.resolve(items),
    );
    service = new MediaAnalyticsService(
      factory as unknown as MediaServerFactory,
      tracearr as unknown as TracearrApiService,
      streamystats as unknown as StreamystatsApiService,
      collections as unknown as CollectionsService,
      enrichment as unknown as MediaItemEnrichmentService,
      createMockLogger(),
      {
        tracearr_url: 'https://tracearr.example/base/',
        streamystats_url: 'https://streamystats.example/base/',
      } as SettingsDataService,
    );
  });

  const finish = async (input = request()) => {
    const pending = await service.browse(input);
    // Await the worker deterministically without polling or real timer delays.
    await (service as unknown as { queue: Promise<void> }).queue;
    const result = await service.browse({
      ...input,
      snapshotId: pending.snapshotId,
    });
    if (result.status !== 'ready')
      throw new Error('Expected a completed snapshot');
    return result;
  };
  const ids = (items: Array<MediaItem | { mediaData?: MediaItem }>) =>
    items.map((item) => ('id' in item ? item.id : item.mediaData?.id));

  it('ranks the complete library before slicing a page', async () => {
    media = Array.from({ length: 251 }, (_, index) => movie(`item-${index}`));
    tracearr.getHistoryIndex.mockReturnValue(history({ 'item-250': 3 }));
    const result = await finish(request({ limit: 1 }));
    expect(ids(result.items)).toEqual(['item-250']);
    expect(result.totalSize).toBe(251);
    expect(server.getLibraryContents).toHaveBeenCalledTimes(2);
    expect(server.getLibraryContents).toHaveBeenLastCalledWith(
      'library',
      expect.objectContaining({ offset: 250 }),
    );
    expect(tracearr.prefetchHistory).toHaveBeenCalledTimes(1);
  });

  it('paginates analytics search beyond quick search limits across movie and series libraries', async () => {
    const movies = Array.from({ length: 251 }, (_, index) =>
      movie(`item-${index}`),
    );
    const show = movie('show', { type: 'show' });
    const episode = movie('episode', { type: 'episode' });
    server.getLibraries.mockResolvedValue([
      { id: 'movies', type: 'movie' },
      { id: 'series', type: 'show' },
    ]);
    server.searchContent.mockResolvedValue(movies.slice(0, 50));
    server.getLibraryContents.mockImplementation(
      (
        _id: string,
        options: { type: string; offset: number; limit: number },
      ) => {
        const items =
          options.type === 'movie'
            ? movies
            : options.type === 'show'
              ? [show]
              : [episode];
        return Promise.resolve({
          items: items.slice(options.offset, options.offset + options.limit),
          totalSize: items.length,
        });
      },
    );
    tracearr.getHistoryIndex.mockReturnValue(history({ 'item-250': 3 }));
    const result = await finish(
      request({ scope: 'search', id: 'Sample', limit: 1 }),
    );
    expect(ids(result.items)).toEqual(['item-250']);
    expect(result.totalSize).toBe(253);
    expect(server.searchContent).not.toHaveBeenCalled();
    expect(server.getLibraryContents).toHaveBeenCalledTimes(4);
    expect(server.getLibraryContents).toHaveBeenCalledWith(
      'movies',
      expect.objectContaining({
        type: 'movie',
        offset: 250,
        searchQuery: 'Sample',
      }),
    );
    for (const type of ['show', 'episode']) {
      expect(server.getLibraryContents).toHaveBeenCalledWith(
        'series',
        expect.objectContaining({ type, searchQuery: 'Sample' }),
      );
    }
  });

  it.each([
    [true, ServiceUnavailableException],
    [false, NotFoundException],
  ] as const)(
    'distinguishes missing metadata from confirmed absence when itemExists is %s',
    async (exists, exception) => {
      server.getMetadata.mockResolvedValue(undefined);
      server.itemExists.mockResolvedValue(exists);
      await expect(service.item('a', 'streamystats')).rejects.toBeInstanceOf(
        exception,
      );
      expect(streamystats.getItemDetailsResult).not.toHaveBeenCalled();
    },
  );

  it('returns unavailable when media item presence cannot be checked', async () => {
    server.getMetadata.mockResolvedValue(undefined);
    server.itemExists.mockRejectedValue(new Error('Media server unavailable'));
    await expect(service.item('a', 'streamystats')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(streamystats.getItemDetailsResult).not.toHaveBeenCalled();
  });

  it('does not restore invalidated compact summaries after an old fetch completes with the same client', async () => {
    const started = deferred<void>();
    const response = deferred<ReturnType<typeof details>>();
    const client = streamystats.api;
    streamystats.getItemDetailsResult.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const stale = service.item('a', 'streamystats');
    await started.promise;
    service.invalidate();
    expect(streamystats.api).toBe(client);
    response.resolve(details('a', 1, 1));
    await expect(stale).rejects.toBeInstanceOf(ServiceUnavailableException);
    streamystats.getItemDetailsResult.mockResolvedValue(details('a', 9, 12));
    await expect(service.item('a', 'streamystats')).resolves.toMatchObject({
      playCount: 9,
      totalWatchTimeMs: 12000,
    });
    expect(streamystats.getItemDetailsResult).toHaveBeenCalledTimes(2);
  });

  it('keeps contradictory source counts independent and converts seconds to milliseconds', async () => {
    streamystats.getItemDetailsResult.mockImplementation((id: string) =>
      Promise.resolve(details(id, id === 'b' ? 9 : 1, id === 'b' ? 3.125 : 1)),
    );
    const traced = await finish();
    const streamed = await finish(request({ sort: 'streamystatsPlayCount' }));
    expect(ids(traced.items)).toEqual(['a', 'b']);
    expect(ids(streamed.items)).toEqual(['b', 'a']);
    expect(traced.items[0]).toMatchObject({
      playbackSummary: {
        source: 'tracearr',
        playCount: 2,
        totalWatchTimeMs: 240002,
      },
    });
    expect(streamed.items[0]).toMatchObject({
      playbackSummary: {
        source: 'streamystats',
        playCount: 9,
        totalWatchTimeMs: 3125,
      },
    });
  });

  it.each(['asc', 'desc'] as const)(
    'keeps unknown values last and uses stable ID ties in %s order',
    async (sortOrder) => {
      media = [
        movie('unknown', { addedAt: new Date('2020-01-01') }),
        movie('b'),
        movie('a'),
        movie('zero'),
      ];
      tracearr.getHistoryIndex.mockReturnValue(history({ a: 1, b: 1 }));
      const result = await finish(
        request({ sort: 'tracearrWatchTime', sortOrder }),
      );
      expect(ids(result.items)).toEqual(
        sortOrder === 'asc'
          ? ['zero', 'a', 'b', 'unknown']
          : ['a', 'b', 'zero', 'unknown'],
      );
    },
  );

  it('pins later pages to the same ranking even if history changes', async () => {
    const first = await finish(request({ limit: 1 }));
    tracearr.getHistoryIndex.mockReturnValue(history({ b: 20 }));
    const second = await service.browse(
      request({ offset: 1, limit: 1, snapshotId: first.snapshotId }),
    );
    expect(second.status).toBe('ready');
    if (second.status === 'ready') expect(ids(second.items)).toEqual(['b']);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(tracearr.prefetchHistory).toHaveBeenCalledTimes(1);
    await expect(service.browse(request({ offset: 1 }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('captures the Tracearr index once for every item in the snapshot', async () => {
    media = Array.from({ length: 9 }, (_, index) => movie(`item-${index}`));
    tracearr.getHistoryIndex
      .mockReturnValueOnce(history({ 'item-8': 2 }))
      .mockReturnValue(undefined);
    const result = await finish(request({ limit: 1 }));
    expect(ids(result.items)).toEqual(['item-8']);
    expect(tracearr.getHistoryIndex).toHaveBeenCalledTimes(1);
    expect(tracearr.getPlaybackSummary).not.toHaveBeenCalled();
  });

  it.each(['settings', 'client'] as const)(
    'rejects old snapshots after %s changes',
    async (change) => {
      const first = await finish();
      if (change === 'settings') service.invalidate();
      else tracearr.api = {};
      await expect(
        service.browse(request({ snapshotId: first.snapshotId })),
      ).rejects.toBeInstanceOf(ConflictException);
      const refreshed = await finish();
      expect(refreshed.snapshotId).not.toBe(first.snapshotId);
    },
  );

  it('rejects an old page if settings change while membership enrichment is pending', async () => {
    const first = await finish();
    const started = deferred<void>();
    const enrich = deferred<MediaItem[]>();
    enrichment.enrichItems.mockImplementationOnce(() => {
      started.resolve();
      return enrich.promise;
    });
    const page = service.browse(request({ snapshotId: first.snapshotId }));
    await started.promise;
    service.invalidate();
    enrich.resolve(media);
    await expect(page).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['empty', 'duplicate', 'changing total'] as const)(
    'fails closed on a %s library page',
    async (failure) => {
      server.getLibraryContents
        .mockResolvedValueOnce({ items: [media[0]], totalSize: 2 })
        .mockResolvedValueOnce({
          items:
            failure === 'empty'
              ? []
              : [failure === 'duplicate' ? media[0] : media[1]],
          totalSize: failure === 'changing total' ? 3 : 2,
        });
      await expect(finish()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(tracearr.prefetchHistory).not.toHaveBeenCalled();
      expect(enrichment.enrichItems).not.toHaveBeenCalled();
    },
  );

  it.each(['collection', 'exclusions'] as const)(
    'rejects missing metadata from a %s without publishing a partial ranking',
    async (scope) => {
      const partial = { totalSize: 2, items: [{ mediaData: media[0] }] };
      collections.getCollectionMediaWithServerDataAndPaging.mockResolvedValue(
        partial,
      );
      collections.getCollectionExclusionsWithServerDataAndPaging.mockResolvedValue(
        partial,
      );
      await expect(finish(request({ scope, id: '1' }))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(tracearr.prefetchHistory).not.toHaveBeenCalled();
    },
  );

  it('rejects incomplete Tracearr history without publishing a zero ranking', async () => {
    tracearr.getHistoryIndex.mockReturnValue(undefined);
    await expect(finish()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(enrichment.enrichItems).not.toHaveBeenCalled();
  });

  it('keeps a Streamystats 404 unknown but rejects an unavailable source without fallback', async () => {
    streamystats.getItemDetailsResult.mockResolvedValue({ status: 'missing' });
    const result = await finish(request({ sort: 'streamystatsPlayCount' }));
    expect(result.items[0]).toMatchObject({
      playbackSummary: {
        source: 'streamystats',
        playCount: null,
        totalWatchTimeMs: null,
      },
    });
    service.invalidate();
    streamystats.getItemDetailsResult.mockResolvedValue({
      status: 'unavailable',
    });
    await expect(
      finish(request({ sort: 'streamystatsPlayCount' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tracearr.prefetchHistory).not.toHaveBeenCalled();
  });

  it('rejects mismatched Streamystats item identity', async () => {
    streamystats.getItemDetailsResult.mockResolvedValue(
      details('another-item'),
    );
    await expect(
      finish(request({ sort: 'streamystatsWatchTime' })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('bounds Streamystats workers to four and shares preparation across concurrent browsers', async () => {
    media = Array.from({ length: 9 }, (_, index) => movie(`item-${index}`));
    const started = deferred<void>();
    const release = deferred<void>();
    let active = 0;
    let maximum = 0;
    streamystats.getItemDetailsResult.mockImplementation(async (id: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active === 4) started.resolve();
      await release.promise;
      active -= 1;
      return details(id);
    });
    const input = request({ sort: 'streamystatsWatchTime' });
    const first = await service.browse(input);
    await started.promise;
    const second = await service.browse(input);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.status).toBe('preparing');
    expect(streamystats.getItemDetailsResult).toHaveBeenCalledTimes(4);
    release.resolve();
    await (service as unknown as { queue: Promise<void> }).queue;
    const result = await service.browse({
      ...input,
      snapshotId: first.snapshotId,
    });
    expect(result.status).toBe('ready');
    expect(maximum).toBe(4);
    expect(streamystats.getItemDetailsResult).toHaveBeenCalledTimes(9);
    expect(server.getLibraryContents).toHaveBeenCalledTimes(1);
    expect(streamystats.getItemDetailsResult).toHaveBeenCalledWith('item-0', {
      cacheResult: false,
    });
  });

  it('does not request unsupported Streamystats seasons or infer zero playback for them', async () => {
    media = [movie('season', { type: 'season' })];
    const result = await finish(
      request({ sort: 'streamystatsWatchTime', type: 'season' }),
    );
    expect(result.items[0]).toMatchObject({
      playbackSummary: {
        source: 'streamystats',
        playCount: null,
        totalWatchTimeMs: null,
      },
    });
    expect(streamystats.getItemDetailsResult).not.toHaveBeenCalled();
  });

  it('invalidates cached Streamystats summaries when settings change', async () => {
    await finish(request({ sort: 'streamystatsWatchTime' }));
    service.invalidate();
    streamystats.getItemDetailsResult.mockImplementation((id: string) =>
      Promise.resolve(details(id, 10, 12)),
    );
    const result = await finish(request({ sort: 'streamystatsWatchTime' }));
    expect(result.items[0]).toMatchObject({
      playbackSummary: { playCount: 10, totalWatchTimeMs: 12000 },
    });
    expect(streamystats.getItemDetailsResult).toHaveBeenCalledTimes(4);
  });

  describe('unified item details', () => {
    const streamyDetail = (plays = 2) => ({
      status: 'ready',
      data: {
        item: { id: 'a' },
        totalViews: plays,
        totalWatchTime: 12.345,
        completionRate: 45,
        lastWatched: null,
        usersWatched: [
          {
            user: { id: 'user', name: 'Sample User' },
            watchCount: 2,
            totalWatchTime: 12.345,
            lastWatched: null,
          },
        ],
        episodeStats: {
          watchedEpisodes: 3,
          totalEpisodes: 8,
          watchedSeasons: 2,
        },
      },
    });

    it('normalizes Streamystats detail metrics and preserves the configured URL base path', async () => {
      streamystats.getItemDetailsResult.mockResolvedValue(streamyDetail());
      streamystats.getResolvedServerId.mockResolvedValue(4);
      await expect(service.details('a', 'streamystats')).resolves.toEqual({
        source: 'streamystats',
        playCount: 2,
        totalWatchTimeMs: 12345,
        lastPlayedAt: null,
        averageCompletionPercent: 45,
        externalUrl: 'https://streamystats.example/base/servers/4/library/a',
        users: [
          {
            id: 'user',
            name: 'Sample User',
            playCount: 2,
            totalWatchTimeMs: 12345,
            lastPlayedAt: null,
          },
        ],
        episodes: {
          playedEpisodes: 3,
          totalEpisodes: 8,
          seasonsWithPlayback: 2,
        },
      });
    });

    it('does not display empty upstream completion averages as zero percent', async () => {
      streamystats.getItemDetailsResult.mockResolvedValue(streamyDetail(0));
      streamystats.getResolvedServerId.mockResolvedValue(null);
      await expect(service.details('a', 'streamystats')).resolves.toMatchObject(
        {
          playCount: 0,
          averageCompletionPercent: null,
          externalUrl: 'https://streamystats.example/base/',
        },
      );
    });

    it.each([-1, 101, Number.NaN])(
      'keeps invalid completion %s unknown',
      async (completionRate) => {
        const result = streamyDetail();
        result.data.completionRate = completionRate;
        streamystats.getItemDetailsResult.mockResolvedValue(result);
        await expect(
          service.details('a', 'streamystats'),
        ).resolves.toMatchObject({ averageCompletionPercent: null });
      },
    );

    it('distinguishes missing Streamystats data from source outages', async () => {
      streamystats.getItemDetailsResult.mockResolvedValue({
        status: 'missing',
      });
      await expect(service.details('a', 'streamystats')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      streamystats.getItemDetailsResult.mockResolvedValue({
        status: 'unavailable',
      });
      await expect(service.details('a', 'streamystats')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('keeps overflowed aggregate and user durations unknown', async () => {
      const result = streamyDetail();
      result.data.totalWatchTime = Number.MAX_VALUE;
      result.data.usersWatched[0].totalWatchTime = Number.MAX_VALUE;
      streamystats.getItemDetailsResult.mockResolvedValue(result);
      await expect(service.details('a', 'streamystats')).resolves.toMatchObject(
        { totalWatchTimeMs: null, users: [{ totalWatchTimeMs: null }] },
      );
    });

    it.each([true, false] as const)(
      'preserves metadata absence handling in details when presence is %s',
      async (exists) => {
        server.getMetadata.mockResolvedValue(undefined);
        server.itemExists.mockResolvedValue(exists);
        await expect(
          service.details('a', 'streamystats'),
        ).rejects.toBeInstanceOf(
          exists ? ServiceUnavailableException : NotFoundException,
        );
      },
    );

    it('rejects unavailable Tracearr history in details', async () => {
      tracearr.getHistoryIndex.mockReturnValue(undefined);
      await expect(service.details('a', 'tracearr')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rejects different item identity from the detailed endpoint', async () => {
      streamystats.getItemDetailsResult.mockResolvedValue({
        ...streamyDetail(),
        data: { ...streamyDetail().data, item: { id: 'other' } },
      });
      await expect(service.details('a', 'streamystats')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('uses the same Tracearr count and duration as the compact summary', async () => {
      const result = await service.details('a', 'tracearr');
      expect(result).toMatchObject({
        source: 'tracearr',
        playCount: 2,
        totalWatchTimeMs: 240002,
        averageCompletionPercent: 10,
        externalUrl: 'https://tracearr.example/base/',
        users: [
          { id: 'user', name: null, playCount: 2, totalWatchTimeMs: 240002 },
        ],
      });
      expect(streamystats.getItemDetailsResult).not.toHaveBeenCalled();
    });

    it('links a Tracearr movie through its canonical ID while retaining the configured base path', async () => {
      const index = history({ a: 1 });
      const uuid = '00000000-0000-4000-8000-000000000001';
      index.rowsByRatingKey.get('a')[0].media_id = uuid;
      tracearr.getHistoryIndex.mockReturnValue(index);
      await expect(service.details('a', 'tracearr')).resolves.toMatchObject({
        externalUrl: `https://tracearr.example/base/media/${uuid}`,
      });
    });

    it('returns unavailable when detailed media presence cannot be checked', async () => {
      server.getMetadata.mockResolvedValue(undefined);
      server.itemExists.mockRejectedValue(
        new Error('Media server unavailable'),
      );
      await expect(service.details('a', 'streamystats')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('rejects settings changes while detailed Streamystats data is loading', async () => {
      const started = deferred<void>();
      const response = deferred<ReturnType<typeof streamyDetail>>();
      streamystats.getItemDetailsResult.mockImplementationOnce(() => {
        started.resolve();
        return response.promise;
      });
      const pending = service.details('a', 'streamystats');
      await started.promise;
      service.invalidate();
      response.resolve(streamyDetail());
      await expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not request season detail data that Streamystats cannot aggregate', async () => {
      server.getMetadata.mockResolvedValue(movie('season', { type: 'season' }));
      await expect(
        service.details('season', 'streamystats'),
      ).resolves.toMatchObject({
        playCount: null,
        users: null,
        episodes: null,
      });
      expect(streamystats.getItemDetailsResult).not.toHaveBeenCalled();
    });
  });
});
