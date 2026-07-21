import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('asset_configs')
export class AssetConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ unique: true })
  ticker: string;

  @Column({ default: true })
  isTracked: boolean;

  @Column({ default: true })
  isHalal: boolean;
}
