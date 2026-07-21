import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Subscription } from './entities/subscription.entity';
import { AlertLog } from './entities/alert-log.entity';
import { AssetConfig } from './entities/asset-config.entity';
import { AssetConfigService } from './asset-config.service';
import { Redis } from 'ioredis';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'rased',
      entities: [User, Subscription, AlertLog, AssetConfig],
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    TypeOrmModule.forFeature([User, Subscription, AlertLog, AssetConfig]),
  ],
  providers: [
    AssetConfigService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        });
      },
    },
  ],
  exports: [TypeOrmModule, AssetConfigService, 'REDIS_CLIENT'],
})
export class DatabaseModule {}
