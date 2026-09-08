import type {
  MediaItem,
  MediaStorageDetails,
  MediaStorageFile,
} from '@maintainerr/contracts';
import type { IMediaServerService } from './media-server.interface';

import { toLocalMediaPath } from './media-file-path';

const usableSize = (size: number | undefined): size is number =>
  size != null && Number.isFinite(size) && size >= 0;

/** Modal-only traversal. Never run this for a library grid or rule evaluation. */
export async function getMediaStorageDetails(
  server: IMediaServerService,
  itemId: string,
): Promise<MediaStorageDetails> {
  const files = new Map<string, MediaStorageFile>();
  const folders = new Set<string>();
  const visited = new Set<string>();
  let itemType: MediaStorageDetails['itemType'];
  let complete = true;
  let available = false;
  const limit = 10_000;

  const visit = async (item: MediaItem, season?: MediaItem): Promise<void> => {
    if (visited.has(item.id)) return;
    if (visited.size >= limit) {
      complete = false;
      return;
    }
    visited.add(item.id);
    if (item.type === 'show' || item.type === 'season') {
      try {
        const children = await server.getChildrenMetadata(
          item.id,
          item.type === 'show' ? 'season' : 'episode',
          true,
        );
        available = true;
        for (const child of children) {
          await visit(child, item.type === 'season' ? item : undefined);
        }
      } catch {
        complete = false;
      }
      return;
    }
    if (!item.mediaSources.length) {
      complete = false;
      return;
    }
    for (const source of item.mediaSources) {
      const parts = source.files?.length
        ? source.files
        : [{ sizeBytes: source.sizeBytes }];
      for (const [index, part] of parts.entries()) {
        const path = toLocalMediaPath(part.path);
        const key = path ?? `${item.id}:${source.id}:${part.id ?? index}`;
        const sizeBytes = usableSize(part.sizeBytes)
          ? part.sizeBytes
          : undefined;
        if (sizeBytes === undefined) complete = false;
        else available = true;
        if (files.has(key)) continue;
        if (files.size >= limit) {
          complete = false;
          continue;
        }
        files.set(key, {
          id: part.id,
          path,
          sizeBytes,
          itemId: item.id,
          title: item.title,
          sourceId: source.id,
          ...(item.type === 'episode'
            ? {
                seasonId: season?.id ?? item.parentId,
                seasonNumber: season?.index ?? item.parentIndex,
                seasonTitle: season?.title || item.parentTitle,
                episodeNumber: item.index,
              }
            : {}),
          videoResolution: source.videoResolution,
          videoCodec: source.videoCodec,
          audioCodec: source.audioCodec,
          container: source.container,
        });
      }
    }
  };

  try {
    const item = await server.getMetadata(itemId);
    if (item) {
      itemType = item.type;
      // Only the selected item's locations belong in the summary. Season
      // folders remain implicit in the episode paths when browsing a show.
      for (const folder of item.folderPaths ?? []) {
        const path = toLocalMediaPath(folder);
        if (path) folders.add(path);
      }
      await visit(item);
    } else complete = false;
  } catch {
    complete = false;
  }
  const values = [...files.values()];
  const knownFiles = values.filter((file) => file.sizeBytes !== undefined);
  return {
    itemType,
    status: complete ? 'complete' : available ? 'partial' : 'unavailable',
    sizeBytes:
      knownFiles.length || complete
        ? knownFiles.reduce((sum, file) => sum + file.sizeBytes!, 0)
        : null,
    files: values,
    folders: [...folders],
  };
}
