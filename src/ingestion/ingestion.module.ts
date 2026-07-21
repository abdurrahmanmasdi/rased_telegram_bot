import { Module } from '@nestjs/common';
import { IngestionWebSocketService } from './ingestion.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [IngestionWebSocketService],
})
export class IngestionModule {}
