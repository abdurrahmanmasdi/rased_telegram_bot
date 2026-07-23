import { Injectable, Inject, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssetConfig } from './entities/asset-config.entity';

@Injectable()
export class AssetConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssetConfigService.name);

  constructor(
    @InjectRepository(AssetConfig)
    private readonly assetConfigRepository: Repository<AssetConfig>,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onApplicationBootstrap() {
    await this.syncToRedis();
  }

  async syncToRedis() {
    this.logger.log('Syncing AssetConfigs from PostgreSQL to Redis...');
    const assets = await this.assetConfigRepository.find();
    
    const trackedKey = 'system:tracked_tickers';
    const haramKey = 'system:haram_tickers';
    const tierKey = 'system:asset_tiers';
    
    const multi = this.redisClient.multi();
    multi.del(trackedKey);
    multi.del(haramKey);
    multi.del(tierKey);
    
    if (assets.length === 0) {
      this.logger.warn('No AssetConfigs found in PostgreSQL. Redis lists will be empty.');
    } else {
      for (const asset of assets) {
        if (asset.isTracked) {
          multi.sadd(trackedKey, asset.ticker);
        }
        if (!asset.isHalal) {
          multi.sadd(haramKey, asset.ticker);
        }
        multi.hset(tierKey, asset.ticker, asset.tier);
      }
    }
    
    await multi.exec();
    this.logger.log(`AssetConfigs synced to Redis successfully. Tracked: ${assets.filter(a => a.isTracked).length}, Haram: ${assets.filter(a => !a.isHalal).length}`);
  }

  // Helper method to add or update an asset and sync to Redis
  async updateAsset(ticker: string, updates: Partial<Omit<AssetConfig, 'id' | 'ticker'>>) {
    let asset = await this.assetConfigRepository.findOne({ where: { ticker } });
    if (!asset) {
      asset = this.assetConfigRepository.create({ ticker, ...updates });
    } else {
      Object.assign(asset, updates);
    }
    await this.assetConfigRepository.save(asset);
    
    this.logger.log(`Asset ${ticker} updated in PostgreSQL. Triggering Redis sync...`);
    await this.syncToRedis();
    
    // Notify the system that asset configurations have changed
    this.eventEmitter.emit('asset.config.updated');
    
    return asset;
  }
}
