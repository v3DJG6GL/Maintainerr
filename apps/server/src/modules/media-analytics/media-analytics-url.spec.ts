import { mediaAnalyticsUrl } from './media-analytics-url';
import { tracearrHistoryItemSchema } from '@maintainerr/contracts';

describe('Analytics browser links and optional Tracearr history enrichment', () => {
  it('preserves base paths, encodes path components and strips query credentials', () => {
    expect(
      mediaAnalyticsUrl('https://example.test/base/?token=secret#fragment', [
        'media',
        'item/with space',
      ]),
    ).toBe('https://example.test/base/media/item%2Fwith%20space');
    expect(mediaAnalyticsUrl('https://example.test/base')).toBe(
      'https://example.test/base/',
    );
  });

  it.each([
    'javascript:alert(1)',
    'file:///tmp/item',
    'https://user:secret@example.test',
    'invalid',
    undefined,
  ])('rejects unsafe URL %s', (base) => {
    expect(mediaAnalyticsUrl(base)).toBeNull();
  });

  it('accepts older history rows while validating optional canonical IDs and usernames', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const row = {
      id: uuid,
      server_id: uuid,
      server_type: 'jellyfin',
      media_type: 'movie',
      rating_key: 'native-id',
      parent_rating_key: null,
      grandparent_rating_key: null,
      season_number: null,
      episode_number: null,
      percent_complete: 10,
      watched: false,
      started_at: '2025-01-01T00:00:00Z',
      stopped_at: null,
      user: { id: uuid },
    };
    expect(tracearrHistoryItemSchema.safeParse(row).success).toBe(true);
    expect(
      tracearrHistoryItemSchema.parse({
        ...row,
        media_id: uuid,
        show_media_id: null,
        user: { id: uuid, username: 'Sample User' },
      }),
    ).toMatchObject({
      media_id: uuid,
      show_media_id: null,
      user: { username: 'Sample User' },
    });
    expect(
      tracearrHistoryItemSchema.safeParse({ ...row, media_id: 'native-id' })
        .success,
    ).toBe(false);
    expect(
      tracearrHistoryItemSchema.safeParse({
        ...row,
        show_media_id: 'https://example.test',
      }).success,
    ).toBe(false);
  });
});
