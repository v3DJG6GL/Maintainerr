/** Build browser links without leaking API credentials, query strings or fragments. */
export function mediaAnalyticsUrl(
  base: string | undefined,
  segments: string[] = [],
): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    url.search = '';
    url.hash = '';
    let path = url.pathname;
    while (path.endsWith('/')) path = path.slice(0, -1);
    url.pathname =
      path +
      (segments.length
        ? '/' + segments.map(encodeURIComponent).join('/')
        : '/');
    return url.toString();
  } catch {
    return null;
  }
}
