import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngineService } from './engine.service';
import { FilterConfigService } from './filter-config.service';
import { HistoricalDataService } from './historical-data.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({
      name: 'telegram-alerts',
    }),
  ],
  providers: [
    FilterConfigService,
    HistoricalDataService,
    EngineService,
  ],
  exports: [FilterConfigService],
})
export class EngineModule {}
