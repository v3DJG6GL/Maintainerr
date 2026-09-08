export type SeerrMediaType = 'movie' | 'tv';

export const seerrMediaKey = (
  mediaType: SeerrMediaType,
  tmdbId: number,
): string => `${mediaType}:${tmdbId}`;
