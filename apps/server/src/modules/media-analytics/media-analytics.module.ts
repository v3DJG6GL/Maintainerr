import { Module } from '@nestjs/common';
import { MediaServerModule } from '../api/media-server/media-server.module';
import { StreamystatsApiModule } from '../api/streamystats-api/streamystats-api.module';
import { TracearrApiModule } from '../api/tracearr-api/tracearr-api.module';
import { CollectionsModule } from '../collections/collections.module';
import { MediaAnalyticsController } from './media-analytics.controller';
import { MediaAnalyticsService } from './media-analytics.service';

// Browsing composes existing integrations without coupling the native media
// server abstraction or persisted collection ordering to analytics providers.
@Module({
  imports: [
    MediaServerModule,
    StreamystatsApiModule,
    TracearrApiModule,
    CollectionsModule,
  ],
  controllers: [MediaAnalyticsController],
  providers: [MediaAnalyticsService],
})
export class MediaAnalyticsModule {}
