import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { FilterConfigService, GlobalFilters } from './filter-config.service';
import type { Binance24hTickerPayload } from './interfaces/binance-ticker.interface';

@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    @InjectQueue('telegram-alerts') private readonly alertsQueue: Queue,
    private readonly filterConfigService: FilterConfigService,
  ) {}

  @OnEvent('market.ticker', { async: true })
  async handleMarketTicker(payload: Binance24hTickerPayload) {
    try {
      if (!payload || !payload.s) return;

      const ticker = payload.s; // Symbol (e.g. BTCUSDT)
      const isHaram = await this.redisClient.sismember('system:haram_tickers', ticker);
      if (isHaram === 1) return; // ⛔️ Drop Non-Halal Tokens immediately

      const quoteVolume = parseFloat(payload.q); // 24h quote volume
      const priceChangePercent = parseFloat(payload.P); // 24h price change percent
      const lastPrice = parseFloat(payload.c); // Last price
      const vwap = parseFloat(payload.w); // VWAP

      // Fetch tier from Redis (default to MINOR if not found)
      let tier = await this.redisClient.hget('system:asset_tiers', ticker) as 'MAJOR' | 'MINOR' | null;
      if (tier !== 'MAJOR') tier = 'MINOR';

      // Fetch dynamic filters and baselines from Redis
      const filters = await this.filterConfigService.getFilters(tier);
      const rawBaseline = await this.redisClient.hgetall(`baseline:${ticker}`);
      
      let rvol = 0;
      let atrPercent = 0;

      if (rawBaseline.avgVolume30d && rawBaseline.atr14d) {
        const avgVol = parseFloat(rawBaseline.avgVolume30d);
        const atr14d = parseFloat(rawBaseline.atr14d);

        if (avgVol > 0) rvol = quoteVolume / avgVol;
        if (lastPrice > 0) atrPercent = (atr14d / lastPrice) * 100;
      }

      // 🔬 TEMPORARY X-RAY LOG: Watch the math calculate in real-time
      if (ticker === 'SOLUSDT') {
        this.logger.debug(`[X-RAY SOLUSDT] Vol: $${(quoteVolume / 1000000).toFixed(2)}M | Change: ${priceChangePercent}% | RVOL: ${rvol.toFixed(2)}x | ATR: ${atrPercent.toFixed(2)}% | Price: $${lastPrice} | VWAP: $${vwap}`);
      }
      // 1. Evaluate MVP Filter Logic
      const passed = this.evaluateStructuralFilters(quoteVolume, priceChangePercent, rvol, atrPercent, lastPrice, vwap, filters);
      if (!passed) {
        return;
      }

      // Calculate Trade Setup based on ATR
      let stopLoss = 0;
      let targets: number[] = [];
      if (rawBaseline.atr14d) {
        const atr14d = parseFloat(rawBaseline.atr14d);
        if (atr14d > 0) {
          stopLoss = lastPrice - (1.5 * atr14d);
          targets = [
            lastPrice + (1.0 * atr14d),
            lastPrice + (2.0 * atr14d),
            lastPrice + (3.0 * atr14d),
          ];
        }
      }

      // 2. Cooldown Mechanism
      // Atomic set: set key to '1' with an Expiration of cooldownSeconds, Only if Not eXists
      const cooldownKey = `cooldown:${ticker}`;
      const ttl = filters.cooldownSeconds || 900;
      const result = await this.redisClient.set(cooldownKey, '1', 'EX', ttl, 'NX');
      
      if (result !== 'OK') {
        // Key already exists, drop alert (in cooldown)
        return;
      }

      // 3. Dispatch to Queue
      this.logger.log(`[ALERT] Triggered for ${ticker}. Pushing to queue...`);
      await this.alertsQueue.add('sendAlert', {
        ticker,
        exchange: 'binance',
        triggerReason: `Price > VWAP | RVOL ${rvol.toFixed(2)}x > ${filters.minRvol}x | ATR ${atrPercent.toFixed(2)}% > ${filters.minAtrPercent}% | Vol > $${(filters.minQuoteVolume / 1000000).toFixed(1)}M`,
        metricsSnapshot: {
          quoteVolume,
          priceChangePercent,
          lastPrice,
          vwap,
          rvol,
          atrPercent
        },
        entryPrice: lastPrice,
        stopLoss,
        targets,
        timestamp: new Date().toISOString()
      }, {
        removeOnComplete: true,
        removeOnFail: 100, // Keep last 100 failed jobs for debugging
      });

    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(`Error processing market.ticker for ${payload?.s || 'unknown'}: ${error.message}`, error.stack);
      } else {
        this.logger.error(`Unknown error processing market.ticker for ${payload?.s || 'unknown'}: ${String(error)}`);
      }
    }
  }

  /**
   * MVP Filter Logic inside a private method so we can easily expand
   * RVOL and ATR calculations later.
   */
  private evaluateStructuralFilters(quoteVolume: number, priceChangePercent: number, rvol: number, atrPercent: number, lastPrice: number, vwap: number, filters: GlobalFilters): boolean {
    if (
      quoteVolume > filters.minQuoteVolume && 
      Math.abs(priceChangePercent) > filters.minPriceChangePercent &&
      rvol >= filters.minRvol &&
      atrPercent >= filters.minAtrPercent &&
      lastPrice > vwap
    ) {
      return true;
    }
    return false;
  }
}


