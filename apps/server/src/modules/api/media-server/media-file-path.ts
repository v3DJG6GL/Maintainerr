/** Keep filesystem locations separate from possibly credential-bearing stream URLs. */
export const toLocalMediaPath = (
  path: string | null | undefined,
): string | undefined => (path && !path.includes('://') ? path : undefined);
