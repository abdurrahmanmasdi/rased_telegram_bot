import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngineService } from './engine.service';
import { FilterConfigService } from './filter-config.service';
import { HistoricalDataService } from './historical-data.service';
import { Redis } from 'ioredis';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'telegram-alerts',
    }),
  ],
  providers: [
    FilterConfigService,
    HistoricalDataService,
    EngineService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        });
      },
    },
  ],
  exports: [FilterConfigService],
})
export class EngineModule {}
