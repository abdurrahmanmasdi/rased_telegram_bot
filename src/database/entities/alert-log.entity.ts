import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum Exchange {
  BINANCE = 'binance',
  BYBIT = 'bybit',
}

@Entity('alert_logs')
export class AlertLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  ticker: string;

  @Column({
    type: 'enum',
    enum: Exchange,
  })
  exchange: Exchange;

  @Column()
  triggerReason: string;

  @Column({ type: 'jsonb' })
  metricsSnapshot: any;

  @Column({ type: 'numeric' })
  entryPrice: number;

  @Column({ type: 'jsonb' })
  targets: number[];

  @Column({ type: 'numeric' })
  stopLoss: number;

  @Index()
  @CreateDateColumn()
  sentAt: Date;
}
