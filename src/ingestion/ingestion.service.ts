import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebSocket, RawData } from 'ws';

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
  
  constructor(private eventEmitter: EventEmitter2) {}

  onApplicationBootstrap() {
    this.connect();
  }

  onApplicationShutdown() {
    this.cleanup();
  }

  private connect() {
    this.cleanup();
    
    // 1. Read tracked tickers from env or fallback to defaults
    const rawTickers = process.env.TRACKED_TICKERS || 'BTCUSDT,ETHUSDT,SOLUSDT';
    const tickers = rawTickers.split(',').map(t => t.trim().toLowerCase());
    
    if (tickers.length === 0) {
      this.logger.warn('No tickers configured to track.');
      return;
    }

    // 2. Generate combined stream URL
    const streams = tickers.map(t => `${t}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.logger.log(`Connecting to Binance WS: ${url}`);
    
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.logger.log('Connected to Binance combined stream.');
      this.retries = 0; // reset retries on successful connection
      this.setupHeartbeat();
    });

    ws.on('message', (data: RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        // Clean payload from combined stream: { stream: '...', data: { ... } }
        if (payload && payload.data) {
          // 3. Emit internal event completely unblocked - no database hits, no heavy lifting
          this.eventEmitter.emit('market.ticker', payload.data);
        }
      } catch (err) {
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
