import { eventHandler } from 'h3';
import { useDrizzle } from '../utils/drizzle';
import { TelegramBot } from '../utils/telegram';

export default eventHandler(async (event) => {
  console.info(`'[middleware/context] ${event.method} ${event.path}`);
  event.context.db = useDrizzle(event);
  event.context.bot = new TelegramBot(event);
  event.context.ai = event.context.cloudflare.env.AI as Ai;
});

declare module 'h3' {
  interface H3EventContext {
    ai: Ai;
    db: ReturnType<typeof useDrizzle>;
    bot: TelegramBot;
  }
}
