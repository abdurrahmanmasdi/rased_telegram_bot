import { Injectable, Inject, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { FilterConfig } from '../database/entities/filter-config.entity';

export interface GlobalFilters {
  minQuoteVolume: number;
  minPriceChangePercent: number;
  minRvol: number;
  minAtrPercent: number;
  cooldownSeconds?: number;
}

@Injectable()
export class FilterConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FilterConfigService.name);

  constructor(
    @InjectRepository(FilterConfig)
    private readonly filterConfigRepository: Repository<FilterConfig>,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  async onApplicationBootstrap() {
    await this.syncToRedis();
  }

  async syncToRedis() {
    this.logger.log('Syncing FilterConfigs from PostgreSQL to Redis...');
    const configs = await this.filterConfigRepository.find();
    
    if (configs.length === 0) {
      this.logger.warn('No FilterConfigs found in PostgreSQL. Ensure the database is seeded.');
      return;
    }

    for (const config of configs) {
      const configKey = `config:filters:${config.tier}`;
      await this.redisClient.hset(configKey, {
        minQuoteVolume: config.minQuoteVolume.toString(),
        minPriceChangePercent: config.minPriceChangePercent.toString(),
        minRvol: config.minRvol.toString(),
        minAtrPercent: config.minAtrPercent.toString(),
        cooldownSeconds: (config.cooldownSeconds ?? 900).toString(),
      });
    }
    this.logger.log('FilterConfigs synced to Redis successfully.');
  }

  async getFilters(tier: 'MAJOR' | 'MINOR'): Promise<GlobalFilters> {
    const configKey = `config:filters:${tier}`;
    const rawConfig = await this.redisClient.hgetall(configKey);
    
    if (Object.keys(rawConfig).length === 0) {
      // Fallback to postgres if Redis is empty
      const dbConfig = await this.filterConfigRepository.findOne({ where: { tier } });
      if (dbConfig) {
        return {
          minQuoteVolume: dbConfig.minQuoteVolume,
          minPriceChangePercent: dbConfig.minPriceChangePercent,
          minRvol: dbConfig.minRvol,
          minAtrPercent: dbConfig.minAtrPercent,
          cooldownSeconds: dbConfig.cooldownSeconds,
        };
      }
    }
    
    // Provide sensible defaults if not fully seeded
    const defaults = tier === 'MAJOR' 
      ? { vol: 25000000, price: 1.5, rvol: 1.5, atr: 2.0, cooldown: 900 }
      : { vol: 5000000, price: 3.0, rvol: 2.0, atr: 2.5, cooldown: 900 };
      
    return {
      minQuoteVolume: parseFloat(rawConfig.minQuoteVolume) || defaults.vol,
      minPriceChangePercent: parseFloat(rawConfig.minPriceChangePercent) || defaults.price,
      minRvol: parseFloat(rawConfig.minRvol) || defaults.rvol,
      minAtrPercent: parseFloat(rawConfig.minAtrPercent) || defaults.atr,
      cooldownSeconds: parseInt(rawConfig.cooldownSeconds, 10) || defaults.cooldown,
    };
  }

  async updateFilters(tier: 'MAJOR' | 'MINOR', newFilters: Partial<GlobalFilters>): Promise<void> {
    // 1. Update in Postgres FIRST
    let config = await this.filterConfigRepository.findOne({ where: { tier } });
    if (!config) {
      config = this.filterConfigRepository.create({ tier });
    }
    
    if (newFilters.minQuoteVolume !== undefined) config.minQuoteVolume = newFilters.minQuoteVolume;
    if (newFilters.minPriceChangePercent !== undefined) config.minPriceChangePercent = newFilters.minPriceChangePercent;
    if (newFilters.minRvol !== undefined) config.minRvol = newFilters.minRvol;
    if (newFilters.minAtrPercent !== undefined) config.minAtrPercent = newFilters.minAtrPercent;
    if (newFilters.cooldownSeconds !== undefined) config.cooldownSeconds = newFilters.cooldownSeconds;

    await this.filterConfigRepository.save(config);

    // 2. Sync immediately to Redis
    const configKey = `config:filters:${tier}`;
    const updates: Record<string, string> = {};
    if (newFilters.minQuoteVolume !== undefined) updates.minQuoteVolume = newFilters.minQuoteVolume.toString();
    if (newFilters.minPriceChangePercent !== undefined) updates.minPriceChangePercent = newFilters.minPriceChangePercent.toString();
    if (newFilters.minRvol !== undefined) updates.minRvol = newFilters.minRvol.toString();
    if (newFilters.minAtrPercent !== undefined) updates.minAtrPercent = newFilters.minAtrPercent.toString();
    if (newFilters.cooldownSeconds !== undefined) updates.cooldownSeconds = newFilters.cooldownSeconds.toString();
    
    if (Object.keys(updates).length > 0) {
      await this.redisClient.hset(configKey, updates);
      this.logger.log(`Global filters updated in DB and Redis for tier ${tier}: ${JSON.stringify(newFilters)}`);
    }
  }
}
