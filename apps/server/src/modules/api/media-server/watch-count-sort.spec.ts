import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models';
import { compareMediaItemsBySort } from '@maintainerr/contracts';
import { EmbyMapper } from './emby/emby.mapper';
import { JellyfinMapper } from './jellyfin/jellyfin.mapper';

describe.each([
  ['Jellyfin', JellyfinMapper],
  ['Emby', EmbyMapper],
] as const)('%s play-count sorting', (_server, mapper) => {
  it('sorts zero plays before watched items and unknown counts', () => {
    const items = [
      { Id: 'unknown', Name: 'A Unknown', UserData: undefined },
      { Id: 'watched', Name: 'B Watched', UserData: { PlayCount: 3 } },
      { Id: 'unplayed', Name: 'C Unplayed', UserData: { PlayCount: 0 } },
    ].map((item) => mapper.toMediaItem({ ...item, Type: BaseItemKind.Movie }));

    expect(
      [...items]
        .sort((a, b) => compareMediaItemsBySort(a, b, 'watchCount', 'asc'))
        .map((item) => item.id),
    ).toEqual(['unplayed', 'watched', 'unknown']);
    expect(
      [...items]
        .sort((a, b) => compareMediaItemsBySort(a, b, 'watchCount', 'desc'))
        .map((item) => item.id),
    ).toEqual(['watched', 'unplayed', 'unknown']);
  });
});
