import { Injectable, Inject, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Redis } from 'ioredis';
import { AssetConfig } from './entities/asset-config.entity';

@Injectable()
export class AssetConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AssetConfigService.name);

  constructor(
    @InjectRepository(AssetConfig)
    private readonly assetConfigRepository: Repository<AssetConfig>,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  async onApplicationBootstrap() {
    let count = await this.assetConfigRepository.count();
    
    if (count === 0) {
      this.logger.log('Seeding default AssetConfigs...');
      const defaultAssets = [
        { ticker: 'BTCUSDT', isTracked: true, isHalal: true },
        { ticker: 'ETHUSDT', isTracked: true, isHalal: true },
        { ticker: 'SOLUSDT', isTracked: true, isHalal: true },
        { ticker: 'AAVEUSDT', isTracked: true, isHalal: false },
        { ticker: 'MKRUSDT', isTracked: true, isHalal: false },
        { ticker: 'COMPUSDT', isTracked: true, isHalal: false },
        { ticker: 'LDOUSDT', isTracked: true, isHalal: false },
        { ticker: 'GMXUSDT', isTracked: true, isHalal: false },
        { ticker: 'RLBUSDT', isTracked: true, isHalal: false },
      ];
      await this.assetConfigRepository.save(defaultAssets);
    }
    
    await this.syncToRedis();
  }

  async syncToRedis() {
    this.logger.log('Syncing AssetConfigs to Redis...');
    const assets = await this.assetConfigRepository.find();
    
    const trackedKey = 'system:tracked_tickers';
    const haramKey = 'system:haram_tickers';
    
    const multi = this.redisClient.multi();
    multi.del(trackedKey);
    multi.del(haramKey);
    
    for (const asset of assets) {
      if (asset.isTracked) {
        multi.sadd(trackedKey, asset.ticker);
      }
      if (!asset.isHalal) {
        multi.sadd(haramKey, asset.ticker);
      }
    }
    
    await multi.exec();
    this.logger.log('AssetConfigs synced to Redis successfully.');
  }
}
