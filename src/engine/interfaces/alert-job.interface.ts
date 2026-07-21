export interface MetricsSnapshot {
  quoteVolume: number;
  priceChangePercent: number;
  lastPrice: number;
  vwap: number;
  rvol?: number;
  atrPercent?: number;
}

export interface AlertJobPayload {
  ticker: string;
  exchange: string;
  triggerReason: string;
  metricsSnapshot: MetricsSnapshot;
  entryPrice: number;
  stopLoss: number;
  targets: number[];
  timestamp: string;
}
