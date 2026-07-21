import { Module } from '@nestjs/common';
import { IngestionWebSocketService } from './ingestion.service';

@Module({
  providers: [IngestionWebSocketService],
})
export class IngestionModule {}
