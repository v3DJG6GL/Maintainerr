import { MediaServerType } from '@maintainerr/contracts';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Mocked, TestBed } from '@suites/unit';
import { SettingsDataService } from '../../settings/settings-data.service';
import { StreamystatsApiController } from './streamystats-api.controller';
import { StreamystatsApiService } from './streamystats-api.service';

// The same missing getter value used to turn provider failures into HTTP 404.
describe('StreamystatsApiController item status', () => {
  let controller: StreamystatsApiController;
  let api: Mocked<StreamystatsApiService>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      StreamystatsApiController,
    ).compile();
    controller = unit;
    api = unitRef.get(StreamystatsApiService);
    Object.assign(api, { api: {} });
    Object.assign(unitRef.get(SettingsDataService), {
      media_server_type: MediaServerType.JELLYFIN,
    });
  });

  it('reports unavailable statistics as a service error', async () => {
    api.getItemDetailsResult.mockResolvedValue({ status: 'unavailable' });
    await expect(controller.getItemDetails('item')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('uses not-found only for a confirmed missing response', async () => {
    api.getItemDetailsResult.mockResolvedValue({ status: 'missing' });
    await expect(controller.getItemDetails('item')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns successful zero history without treating it as missing', async () => {
    const data = {
      item: { id: 'item' },
      totalViews: 0,
      totalWatchTime: 0,
      completionRate: 0,
      firstWatched: null,
      lastWatched: null,
      usersWatched: [],
      watchHistory: [],
      watchCountByMonth: [],
    };
    api.getItemDetailsResult.mockResolvedValue({ status: 'ready', data });
    await expect(controller.getItemDetails('item')).resolves.toEqual(data);
  });
});
