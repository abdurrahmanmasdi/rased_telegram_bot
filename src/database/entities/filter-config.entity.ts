import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('filter_configs')
export class FilterConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ unique: true })
  tier: string;

  @Column({ type: 'float', default: 25000000 })
  minQuoteVolume: number;

  @Column({ type: 'float', default: 1.5 })
  minPriceChangePercent: number;

  @Column({ type: 'float', default: 1.5 })
  minRvol: number;

  @Column({ type: 'float', default: 2.0 })
  minAtrPercent: number;

  @Column({ type: 'int', default: 900 })
  cooldownSeconds: number;
}
