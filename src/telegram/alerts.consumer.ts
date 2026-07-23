import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertLog, Exchange } from '../database/entities/alert-log.entity';

import { AlertJobPayload } from '../engine/interfaces/alert-job.interface';

@Processor('telegram-alerts', {
  limiter: {
    max: 1,
    duration: 1000,
  },
})
export class AlertsConsumer extends WorkerHost {
  private readonly logger = new Logger(AlertsConsumer.name);

  constructor(
    @InjectRepository(AlertLog)
    private readonly alertLogRepository: Repository<AlertLog>,
  ) {
    super();
  }

  async process(job: Job<AlertJobPayload>): Promise<void> {
    if (job.name !== 'sendAlert') return;

    this.logger.log(`Processing alert job ${job.id || 'unknown'} for ${job.data.ticker}`);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const threadId = process.env.TELEGRAM_MESSAGE_THREAD_ID;

    if (!token || !chatId) {
      this.logger.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID environment variables.');
      return;
    }

    const payload = job.data;
    
    // Formatting as HTML for cleaner bolding and spacing in Telegram
    let tradeSetupStr = '';
    const dec = payload.entryPrice < 1 ? 4 : (payload.entryPrice < 100 ? 3 : 2);
    
    if (payload.targets && payload.targets.length >= 3 && payload.stopLoss) {
      tradeSetupStr = `
🎯 <b>Trade Setup (Long)</b>
<b>Entry:</b> $${payload.entryPrice.toFixed(dec)}
<b>Stop Loss:</b> $${payload.stopLoss.toFixed(dec)}
<b>Target 1:</b> $${payload.targets[0].toFixed(dec)}
<b>Target 2:</b> $${payload.targets[1].toFixed(dec)}
<b>Target 3:</b> $${payload.targets[2].toFixed(dec)}
`;
    }

    const message = `
🚨 <b>MOMENTUM RADAR ALERT</b> 🚨

<b>Ticker:</b> $${payload.ticker}
<b>Price:</b> $${payload.entryPrice.toFixed(dec)}
<b>VWAP:</b> $${payload.metricsSnapshot.vwap.toFixed(dec)}
<b>24h Change:</b> ${payload.metricsSnapshot.priceChangePercent > 0 ? '+' : ''}${payload.metricsSnapshot.priceChangePercent.toFixed(2)}%
<b>24h Volume:</b> $${(payload.metricsSnapshot.quoteVolume / 1000000).toFixed(2)}M
<b>RVOL:</b> ${payload.metricsSnapshot.rvol ? payload.metricsSnapshot.rvol.toFixed(2) + 'x' : 'N/A'}
<b>ATR (14d):</b> ${payload.metricsSnapshot.atrPercent ? payload.metricsSnapshot.atrPercent.toFixed(2) + '%' : 'N/A'}
${tradeSetupStr}
<i>Reason: ${payload.triggerReason}</i>
    `.trim();

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    };

    if (threadId) {
      body.message_thread_id = threadId;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as Record<string, any>;
        
        // Handle Rate Limiting explicitly
        if (response.status === 429) {
          const retryAfter = errorData.parameters?.retry_after || 5;
          this.logger.warn(`Rate limited by Telegram API. Retry after ${retryAfter}s`);
          throw new Error(`RateLimitExceeded: 429. Retry after ${retryAfter}s`);
        }

        this.logger.error(`Failed to send Telegram message: ${JSON.stringify(errorData)}`);
        throw new Error(`Telegram API Error: ${response.status} ${response.statusText}`);
      }

      this.logger.log(`Successfully sent Telegram alert for ${payload.ticker}`);
      
      try {
        const logEntry = this.alertLogRepository.create({
          ticker: payload.ticker,
          exchange: Exchange.BINANCE,
          triggerReason: payload.triggerReason,
          entryPrice: payload.entryPrice,
          metricsSnapshot: payload.metricsSnapshot,
          targets: [],
          stopLoss: 0,
        });
        await this.alertLogRepository.save(logEntry);
        this.logger.log(`Alert for ${payload.ticker} saved to database.`);
      } catch (dbError: unknown) {
        if (dbError instanceof Error) {
          this.logger.error(`Failed to save alert log to database for ${payload.ticker}: ${dbError.message}`);
        } else {
          this.logger.error(`Failed to save alert log to database for ${payload.ticker}: ${String(dbError)}`);
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(`Error sending message to Telegram: ${error.message}`);
      } else {
        this.logger.error(`Error sending message to Telegram: ${String(error)}`);
      }
      throw error; // Rethrow to let BullMQ handle the failure/retry
    }
  }
}
