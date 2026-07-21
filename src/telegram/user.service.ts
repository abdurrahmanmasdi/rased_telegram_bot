import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../database/entities/user.entity';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../database/entities/subscription.entity';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {}

  async registerUser(telegramId: string, username?: string): Promise<User> {
    let user = await this.userRepository.findOne({ where: { telegramId } });

    if (user) {
      return user;
    }

    this.logger.log(`Registering new user with Telegram ID: ${telegramId}`);

    user = this.userRepository.create({
      telegramId,
      username,
      status: UserStatus.ACTIVE,
    });

    user = await this.userRepository.save(user);

    // Provide 1 year of free access as default
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const subscription = this.subscriptionRepository.create({
      userId: user.id,
      tier: SubscriptionTier.FREE,
      status: SubscriptionStatus.ACTIVE,
      expiresAt: expiresAt,
    });

    await this.subscriptionRepository.save(subscription);

    return user;
  }
}
