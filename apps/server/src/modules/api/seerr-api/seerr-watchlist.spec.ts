import { TestBed } from '@suites/unit';
import { createMockLogger } from '../../../../test/utils/data';
import { MaintainerrLoggerFactory } from '../../logging/logs.service';
import { SettingsDataService } from '../../settings/settings-data.service';
import cacheManager from '../lib/cache';
import { SeerrApiService } from './seerr-api.service';
import { SeerrApi } from './helpers/seerr-api.helper';

describe('Seerr watchlist snapshots', () => {
  const usersPage = (ids: number[], total = ids.length, page = 1) => ({
    pageInfo: {
      pages: Math.ceil(total / 50),
      pageSize: 50,
      results: total,
      page,
    },
    results: ids.map((id) => ({ id, username: `user-${id}` })),
  });
  const listPage = (
    items: Array<{ tmdbId: number; mediaType: string }>,
    total = items.length,
    page = 1,
  ) => ({
    page,
    totalPages: Math.max(1, Math.ceil(total / 20)),
    totalResults: total,
    // Row IDs deliberately differ from TMDB IDs.
    results: items.map((item) => ({ id: item.tmdbId + 9000, ...item })),
  });
  let service: SeerrApiService;
  let getWithoutCache: jest.Mock;

  beforeEach(async () => {
    cacheManager.getCache('seerrrequests').data.flushAll();
    const { unit, unitRef } = await TestBed.solitary(SeerrApiService).compile();
    service = unit;
    const settings = unitRef.get(SettingsDataService);
    settings.seerrConfigured.mockReturnValue(true);
    settings.seerr_url = 'http://seerr.local';
    settings.seerr_api_key = 'test-key';
    unitRef
      .get(MaintainerrLoggerFactory)
      .createLogger.mockReturnValue(createMockLogger());
    getWithoutCache = jest.fn();
    service.api = { getWithoutCache } as unknown as SeerrApi;
  });

  it('reads every user and watchlist page, keeps media namespaces and shares the sweep', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const movies = Array.from({ length: 20 }, (_, i) => ({
      tmdbId: i + 1,
      mediaType: 'movie',
    }));
    getWithoutCache.mockImplementation(async (path: string) => {
      if (path === '/user?take=50&skip=0') return usersPage(ids, 51);
      if (path === '/user?take=50&skip=50') return usersPage([51], 51, 2);
      if (path === '/user/51/watchlist?page=1') return listPage(movies, 21);
      if (path === '/user/51/watchlist?page=2') {
        return listPage([{ tmdbId: 1, mediaType: 'tv' }], 21, 2);
      }
      return listPage([]);
    });
    const [first, second] = await Promise.all([
      service.getWatchlistMembership(),
      service.getWatchlistMembership(),
    ]);
    expect(first?.ownersByMedia.get('movie:1')).toEqual([51]);
    expect(first?.ownersByMedia.get('tv:1')).toEqual([51]);
    expect(first?.ownersByMedia.get('movie:9001')).toBeUndefined();
    expect(first?.usernamesById.get(51)).toBe('user-51');
    expect(second).toEqual(first);
    expect(getWithoutCache).toHaveBeenCalledTimes(54);
    expect((await service.getWatchlistMembership())?.ownersByMedia.size).toBe(
      21,
    );
    expect(getWithoutCache).toHaveBeenCalledTimes(54);
    cacheManager.getCache('seerrrequests').data.flushAll();
    await service.getWatchlistMembership();
    expect(getWithoutCache).toHaveBeenCalledTimes(108);
  });

  it('does not publish a partial snapshot after a late page fails and can retry', async () => {
    const movies = Array.from({ length: 20 }, (_, i) => ({
      tmdbId: i + 1,
      mediaType: 'movie',
    }));
    getWithoutCache
      .mockResolvedValueOnce(usersPage([1]))
      .mockResolvedValueOnce(listPage(movies, 21))
      .mockRejectedValueOnce(new Error('upstream unavailable'));
    await expect(service.getWatchlistMembership()).resolves.toBeUndefined();
    getWithoutCache
      .mockResolvedValueOnce(usersPage([1]))
      .mockResolvedValueOnce(listPage([]));
    expect((await service.getWatchlistMembership())?.ownersByMedia.size).toBe(
      0,
    );
  });

  it('discards an old instance sweep without clearing the newer in-flight snapshot', async () => {
    let resolveOld: (value: unknown) => void;
    let resolveNew: (value: unknown) => void;
    getWithoutCache.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = service.getWatchlistMembership();
    service.init();
    const nextGet = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
    service.api = { getWithoutCache: nextGet } as unknown as SeerrApi;
    const next = service.getWatchlistMembership();
    resolveOld(usersPage([]));
    await expect(old).resolves.toBeUndefined();
    const concurrent = service.getWatchlistMembership();
    expect(nextGet).toHaveBeenCalledTimes(1);
    resolveNew(usersPage([]));
    await expect(next).resolves.toEqual({
      ownersByMedia: new Map(),
      usernamesById: new Map(),
    });
    await expect(concurrent).resolves.toEqual(await next);
  });

  it.each([
    undefined,
    { page: 1, totalPages: 1, totalResults: 1, results: [] },
    { page: 2, totalPages: 1, totalResults: 0, results: [] },
    listPage([{ tmdbId: 1, mediaType: 'unknown' }]),
    listPage([
      { tmdbId: 1, mediaType: 'movie' },
      { tmdbId: 1, mediaType: 'movie' },
    ]),
  ])('rejects incomplete or invalid watchlist payload %j', async (payload) => {
    getWithoutCache
      .mockResolvedValueOnce(usersPage([1]))
      .mockResolvedValueOnce(payload);
    await expect(service.getWatchlistMembership()).resolves.toBeUndefined();
  });

  it('rejects duplicate users rather than omitting a different user', async () => {
    getWithoutCache.mockResolvedValueOnce(usersPage([1, 1]));
    await expect(service.getWatchlistMembership()).resolves.toBeUndefined();
  });

  it('accepts an empty Plex fallback and nullable names without guessing usernames', async () => {
    getWithoutCache
      .mockResolvedValueOnce({
        ...usersPage([1]),
        results: [
          { id: 1, plexUsername: null, jellyfinUsername: null, username: null },
        ],
      })
      .mockResolvedValueOnce({ ...listPage([]), totalPages: 0 });
    const result = await service.getWatchlistMembership();
    expect(result?.ownersByMedia.size).toBe(0);
    expect(result?.usernamesById.get(1)).toBeUndefined();
  });
});
