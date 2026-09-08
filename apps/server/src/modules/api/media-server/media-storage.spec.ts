import type { MediaItem } from '@maintainerr/contracts';
import type { IMediaServerService } from './media-server.interface';
import { getMediaStorageDetails } from './media-storage';

const item = (id: string, overrides: Partial<MediaItem> = {}): MediaItem => ({
  id,
  title: id,
  guid: id,
  type: 'movie',
  addedAt: new Date(0),
  providerIds: {},
  library: { id: 'library', title: 'Library' },
  mediaSources: [],
  ...overrides,
});

describe('getMediaStorageDetails', () => {
  const getMetadata = jest.fn();
  const getChildrenMetadata = jest.fn();
  const server = {
    getMetadata,
    getChildrenMetadata,
  } as unknown as IMediaServerService;

  beforeEach(() => jest.resetAllMocks());

  it('preserves multipart files, deduplicates paths and distinguishes zero from unknown', async () => {
    getMetadata.mockResolvedValue(
      item('movie', {
        mediaSources: [
          {
            id: 'a',
            duration: 0,
            files: [
              { path: '/a', sizeBytes: 0 },
              { path: '/b', sizeBytes: 100 },
            ],
          },
          {
            id: 'b',
            duration: 0,
            files: [{ path: '/b', sizeBytes: 100 }, { path: '/c' }],
          },
        ],
      }),
    );
    const result = await getMediaStorageDetails(server, 'movie');
    expect(result.status).toBe('partial');
    expect(result.sizeBytes).toBe(100);
    expect(result.files).toHaveLength(3);
    expect(result.files[0].sizeBytes).toBe(0);
    expect(result.files[2].sizeBytes).toBeUndefined();
  });

  it('uses typed strict hierarchy reads and marks failed seasons incomplete', async () => {
    getMetadata.mockResolvedValue(
      item('show', { type: 'show', folderPaths: ['/series'] }),
    );
    getChildrenMetadata.mockImplementation(async (id: string) => {
      if (id === 'show')
        return [item('s1', { type: 'season' }), item('s2', { type: 'season' })];
      if (id === 's1')
        return [
          item('e1', {
            type: 'episode',
            mediaSources: [{ id: 'source', duration: 0, sizeBytes: 250 }],
          }),
        ];
      throw new Error('Unavailable');
    });
    const result = await getMediaStorageDetails(server, 'show');
    expect(result).toMatchObject({
      status: 'partial',
      sizeBytes: 250,
      folders: ['/series'],
    });
    expect(getChildrenMetadata).toHaveBeenCalledWith('show', 'season', true);
    expect(getChildrenMetadata).toHaveBeenCalledWith('s1', 'episode', true);
  });

  it('does not claim an empty or unavailable metadata response means zero bytes', async () => {
    getMetadata.mockResolvedValue(undefined);
    expect(await getMediaStorageDetails(server, 'missing')).toMatchObject({
      status: 'unavailable',
      sizeBytes: null,
    });
    getMetadata.mockResolvedValue(item('unknown'));
    expect(await getMediaStorageDetails(server, 'unknown')).toMatchObject({
      status: 'unavailable',
      sizeBytes: null,
    });
  });

  it('reports a confirmed empty hierarchy and a zero-byte file correctly', async () => {
    getMetadata.mockResolvedValue(item('show', { type: 'show' }));
    getChildrenMetadata.mockResolvedValue([]);
    expect(await getMediaStorageDetails(server, 'show')).toMatchObject({
      status: 'complete',
      sizeBytes: 0,
    });
    getMetadata.mockResolvedValue(
      item('movie', { mediaSources: [{ id: 's', duration: 0, sizeBytes: 0 }] }),
    );
    expect(await getMediaStorageDetails(server, 'movie')).toMatchObject({
      status: 'complete',
      sizeBytes: 0,
    });
  });

  it('does not expose credential-bearing remote paths or count invalid sizes', async () => {
    getMetadata.mockResolvedValue(
      item('movie', {
        mediaSources: [
          {
            id: 's',
            duration: 0,
            files: [
              { path: 'https://user:secret@example.test/file', sizeBytes: -1 },
            ],
          },
        ],
      }),
    );
    const result = await getMediaStorageDetails(server, 'movie');
    expect(result.files[0].path).toBeUndefined();
    expect(result.sizeBytes).toBeNull();
  });

  it('reports show roots and groups files by traversed season, including specials', async () => {
    getMetadata.mockResolvedValue(
      item('show', { type: 'show', folderPaths: ['/series'] }),
    );
    getChildrenMetadata.mockImplementation(async (id: string) => {
      if (id === 'show') {
        return [
          item('specials', {
            type: 'season',
            index: 0,
            title: 'Specials',
            folderPaths: ['/series/Specials'],
          }),
          item('season-10', { type: 'season', index: 10 }),
        ];
      }
      return [
        item(`episode-${id}`, {
          type: 'episode',
          index: id === 'specials' ? 0 : 12,
          parentId: 'unreliable-parent',
          parentIndex: 99,
          mediaSources: [{ id: 'source', duration: 0, sizeBytes: 100 }],
        }),
      ];
    });
    const result = await getMediaStorageDetails(server, 'show');
    expect(result.itemType).toBe('show');
    expect(result.folders).toEqual(['/series']);
    expect(result.files[0]).toMatchObject({
      seasonId: 'specials',
      seasonNumber: 0,
      seasonTitle: 'Specials',
      episodeNumber: 0,
    });
    expect(result.files[1]).toMatchObject({
      seasonId: 'season-10',
      seasonNumber: 10,
      episodeNumber: 12,
    });
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('keeps selected season folders and falls back to episode numbering metadata', async () => {
    getMetadata.mockResolvedValue(
      item('season', {
        type: 'season',
        title: '',
        folderPaths: ['/series/Season 2'],
      }),
    );
    getChildrenMetadata.mockResolvedValue([
      item('episode', {
        type: 'episode',
        index: 3,
        parentIndex: 2,
        parentTitle: 'Season 2',
        folderPaths: ['/ignored'],
        mediaSources: [{ id: 'source', duration: 0, sizeBytes: 100 }],
      }),
    ]);
    const result = await getMediaStorageDetails(server, 'season');
    expect(result.itemType).toBe('season');
    expect(result.folders).toEqual(['/series/Season 2']);
    expect(result.files[0]).toMatchObject({
      seasonId: 'season',
      seasonNumber: 2,
      seasonTitle: 'Season 2',
      episodeNumber: 3,
    });
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it('uses selected episode metadata without fetching arbitrary parents', async () => {
    getMetadata.mockResolvedValue(
      item('episode', {
        type: 'episode',
        index: 4,
        parentId: 'specials',
        parentIndex: 0,
        parentTitle: 'Specials',
        mediaSources: [{ id: 'source', duration: 0, sizeBytes: 100 }],
      }),
    );
    const result = await getMediaStorageDetails(server, 'episode');
    expect(result.itemType).toBe('episode');
    expect(result.files[0]).toMatchObject({
      seasonId: 'specials',
      seasonNumber: 0,
      seasonTitle: 'Specials',
      episodeNumber: 4,
    });
    expect(getMetadata).toHaveBeenCalledTimes(1);
    expect(getChildrenMetadata).not.toHaveBeenCalled();
  });

  it.each(['movie', 'episode'] as const)(
    'leaves unknown hierarchy unset for %s rather than inventing a season',
    async (type) => {
      getMetadata.mockResolvedValue(
        item('media', {
          type,
          ...(type === 'movie' ? { parentId: 'library-folder' } : {}),
          mediaSources: [{ id: 'source', duration: 0, sizeBytes: 100 }],
        }),
      );
      const result = await getMediaStorageDetails(server, 'media');
      expect(result.itemType).toBe(type);
      expect(result.files[0].seasonId).toBeUndefined();
      expect(result.files[0].seasonNumber).toBeUndefined();
      expect(result.files[0].seasonTitle).toBeUndefined();
      expect(result.files[0].episodeNumber).toBeUndefined();
      expect(getMetadata).toHaveBeenCalledTimes(1);
      expect(getChildrenMetadata).not.toHaveBeenCalled();
    },
  );
});
