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
    const rawTickers = await this.redisClient.smembers('system:tracked_tickers');
    const tickers = rawTickers.map(t => t.trim());
    
    if (tickers.length === 0) {
      this.logger.warn('No tickers found in Redis (system:tracked_tickers) to calculate baselines.');
      return;
    }

    for (const ticker of tickers) {
      try {
        let response: Response | null = null;
        let fetchSuccess = false;
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${ticker}&interval=1d&limit=30`;
            response = await fetch(url);
            
            if (response.status === 400) {
              this.logger.warn(`Ticker ${ticker} is not a valid pair on Binance. Skipping baseline update.`);
              break; // Stop retrying immediately for 400
            }

            if (!response.ok) {
              if (response.status >= 500) {
                this.logger.warn(`Server error ${response.status} fetching klines for ${ticker}. Attempt ${attempt}/${maxRetries}.`);
                if (attempt < maxRetries) {
                  await new Promise(res => setTimeout(res, 1000));
                  continue;
                }
              }
              this.logger.error(`Failed to fetch klines for ${ticker}: ${response.statusText}`);
              break; // Don't retry 4xx other than 400 (e.g. 403, 404, 429 might need specific handling, but general failure here)
            }

            fetchSuccess = true;
            break; // Success, exit retry loop
          } catch (error: unknown) {
            this.logger.warn(`Network error fetching klines for ${ticker}: ${error instanceof Error ? error.message : String(error)}. Attempt ${attempt}/${maxRetries}.`);
            if (attempt < maxRetries) {
               await new Promise(res => setTimeout(res, 1000));
            }
          }
        }

        if (!fetchSuccess || !response) {
          continue; // Safely skip this ticker
        }

        const klines = await response.json() as (string | number)[][];

        if (klines.length < 14) {
          this.logger.warn(`Not enough data to calculate baselines for ${ticker} (Got ${klines.length} days)`);
          continue;
        }

        // Calculate 30-day Average Quote Volume
        const totalQuoteVolume = klines.reduce((sum, k) => sum + parseFloat(k[7] as string), 0);
        const avgVolume30d = totalQuoteVolume / klines.length;

        // Calculate 14-day ATR (Average True Range)
        // TR = max(High - Low, abs(High - PrevClose), abs(Low - PrevClose))
        const trueRanges: number[] = [];
        
        // Start from index 1 because we need a previous close
        for (let i = 1; i < klines.length; i++) {
          const high = parseFloat(klines[i][2] as string);
          const low = parseFloat(klines[i][3] as string);
          const prevClose = parseFloat(klines[i - 1][4] as string);

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
      } catch (error: unknown) {
        if (error instanceof Error) {
          this.logger.error(`Error fetching historical data for ${ticker}: ${error.message}`);
        } else {
          this.logger.error(`Unknown error fetching historical data for ${ticker}: ${String(error)}`);
        }
      }
    }
  }
}
