import { Injectable, Inject, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

export interface GlobalFilters {
  minQuoteVolume: number;
  minPriceChangePercent: number;
  minRvol: number;
  minAtrPercent: number;
}

@Injectable()
export class FilterConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FilterConfigService.name);
  private readonly configKey = 'config:global_filters';

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async onApplicationBootstrap() {
    const exists = await this.redisClient.exists(this.configKey);
    
    if (!exists) {
      this.logger.log('Seeding default global filters to Redis...');
      await this.redisClient.hset(this.configKey, {
        minQuoteVolume: '10000000',
        minPriceChangePercent: '3.0',
        minRvol: '2.0',
        minAtrPercent: '5.0'
      });
    }
  }

  async getFilters(): Promise<GlobalFilters> {
    const rawConfig = await this.redisClient.hgetall(this.configKey);
    
    return {
      minQuoteVolume: parseFloat(rawConfig.minQuoteVolume) || 10000000,
      minPriceChangePercent: parseFloat(rawConfig.minPriceChangePercent) || 3.0,
      minRvol: parseFloat(rawConfig.minRvol) || 2.0,
      minAtrPercent: parseFloat(rawConfig.minAtrPercent) || 5.0,
    };
  }

  async updateFilters(newFilters: Partial<GlobalFilters>): Promise<void> {
    const updates: Record<string, string> = {};
    if (newFilters.minQuoteVolume !== undefined) updates.minQuoteVolume = newFilters.minQuoteVolume.toString();
    if (newFilters.minPriceChangePercent !== undefined) updates.minPriceChangePercent = newFilters.minPriceChangePercent.toString();
    if (newFilters.minRvol !== undefined) updates.minRvol = newFilters.minRvol.toString();
    if (newFilters.minAtrPercent !== undefined) updates.minAtrPercent = newFilters.minAtrPercent.toString();
    
    if (Object.keys(updates).length > 0) {
      await this.redisClient.hset(this.configKey, updates);
      this.logger.log(`Global filters updated: ${JSON.stringify(newFilters)}`);
    }
  }
}

