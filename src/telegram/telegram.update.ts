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

    const majorFilters = await this.filterConfigService.getFilters('MAJOR');
    const minorFilters = await this.filterConfigService.getFilters('MINOR');
    
    const message = `
📊 <b>ACTIVE RADAR FILTERS</b> 📊

📈 <b>MAJOR CAP ASSETS</b>
<b>Min Volume:</b> $${(majorFilters.minQuoteVolume / 1000000).toFixed(2)}M
<b>Min Change:</b> ${majorFilters.minPriceChangePercent.toFixed(2)}%
<b>Min RVOL:</b> ${majorFilters.minRvol.toFixed(2)}x
<b>Min ATR:</b> ${majorFilters.minAtrPercent.toFixed(2)}%

📉 <b>MINOR CAP ASSETS</b>
<b>Min Volume:</b> $${(minorFilters.minQuoteVolume / 1000000).toFixed(2)}M
<b>Min Change:</b> ${minorFilters.minPriceChangePercent.toFixed(2)}%
<b>Min RVOL:</b> ${minorFilters.minRvol.toFixed(2)}x
<b>Min ATR:</b> ${minorFilters.minAtrPercent.toFixed(2)}%
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
    if (parts.length < 3) {
      await ctx.reply('Usage: /setvol <MAJOR|MINOR> <number>');
      return;
    }

    const tierInput = parts[1].toUpperCase();
    if (tierInput !== 'MAJOR' && tierInput !== 'MINOR') {
      await ctx.reply('Invalid tier. Please specify MAJOR or MINOR.');
      return;
    }

    const newVol = parseFloat(parts[2]);
    if (isNaN(newVol)) {
      await ctx.reply('Invalid volume number.');
      return;
    }

    await this.filterConfigService.updateFilters(tierInput, { minQuoteVolume: newVol });
    await ctx.reply(`✅ <b>${tierInput} Tier Min Volume</b> successfully updated to $${(newVol / 1000000).toFixed(2)}M!`, { parse_mode: 'HTML' });
  }
}
