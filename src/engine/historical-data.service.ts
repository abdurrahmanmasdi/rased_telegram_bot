import { Injectable, Inject, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Redis } from 'ioredis';

@Injectable()
export class HistoricalDataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HistoricalDataService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async onApplicationBootstrap() {
    this.logger.log('Bootstrapping Historical Data Service... Fetching baselines.');
    await this.refreshBaselines();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.log('Running daily baseline refresh cron job...');
    await this.refreshBaselines();
  }

  public async refreshBaselines() {
    const rawTickers = process.env.TRACKED_TICKERS || 'BTCUSDT,ETHUSDT,SOLUSDT';
    const tickers = rawTickers.split(',').map(t => t.trim());

    for (const ticker of tickers) {
      try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${ticker}&interval=1d&limit=30`;
        const response = await fetch(url);
        
        if (!response.ok) {
          this.logger.error(`Failed to fetch klines for ${ticker}: ${response.statusText}`);
          continue;
        }

        const klines: any[][] = await response.json();

        if (klines.length < 14) {
          this.logger.warn(`Not enough data to calculate baselines for ${ticker} (Got ${klines.length} days)`);
          continue;
        }

        // Calculate 30-day Average Quote Volume
        const totalQuoteVolume = klines.reduce((sum, k) => sum + parseFloat(k[7]), 0);
        const avgVolume30d = totalQuoteVolume / klines.length;

        // Calculate 14-day ATR (Average True Range)
        // TR = max(High - Low, abs(High - PrevClose), abs(Low - PrevClose))
        const trueRanges: number[] = [];
        
        // Start from index 1 because we need a previous close
        for (let i = 1; i < klines.length; i++) {
          const high = parseFloat(klines[i][2]);
          const low = parseFloat(klines[i][3]);
          const prevClose = parseFloat(klines[i - 1][4]);

          const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
          );
          trueRanges.push(tr);
        }

        // Take the last 14 True Ranges to compute the SMA
        const last14TRs = trueRanges.slice(-14);
        const sumTR = last14TRs.reduce((sum, tr) => sum + tr, 0);
        const atr14d = sumTR / last14TRs.length;

        // Save to Redis
        const baselineKey = `baseline:${ticker}`;
        await this.redisClient.hset(baselineKey, {
          avgVolume30d: avgVolume30d.toString(),
          atr14d: atr14d.toString(),
          updatedAt: new Date().toISOString()
        });

        this.logger.log(`Updated baseline for ${ticker}: AvgVol30d=${avgVolume30d.toFixed(2)}, ATR14d=${atr14d.toFixed(4)}`);
      } catch (error: any) {
        this.logger.error(`Error fetching historical data for ${ticker}: ${error.message}`);
      }
    }
  }
}
