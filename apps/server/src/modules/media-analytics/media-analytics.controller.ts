import {
  mediaAnalyticsSortFields,
  mediaSortOrders,
  MediaAnalyticsSource,
} from '@maintainerr/contracts';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { MediaServerSetupGuard } from '../api/media-server/guards';
import { MediaAnalyticsService } from './media-analytics.service';

export const analyticsBrowseSchema = z
  .object({
    scope: z.enum(['library', 'collection', 'exclusions', 'search']),
    id: z.string().trim().min(1).max(500),
    type: z.enum(['movie', 'show', 'season', 'episode']).optional(),
    sort: z.enum(mediaAnalyticsSortFields),
    sortOrder: z.enum(mediaSortOrders).default('desc'),
    offset: z.coerce.number().int().min(0).max(15000).default(0),
    limit: z.coerce.number().int().min(1).max(15000).default(30),
    snapshotId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.scope === 'collection' || value.scope === 'exclusions') &&
      (!Number.isSafeInteger(Number(value.id)) || Number(value.id) <= 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'A positive collection ID is required.',
      });
    }
  });

export type AnalyticsBrowseRequest = z.infer<typeof analyticsBrowseSchema>;

@Controller('api/media-analytics')
@UseGuards(MediaServerSetupGuard)
export class MediaAnalyticsController {
  constructor(private readonly analytics: MediaAnalyticsService) {}

  @Get('capabilities')
  capabilities() {
    return this.analytics.capabilities();
  }

  @Get('browse')
  browse(
    @Query(new ZodValidationPipe(analyticsBrowseSchema))
    request: AnalyticsBrowseRequest,
  ) {
    return this.analytics.browse(request);
  }

  @Get('items/:id')
  item(
    @Param('id') id: string,
    @Query(
      'source',
      new ZodValidationPipe(z.enum(['tracearr', 'streamystats'])),
    )
    source: MediaAnalyticsSource,
  ) {
    return this.analytics.item(id, source);
  }
}
