import {
  getMediaAnalyticsSortSource,
  MaintainerrEvent,
  MediaAnalyticsPage,
  MediaAnalyticsSource,
  MediaItem,
  MediaItemType,
  MediaPlaybackSummary,
  MediaServerType,
} from '@maintainerr/contracts';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { MediaItemEnrichmentService } from '../api/media-server/media-item-enrichment.service';
import { MediaServerFactory } from '../api/media-server/media-server.factory';
import type { IMediaServerService } from '../api/media-server/media-server.interface';
import { StreamystatsApiService } from '../api/streamystats-api/streamystats-api.service';
import { TracearrApiService } from '../api/tracearr-api/tracearr-api.service';
import type { TracearrHistoryIndex } from '../api/tracearr-api/tracearr-api.service';
import { summarizeTracearrPlayback } from '../api/tracearr-api/tracearr-playback-summary';
import { CollectionsService } from '../collections/collections.service';
import { MaintainerrLogger } from '../logging/logs.service';
import type { AnalyticsBrowseRequest } from './media-analytics.controller';

const MAX_ITEMS = 15000;
const MAX_SNAPSHOTS = 4;
const FRESH_MS = 5 * 60_000;
const RETAIN_MS = 30 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
const RETRY_MS = 30_000;
const BATCH_SIZE = 250;
const STAT_CONCURRENCY = 4;

interface BrowseRow {
  mediaData?: MediaItem;
}
export type BrowseValue = MediaItem | BrowseRow;
interface BrowseEntry {
  media: MediaItem;
  value: BrowseValue;
}
interface Snapshot {
  id: string;
  key: string;
  generation: number;
  source: MediaAnalyticsSource;
  client: object;
  createdAt: number;
  finishedAt?: number;
  total: number | null;
  completed: number;
  entries?: BrowseEntry[];
  error?: string;
}

const unknownSummary = (
  source: MediaAnalyticsSource,
): MediaPlaybackSummary => ({
  source,
  playCount: null,
  totalWatchTimeMs: null,
  lastPlayedAt: null,
});

@Injectable()
export class MediaAnalyticsService implements OnModuleDestroy {
  private readonly snapshots = new Map<string, Snapshot>();
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private readonly summaries = new Map<
    string,
    { client: object; summary: MediaPlaybackSummary; expiresAt: number }
  >();

  constructor(
    private readonly factory: MediaServerFactory,
    private readonly tracearr: TracearrApiService,
    private readonly streamystats: StreamystatsApiService,
    private readonly collections: CollectionsService,
    private readonly enrichment: MediaItemEnrichmentService,
    private readonly logger: MaintainerrLogger,
  ) {
    logger.setContext(MediaAnalyticsService.name);
  }

  @OnEvent(MaintainerrEvent.Settings_Updated)
  invalidate(): void {
    this.generation += 1;
    this.snapshots.clear();
    this.summaries.clear();
  }

  onModuleDestroy(): void {
    this.invalidate();
  }

  async capabilities(): Promise<{ sources: MediaAnalyticsSource[] }> {
    const sources: MediaAnalyticsSource[] = [];
    if (this.tracearr.api) sources.push('tracearr');
    if (
      this.streamystats.api &&
      (await this.factory.getConfiguredServerType()) ===
        MediaServerType.JELLYFIN
    ) {
      sources.push('streamystats');
    }
    return { sources };
  }

  private async assertSource(source: MediaAnalyticsSource): Promise<object> {
    if (!(await this.capabilities()).sources.includes(source)) {
      throw new ServiceUnavailableException(
        'The selected analytics source is not configured for this media server.',
      );
    }
    return source === 'tracearr' ? this.tracearr.api : this.streamystats.api;
  }

  async item(
    id: string,
    source: MediaAnalyticsSource,
  ): Promise<MediaPlaybackSummary> {
    const client = await this.assertSource(source);
    const generation = this.generation;
    const mediaServer = await this.factory.getService();
    const item = await mediaServer.getMetadata(id);
    if (!item) {
      let exists: boolean;
      try {
        exists = await mediaServer.itemExists(id);
      } catch {
        throw new ServiceUnavailableException(
          'Media item presence could not be checked.',
        );
      }
      if (exists)
        throw new ServiceUnavailableException(
          'Media item metadata is unavailable.',
        );
      throw new NotFoundException('Media item no longer exists.');
    }
    if (source === 'tracearr') {
      await this.tracearr.prefetchHistory();
      if (!this.tracearr.getHistoryIndex())
        throw new ServiceUnavailableException(
          'Tracearr history is unavailable.',
        );
    }
    const summary = await this.summary(item, source);
    if (
      generation !== this.generation ||
      client !== (await this.assertSource(source))
    ) {
      throw new ServiceUnavailableException(
        'Analytics settings changed. Please retry.',
      );
    }
    return summary;
  }

  async browse(
    request: AnalyticsBrowseRequest,
  ): Promise<MediaAnalyticsPage<BrowseValue>> {
    const source = getMediaAnalyticsSortSource(request.sort);
    const client = await this.assertSource(source);
    // Also rejects browsing during a media server switch.
    await this.factory.getService();
    const key = JSON.stringify([
      source,
      request.scope,
      request.id,
      request.type,
    ]);
    const now = Date.now();
    this.prune(now);
    let snapshot: Snapshot | undefined;
    if (request.snapshotId) {
      snapshot = this.snapshots.get(request.snapshotId);
      if (!snapshot || snapshot.key !== key || snapshot.client !== client) {
        throw new ConflictException(
          'Analytics snapshot expired. Restart this sort to refresh the list.',
        );
      }
    } else {
      if (request.offset > 0)
        throw new ConflictException(
          'Pagination requires the original analytics snapshot.',
        );
      snapshot = [...this.snapshots.values()]
        .reverse()
        .find(
          (entry) =>
            entry.key === key &&
            entry.client === client &&
            (entry.finishedAt === undefined ||
              ((entry.error ||
                request.scope === 'library' ||
                request.scope === 'search') &&
                now - entry.finishedAt < (entry.error ? RETRY_MS : FRESH_MS))),
        );
    }
    if (!snapshot) {
      if (this.snapshots.size >= MAX_SNAPSHOTS) {
        const oldest = [...this.snapshots.values()]
          .filter((entry) => entry.finishedAt !== undefined)
          .sort((a, b) => a.finishedAt! - b.finishedAt!)[0];
        // An evicted page receives 409 and must restart, never a different
        // ranking under the same snapshot ID. Active jobs are not evicted.
        if (oldest) this.snapshots.delete(oldest.id);
        else
          throw new ServiceUnavailableException(
            'Analytics preparation capacity reached. Please retry when a pending preparation finishes.',
          );
      }
      snapshot = {
        id: randomUUID(),
        key,
        generation: this.generation,
        source,
        client,
        createdAt: now,
        total: null,
        completed: 0,
      };
      this.snapshots.set(snapshot.id, snapshot);
      const job = snapshot;
      // One acquisition job at a time. Streamystats lacks a bulk endpoint;
      // bounded workers avoid multiplying per-item requests across browsers.
      this.queue = this.queue
        .then(() => this.build(job, request))
        .catch((error: unknown) => {
          this.logger.warn('Analytics preparation failed.');
          this.logger.debug(error);
        });
    }
    if (snapshot.error) throw new ServiceUnavailableException(snapshot.error);
    if (!snapshot.entries)
      return {
        status: 'preparing',
        snapshotId: snapshot.id,
        completed: snapshot.completed,
        total: snapshot.total,
      };
    const watchTime = request.sort.endsWith('WatchTime');
    const direction = request.sortOrder === 'asc' ? 1 : -1;
    const entries = [...snapshot.entries].sort((a, b) => {
      const left = watchTime
        ? a.media.playbackSummary?.totalWatchTimeMs
        : a.media.playbackSummary?.playCount;
      const right = watchTime
        ? b.media.playbackSummary?.totalWatchTimeMs
        : b.media.playbackSummary?.playCount;
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;
      return (
        (left != null && right != null ? (left - right) * direction : 0) ||
        (
          a.media.grandparentTitle ??
          a.media.parentTitle ??
          a.media.title
        ).localeCompare(
          b.media.grandparentTitle ?? b.media.parentTitle ?? b.media.title,
        ) ||
        a.media.title.localeCompare(b.media.title) ||
        a.media.id.localeCompare(b.media.id)
      );
    });
    // Membership/exclusion flags can change while the analytics snapshot is
    // pinned. Refresh only those flags, keeping the ranking itself stable.
    const page = entries.slice(request.offset, request.offset + request.limit);
    const enriched = await this.enrichment.enrichItems(
      page.map((entry) => entry.media),
    );
    if (
      snapshot.generation !== this.generation ||
      snapshot.client !== (await this.assertSource(source)) ||
      !this.snapshots.has(snapshot.id)
    ) {
      throw new ConflictException(
        'Analytics snapshot changed. Restart this sort.',
      );
    }
    return {
      status: 'ready',
      snapshotId: snapshot.id,
      updatedAt: new Date(snapshot.finishedAt!).toISOString(),
      totalSize: entries.length,
      items: page.map((entry, index) =>
        entry.value === entry.media
          ? enriched[index]
          : { ...entry.value, mediaData: enriched[index] },
      ),
    };
  }

  private prune(now: number): void {
    for (const [id, snapshot] of this.snapshots) {
      if (
        snapshot.finishedAt === undefined &&
        now - snapshot.createdAt > BUILD_TIMEOUT_MS
      ) {
        snapshot.error =
          'Analytics preparation expired. Restart this sort to retry.';
        snapshot.finishedAt = now;
      }
      if (
        snapshot.finishedAt !== undefined &&
        now - snapshot.finishedAt > RETAIN_MS
      )
        this.snapshots.delete(id);
    }
  }

  private checkCurrent(snapshot: Snapshot): void {
    const client =
      snapshot.source === 'tracearr'
        ? this.tracearr.api
        : this.streamystats.api;
    if (
      snapshot.error ||
      snapshot.generation !== this.generation ||
      snapshot.client !== client ||
      Date.now() - snapshot.createdAt > BUILD_TIMEOUT_MS
    ) {
      throw new Error(
        'Analytics preparation was interrupted or expired. Restart this sort.',
      );
    }
  }

  private async build(
    snapshot: Snapshot,
    request: AnalyticsBrowseRequest,
  ): Promise<void> {
    try {
      this.checkCurrent(snapshot);
      const entries = await this.loadEntries(request, () =>
        this.checkCurrent(snapshot),
      );
      this.checkCurrent(snapshot);
      snapshot.total = entries.length;
      let history: TracearrHistoryIndex | undefined;
      if (snapshot.source === 'tracearr') {
        await this.tracearr.prefetchHistory();
        history = this.tracearr.getHistoryIndex();
        if (!history)
          throw new Error('Tracearr history is unavailable or incomplete.');
      }
      for (
        let offset = 0;
        offset < entries.length;
        offset += STAT_CONCURRENCY
      ) {
        this.checkCurrent(snapshot);
        await Promise.all(
          entries
            .slice(offset, offset + STAT_CONCURRENCY)
            .map(async (entry) => {
              const summary = history
                ? (summarizeTracearrPlayback(history, entry.media) ??
                  unknownSummary('tracearr'))
                : await this.summary(entry.media, snapshot.source, false);
              const media = { ...entry.media, playbackSummary: summary };
              if (entry.value === entry.media) entry.value = media;
              entry.media = media;
              snapshot.completed += 1;
            }),
        );
      }
      this.checkCurrent(snapshot);
      snapshot.entries = entries;
    } catch (error) {
      // No partial ranking and no provider fallback on an outage.
      snapshot.error =
        'Analytics preparation failed or the source is unavailable. Restart this sort to retry.';
      this.logger.warn('Could not prepare complete analytics ranking.');
      this.logger.debug(error);
    } finally {
      snapshot.finishedAt = Date.now();
    }
  }

  private async summary(
    item: MediaItem,
    source: MediaAnalyticsSource,
    cacheDetails = true,
  ): Promise<MediaPlaybackSummary> {
    if (source === 'tracearr')
      return this.tracearr.getPlaybackSummary(item) ?? unknownSummary(source);
    // Streamystats aggregates shows, movies and episodes. A season has no
    // sessions of its own; do not present its empty upstream result as zero.
    if (!['movie', 'show', 'episode'].includes(item.type))
      return unknownSummary(source);
    const cached = this.summaries.get(item.id);
    if (
      cached?.client === this.streamystats.api &&
      cached.expiresAt > Date.now()
    )
      return cached.summary;
    const client = this.streamystats.api;
    const generation = this.generation;
    const result = await this.streamystats.getItemDetailsResult(item.id, {
      cacheResult: cacheDetails,
    });
    if (result.status === 'unavailable')
      throw new ServiceUnavailableException('Streamystats is unavailable.');
    if (result.status === 'missing') return unknownSummary(source);
    if (result.data.item.id !== item.id)
      throw new ServiceUnavailableException(
        'Streamystats returned a different media item.',
      );
    const milliseconds = result.data.totalWatchTime * 1000;
    const summary: MediaPlaybackSummary = {
      source,
      playCount: result.data.totalViews,
      totalWatchTimeMs: Number.isFinite(milliseconds) ? milliseconds : null,
      lastPlayedAt: result.data.lastWatched,
    };
    if (this.streamystats.api === client && this.generation === generation) {
      if (this.summaries.size >= MAX_ITEMS)
        this.summaries.delete(this.summaries.keys().next().value!);
      this.summaries.set(item.id, {
        client,
        summary,
        expiresAt: Date.now() + FRESH_MS,
      });
    }
    return summary;
  }

  private async loadEntries(
    request: AnalyticsBrowseRequest,
    checkCurrent: () => void,
  ): Promise<BrowseEntry[]> {
    const server = await this.factory.getService();
    if (!(await server.getStatus()))
      throw new Error('Media server is unavailable.');
    if (request.scope === 'collection' || request.scope === 'exclusions') {
      // The default path paginates in SQL and retains the original row count,
      // so missing metadata cannot disguise a partial collection as complete.
      const options = { size: MAX_ITEMS + 1 };
      const result =
        request.scope === 'collection'
          ? await this.collections.getCollectionMediaWithServerDataAndPaging(
              Number(request.id),
              options,
            )
          : await this.collections.getCollectionExclusionsWithServerDataAndPaging(
              Number(request.id),
              options,
            );
      if (
        !result ||
        result.totalSize > MAX_ITEMS ||
        result.items.length !== result.totalSize
      ) {
        throw new Error(
          'Collection could not be loaded completely within the analytics limit.',
        );
      }
      return result.items.flatMap((value) =>
        value.mediaData ? [{ value, media: value.mediaData }] : [],
      );
    }
    if (request.scope === 'search') {
      // Native quick search caps its results. Walk server-filtered library
      // pages instead so a highly played item after that cap can still rank.
      const libraries = await server.getLibraries();
      if (!libraries.length)
        throw new Error('Libraries are unavailable for analytics search.');
      const entries = new Map<string, BrowseEntry>();
      for (const library of libraries) {
        const types: MediaItemType[] =
          library.type === 'movie'
            ? ['movie']
            : library.type === 'show'
              ? ['show', 'episode']
              : [];
        for (const type of types) {
          for (const entry of await this.loadLibrary(
            server,
            library.id,
            type,
            request.id,
            checkCurrent,
          ))
            entries.set(entry.media.id, entry);
          if (entries.size > MAX_ITEMS)
            throw new Error('Search exceeds the analytics item limit.');
        }
      }
      return [...entries.values()];
    }
    return this.loadLibrary(
      server,
      request.id,
      request.type,
      undefined,
      checkCurrent,
    );
  }

  private async loadLibrary(
    server: IMediaServerService,
    libraryId: string,
    type?: MediaItemType,
    searchQuery?: string,
    checkCurrent?: () => void,
  ): Promise<BrowseEntry[]> {
    const items = new Map<string, MediaItem>();
    let total: number | undefined;
    let offset = 0;
    do {
      checkCurrent?.();
      const page = await server.getLibraryContents(libraryId, {
        offset,
        limit: BATCH_SIZE,
        type,
        searchQuery,
        sort: 'title',
        sortOrder: 'asc',
      });
      if (
        page.totalSize > MAX_ITEMS ||
        (total !== undefined && total !== page.totalSize)
      ) {
        throw new Error(
          'Library changed during preparation or exceeds the analytics item limit.',
        );
      }
      total = page.totalSize;
      for (const media of page.items) items.set(media.id, media);
      // Repeated/empty pages are not permission to publish a partial ranking.
      if (offset < total && page.items.length === 0)
        throw new Error('Library page is incomplete.');
      offset += page.items.length;
    } while (offset < total);
    if (items.size !== total)
      throw new Error('Library could not be loaded completely.');
    return [...items.values()].map((media) => ({ media, value: media }));
  }
}
