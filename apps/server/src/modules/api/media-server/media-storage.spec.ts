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
});
