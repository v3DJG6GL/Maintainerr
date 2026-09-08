import { z } from 'zod';
import { SeerrApi } from './helpers/seerr-api.helper';

export type SeerrMediaType = 'movie' | 'tv';

export const seerrMediaKey = (
  mediaType: SeerrMediaType,
  tmdbId: number,
): string => `${mediaType}:${tmdbId}`;

export interface SeerrWatchlistMembership {
  readonly ownersByMedia: ReadonlyMap<string, readonly number[]>;
  readonly usernamesById: ReadonlyMap<number, string | undefined>;
}

const count = z.number().int().nonnegative();
const userSchema = z.object({
  id: z.number().int().positive(),
  plexUsername: z.string().nullish(),
  jellyfinUsername: z.string().nullish(),
  username: z.string().nullish(),
});
const usersPageSchema = z.object({
  pageInfo: z.object({
    pages: count,
    pageSize: z.number().int().positive(),
    results: count,
    page: z.number().int().positive(),
  }),
  results: z.array(userSchema),
});
const watchlistPageSchema = z.object({
  page: z.number().int().positive(),
  totalPages: count,
  totalResults: count,
  results: z.array(
    z.object({
      tmdbId: z.number().int().positive(),
      mediaType: z.enum(['movie', 'tv']),
    }),
  ),
});

/**
 * Seerr 3.4.1 exposes persisted native membership, falling back to Plex when
 * no native rows exist for a user. This is that API view, not a union of both
 * sources. Fetch all pages before publishing any negative membership answer.
 * Do not reuse getUsers(): its display-oriented contract erases read failures.
 */
export async function fetchSeerrWatchlistMembership(
  api: SeerrApi,
): Promise<SeerrWatchlistMembership> {
  const users: z.infer<typeof userSchema>[] = [];
  const userIds = new Set<number>();
  let userTotal: number | undefined;
  const userPageSize = 50;
  for (let page = 1; ; page++) {
    const response = usersPageSchema.parse(
      await api.getWithoutCache<unknown>(
        `/user?take=${userPageSize}&skip=${(page - 1) * userPageSize}`,
      ),
    );
    const info = response.pageInfo;
    userTotal ??= info.results;
    if (
      info.page !== page ||
      info.pageSize !== userPageSize ||
      info.results !== userTotal ||
      info.pages !== Math.ceil(userTotal / userPageSize) ||
      response.results.length !==
        Math.min(userPageSize, userTotal - users.length)
    ) {
      throw new Error('Incomplete Seerr user pagination');
    }
    for (const user of response.results) {
      if (userIds.has(user.id)) {
        throw new Error('Repeated Seerr user during pagination');
      }
      userIds.add(user.id);
      users.push(user);
    }
    if (users.length === userTotal) break;
  }

  const membership = {
    ownersByMedia: new Map<string, number[]>(),
    usernamesById: new Map<number, string | undefined>(),
  };
  // Sequential per-user sweeps live in this one shared prefetch, avoiding
  // nested fanout from concurrently evaluated media items.
  for (const user of users) {
    membership.usernamesById.set(
      user.id,
      user.plexUsername || user.jellyfinUsername || user.username || undefined,
    );
    const keys = new Set<string>();
    let total: number | undefined;
    for (let page = 1; ; page++) {
      const response = watchlistPageSchema.parse(
        await api.getWithoutCache<unknown>(
          `/user/${user.id}/watchlist?page=${page}`,
        ),
      );
      total ??= response.totalResults;
      // Empty native lists use totalPages=1; an empty Plex fallback may use 0.
      if (
        response.page !== page ||
        response.totalResults !== total ||
        (total === 0
          ? response.totalPages > 1
          : response.totalPages !== Math.ceil(total / 20)) ||
        response.results.length !== Math.min(20, total - keys.size)
      ) {
        throw new Error('Incomplete Seerr watchlist pagination');
      }
      for (const item of response.results) {
        const key = seerrMediaKey(item.mediaType, item.tmdbId);
        if (keys.has(key)) {
          throw new Error('Repeated Seerr watchlist item during pagination');
        }
        keys.add(key);
        const owners = membership.ownersByMedia.get(key) ?? [];
        owners.push(user.id);
        membership.ownersByMedia.set(key, owners);
      }
      if (keys.size === total) break;
    }
  }
  return membership;
}
