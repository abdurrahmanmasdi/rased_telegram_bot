import { Injectable, Inject, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { WebSocket, RawData } from 'ws';
import { Redis } from 'ioredis';
import { Binance24hTickerPayload } from '../engine/interfaces/binance-ticker.interface';

@Injectable()
export class IngestionWebSocketService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IngestionWebSocketService.name);
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private retries = 0;
  
  private readonly baseDelay = 1000;
  private readonly maxDelay = 30000; // 30 seconds max
  
  constructor(
    private eventEmitter: EventEmitter2,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  onApplicationBootstrap() {
    this.connect();
  }

  onApplicationShutdown() {
    this.cleanup();
  }

  @OnEvent('asset.config.updated')
  handleAssetConfigUpdated() {
    this.logger.log('Asset configuration updated. Reconnecting WS to apply new subscriptions...');
    this.retries = 0; // Reset retries so it reconnects immediately
    this.cleanup();
    this.connect();
  }

  private connect() {
    this.cleanup();
    
    // Connect to the base stream instead of packing URL with streams
    const url = `wss://stream.binance.com:9443/ws`;
    this.logger.log(`Connecting to Binance WS: ${url}`);
    
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', async () => {
      this.logger.log('Connected to Binance WS stream.');
      this.retries = 0; // reset retries on successful connection
      this.setupHeartbeat();
      
      // 1. Read tracked tickers from Redis
      const rawTickers = await this.redisClient.smembers('system:tracked_tickers');
      const tickers = rawTickers.map(t => `${t.trim().toLowerCase()}@ticker`);
      
      if (tickers.length === 0) {
        this.logger.warn('No tickers configured to track.');
        return;
      }

      this.logger.log(`Subscribing to ${tickers.length} tickers...`);
      
      // 2. Chunk into 50 parameters per frame
      const chunkSize = 50;
      for (let i = 0; i < tickers.length; i += chunkSize) {
        const chunk = tickers.slice(i, i + chunkSize);
        const subscribeMsg = {
          method: "SUBSCRIBE",
          params: chunk,
          id: Date.now() + i
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(subscribeMsg));
        }
      }
    });

    ws.on('message', (data: RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        // Handle both wrapped streams (if combined) and raw payloads (base /ws)
        if (payload && payload.data && payload.data.e === '24hrTicker') {
          this.eventEmitter.emit('market.ticker', payload.data);
        } else if (payload && payload.e === '24hrTicker') {
          this.eventEmitter.emit('market.ticker', payload);
        }
      } catch (err: unknown) {
        // ignore parse errors to keep the stream unblocked
      }
    });

    ws.on('ping', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.pong();
      }
    });
    
    ws.on('pong', () => {
      this.heartbeat();
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
      this.logger.warn('WebSocket connection closed. Attempting to reconnect...');
      this.scheduleReconnect();
    });
  }

  private setupHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    
    // Ping the server every 30 seconds to verify the connection is still alive
    this.pingInterval = setInterval(() => {
      const activeWs = this.ws;
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.ping();
        
        // If we don't get a pong back in 5 seconds, assume disconnected
        this.pongTimeout = setTimeout(() => {
          this.logger.error('Pong timeout. Terminating connection.');
          activeWs.terminate();
        }, 5000);
      }
    }, 30000);
  }

  private heartbeat() {
    // We received a pong back!
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private scheduleReconnect() {
    this.cleanup();
    
    // Exponential backoff strategy
    const delay = Math.min(this.maxDelay, this.baseDelay * Math.pow(2, this.retries));
    this.retries++;
    
    this.logger.log(`Reconnecting in ${delay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private cleanup() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.pongTimeout) clearTimeout(this.pongTimeout);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    
    const activeWs = this.ws;
    if (activeWs) {
      activeWs.removeAllListeners();
      if (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING) {
        activeWs.terminate();
      }
      this.ws = null;
    }
  }
}
