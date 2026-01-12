import {
  conversations,
  type ConversationFlavor
} from '@grammyjs/conversations';
import { Menu, MenuRange } from '@grammyjs/menu';
import { eq, isNull } from 'drizzle-orm';
import { Bot, Context, session, SessionFlavor } from 'grammy';
import { ignoreOld } from 'grammy-middlewares';
import type { UserFromGetMe } from 'grammy/types';
import type { StorageAdapter } from 'grammy/web';
import {
  H3Event
} from 'h3';
import { TButtons, TMessages } from '../db/schema';
import { ItemGenerator } from './ai';
import type { useDrizzle } from './drizzle';


interface Session {
  currentElementId?: number | null;
  history: Array<number | null>;
}

type MyContext = Context & SessionFlavor<Session> & ConversationFlavor<Context> & {
  ai: Ai;
  db: ReturnType<typeof useDrizzle>;
}

class DrizzleAdapter<T> implements StorageAdapter<T> {
  constructor(private db: ReturnType<typeof useDrizzle>) {}

  async read(key: string): Promise<T | undefined> {
    const message = await this.db
      .select()
      .from(TMessages)
      .where(eq(TMessages.id, key))
      .get();
    if (!message?.message) return undefined;
    return JSON.parse(message.message) as T;
  }

  async write(key: string, value: T): Promise<void> {
    await this.db
      .insert(TMessages)
      .values({ id: key, message: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: [TMessages.id],
        set: { message: JSON.stringify(value) },
      });
  }

  async delete(key: string): Promise<void> {
    await this.db
      .delete(TMessages)
      .where(eq(TMessages.id, key));
  }
}


async function getOrGenerateButtons(
  ai: Ai,
  db: ReturnType<typeof useDrizzle>,
  parentId: number | null,
  userId: string | undefined
) {
  // Get existing children
  const existing = parentId === null
    ? await db.select().from(TButtons).where(isNull(TButtons.parentId)).all()
    : await db.select().from(TButtons).where(eq(TButtons.parentId, parentId)).all();

  // If children exist, return them
  if (existing.length > 0) return existing;

  // Otherwise, generate new ones
  let parentName: string | undefined = 'Root' 
  if (parentId !== null) {
    const parent = await db.select().from(TButtons).where(eq(TButtons.id, parentId)).get();
    parentName = parent?.name;
  }
  parentName = parentName ?? 'Root';

  // Generate new elements using LLM
  const generator = new ItemGenerator(ai, db);
  const items = await generator.generate(parentName);
  
  if (items.length > 0) {
    await db
      .insert(TButtons)
      .values(items.map(item => ({ name: item.name, emoji: item.emoji, parentId, discoveredBy: userId })));
  }

  // Query to get the inserted rows
  const inserted = parentId === null
    ? await db.select().from(TButtons).where(isNull(TButtons.parentId)).all()
    : await db.select().from(TButtons).where(eq(TButtons.parentId, parentId)).all();

  return inserted;
}

export class TelegramBot {
  public bot: Bot<MyContext>;

  constructor(private event: H3Event) {
    const token = process.env.NITRO_BOT_TOKEN;
    const botInfoStr = process.env.NITRO_BOT_INFO;

    if (!token) throw new Error('BOT_TOKEN is not set');
    if (!botInfoStr) throw new Error('BOT_INFO is not set');

    this.bot = new Bot<MyContext>(token, {
      botInfo: JSON.parse(botInfoStr) as UserFromGetMe,
    });

    this.setupMiddleware();
    this.setupHandlers();
  }

  private setupMiddleware() {
    const { event } = this;

    // ignore old updates
    this.bot.use(ignoreOld(60));

    // inject ai and db into context
    this.bot.use(async (ctx, next) => {
      ctx.ai = event.context.ai;
      ctx.db = event.context.db;
      await next();
    });

    // session management
    this.bot.use(session({ 
      prefix: 'session:',
      storage: new DrizzleAdapter(event.context.db),
      initial: (): Session => ({ currentElementId: null, history: [] })
    }));

    // conversations support
    this.bot.use(conversations({ 
      storage: {
        type: 'key',
        prefix: 'conversation:',
        adapter: new DrizzleAdapter(event.context.db)
      }
    }));
  }

  private setupHandlers() {
    const { menuDiscoveryA } = this.setupMenus();

    // Command handlers
    this.bot.command('start', async (ctx) => {
      ctx.session.currentElementId = null;
      ctx.session.history = [];
      
      const existingRoot = await ctx.db
        .select()
        .from(TButtons)
        .where(isNull(TButtons.parentId))
        .get();

      if (!existingRoot) {
          await ctx.db.insert(TButtons).values([
            { name: 'Water', emoji: '💧', parentId: null },
            { name: 'Fire', emoji: '🔥', parentId: null },
            { name: 'Air', emoji: '💨', parentId: null },
            { name: 'Earth', emoji: '🌍', parentId: null },
          ]);
        }
      
      await ctx.reply('Infinite Buttons!', { reply_markup: menuDiscoveryA });
    });

    // Echo text
    this.bot.on(':text', async ctx => await ctx.reply(`echo: ${ctx.message?.text}`));
  }

  private setupMenus() {
    // Menu Discovery A - recursively alternates with Menu Discovery B
    const menuDiscoveryA = new Menu<MyContext>('discovery-a')
      .dynamic(async (ctx, range) => await this.dynamic(ctx, range, 'discovery-b'))
      .row()
      .text('Close', async (ctx) => await ctx.menu.close());

    // Menu Discovery B - recursively alternates with Menu Discovery A
    const menuDiscoveryB = new Menu<MyContext>('discovery-b')
      .dynamic(async (ctx, range) => await this.dynamic(ctx, range, 'discovery-a'))
      .row()
      .text('Close', async (ctx) => await ctx.menu.close());

    // Register menus with each other for recursion
    menuDiscoveryA.register(menuDiscoveryB);
    
    // Register menus with bot
    this.bot.use(menuDiscoveryA);

    return { menuDiscoveryA, menuDiscoveryB };
  }

  private async dynamic(ctx: MyContext, range: MenuRange<MyContext>, nextMenuId: string) {
    const parentId = ctx.session.currentElementId ?? null;
    const userId = ctx.from?.id.toString();
    const children = await getOrGenerateButtons(ctx.ai, ctx.db, parentId, userId);
    
    let i = 0
    for (const child of children) {
      const name = child.emoji ? `${child.emoji} ${child.name}` : child.name;
      console.info('Child name:', name);

      range.submenu(name, nextMenuId, async (ctx) => {
        ctx.session.history.push(ctx.session.currentElementId ?? null);
        ctx.session.currentElementId = child.id;
      });
      if (++i % 2 === 0) range.row();
    }

    if (ctx.session.history.length > 0) {
      range.row().text('⬅️ Back', async (ctx) => {
        const prevId = ctx.session.history.pop();
        ctx.session.currentElementId = prevId ?? null;
        await ctx.menu.nav(nextMenuId);
      });
    }
  }
}
