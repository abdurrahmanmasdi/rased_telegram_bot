import { Update, Ctx, Start, Command } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { FilterConfigService } from '../engine/filter-config.service';
import { UserService } from './user.service';

@Update()
export class TelegramUpdate {
  constructor(
    private readonly filterConfigService: FilterConfigService,
    private readonly userService: UserService,
  ) {}

  private isAdmin(ctx: Context): boolean {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    return !!adminId && ctx.from?.id.toString() === adminId;
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const telegramId = ctx.from?.id.toString();
    const username = ctx.from?.username;

    if (telegramId) {
      await this.userService.registerUser(telegramId, username);
      await ctx.reply('Welcome to MBM Radar! Your account has been registered on the Free tier.');
    } else {
      await ctx.reply('Welcome to MBM Radar. I am currently monitoring the markets.');
    }
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context) {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('Unauthorized.');
      return;
    }

    const filters = await this.filterConfigService.getFilters();
    
    const message = `
📊 <b>ACTIVE RADAR FILTERS</b> 📊

<b>Min Volume:</b> $${(filters.minQuoteVolume / 1000000).toFixed(2)}M
<b>Min Change:</b> ${filters.minPriceChangePercent.toFixed(2)}%
<b>Min RVOL:</b> ${filters.minRvol.toFixed(2)}x
<b>Min ATR:</b> ${filters.minAtrPercent.toFixed(2)}%
    `.trim();

    await ctx.replyWithHTML(message);
  }

  @Command('setvol')
  async onSetVol(@Ctx() ctx: Context) {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('Unauthorized.');
      return;
    }

    // Extract text from the context message
    const message = ctx.message as any;
    if (!message || !message.text) return;

    const parts = message.text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('Usage: /setvol <number>');
      return;
    }

    const newVol = parseFloat(parts[1]);
    if (isNaN(newVol)) {
      await ctx.reply('Invalid volume number.');
      return;
    }

    await this.filterConfigService.updateFilters({ minQuoteVolume: newVol });
    await ctx.reply(`✅ <b>Min Volume</b> successfully updated to $${(newVol / 1000000).toFixed(2)}M!`, { parse_mode: 'HTML' });
  }
}
