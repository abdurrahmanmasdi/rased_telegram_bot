import { Module } from '@nestjs/common';
import { AlertsConsumer } from './alerts.consumer';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramUpdate } from './telegram.update';
import { EngineModule } from '../engine/engine.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertLog } from '../database/entities/alert-log.entity';
import { User } from '../database/entities/user.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { UserService } from './user.service';

@Module({
  imports: [
    EngineModule,
    TypeOrmModule.forFeature([AlertLog, User, Subscription]),
    TelegrafModule.forRootAsync({
      useFactory: () => ({
        token: process.env.TELEGRAM_BOT_TOKEN!,
      }),
    }),
  ],
  providers: [AlertsConsumer, TelegramUpdate, UserService],
  exports: [UserService],
})
export class TelegramModule {}

