import {
  conversations,
  type ConversationFlavor
} from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import { eq, isNull } from 'drizzle-orm';
import { Bot, Context, session, SessionFlavor } from 'grammy';
import { ignoreOld } from 'grammy-middlewares';
import type { UserFromGetMe } from 'grammy/types';
import type { StorageAdapter } from 'grammy/web';
import { TButtons, TMessages } from '../db/schema';
import { ItemGenerator } from './ai';
import { useDrizzle } from './drizzle';


interface Session {
  timestamp: number;
  currentElementId?: number | null;
  history: (number | null)[];
  totalPressed: number;
  viewedButtonIds: number[];
  discoveredButtonIds: number[];
}

type MyContext = Context & SessionFlavor<Session> & ConversationFlavor<Context> & {
  ai: Ai;
  db: ReturnType<typeof useDrizzle>;
}

class DrizzleAdapter<T> implements StorageAdapter<T> {
  constructor(private db: ReturnType<typeof useDrizzle>) {}

  async read(key: string): Promise<T | undefined> {
    console.info(`DrizzleAdapter: Reading key="${key}"`);
    const message = await this.db
      .select()
      .from(TMessages)
      .where(eq(TMessages.id, key))
      .get();
    if (!message?.message) return undefined;
    return JSON.parse(message.message) as T;
  }

  async write(key: string, value: T): Promise<void> {
    console.info(`DrizzleAdapter: Writing key="${key}"`);
    await this.db
      .insert(TMessages)
      .values({ id: key, message: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: [TMessages.id],
        set: { message: JSON.stringify(value) },
      });
  }

  async delete(key: string): Promise<void> {
    console.info(`DrizzleAdapter: Deleting key="${key}"`);
    await this.db
      .delete(TMessages)
      .where(eq(TMessages.id, key));
  }
}


export class TelegramBot {
  public bot: Bot<MyContext>;
  private db: ReturnType<typeof useDrizzle>;
  private env: Env;

  constructor(db: ReturnType<typeof useDrizzle>, env: Env) {
    console.info('TelegramBot: Initializing bot...');
    this.db = db;
    this.env = env;

    const botInfo = JSON.parse(env.NITRO_BOT_INFO) as UserFromGetMe;
    this.bot = new Bot<MyContext>(env.NITRO_BOT_TOKEN, { botInfo });
    console.info('TelegramBot: Bot created successfully');

    this.setupMiddleware();
    this.setupHandlers();
    console.info('TelegramBot: Setup complete');
  }

  private setupMiddleware() {
    console.info('TelegramBot: Setting up middleware...');

    // ignore old updates
    this.bot.use(ignoreOld(60 * 24 * 7));  // games last 7 days

    // session management
    this.bot.use(session({ 
      prefix: 'session:',
      storage: new DrizzleAdapter(this.db),
      initial: (): Session => ({ 
        timestamp: new Date().getTime(),
        currentElementId: null, 
        history: [], 
        totalPressed: 0,
        viewedButtonIds: [],
        discoveredButtonIds: [],
      })
    }));

    // conversations support
    this.bot.use(conversations({ 
      storage: {
        type: 'key',
        prefix: 'conversation:',
        adapter: new DrizzleAdapter(this.db)
      }
    }));

    console.info('TelegramBot: Middleware setup complete');
  }

  private setupHandlers() {
    console.info('TelegramBot: Setting up handlers...');
    const { menuDiscoveryA } = this.setupMenus();

    // Command handlers
    this.bot.command('start', async (ctx) => {
      console.info(`TelegramBot: /start command received from user ${ctx.from?.id}`);
      ctx.session.timestamp = new Date().getTime();
      ctx.session.currentElementId = null;
      ctx.session.history = [];
      ctx.session.totalPressed = 0;
      ctx.session.viewedButtonIds = [];
      ctx.session.discoveredButtonIds = [];
      await ctx.reply('Infinite Buttons!', { reply_markup: menuDiscoveryA });
    });

    // Echo text
    this.bot.on(':text', async ctx => await ctx.reply(`echo: ${ctx.message?.text}`));
  }

  private async dynamicFetchChildren(ctx: MyContext) {
    try {
      await ctx.replyWithChatAction('typing');
      return await this.fetchChildren(ctx.session.currentElementId);
    } catch (error) {
      console.error(`TelegramBot: Error fetching children for id ${ctx.session.currentElementId}: ${error}`);
      await ctx.react('🤬');
      throw error;
    }
  }

  private setupMenus() {
    const menuDiscoveryA = new Menu<MyContext>('discovery-a')
      .dynamic(async (ctx, range) => {
        const children = await this.dynamicFetchChildren(ctx);

        let i = 0;
        for (const child of children) {
          const name = child.emoji ? `${child.emoji} ${child.name}` : child.name;
          
          range.text(name, async (ctx) => {
            ctx.session.currentElementId = child.id;
            await ctx.menu.nav('discovery-b');
          });

          if (++i % 2 === 0) range.row();
        }
      })
      .row()
      .text('Close', async (ctx) => await ctx.menu.close());

    const menuDiscoveryB = new Menu<MyContext>('discovery-b')
      .dynamic(async (ctx, range) => {
        const children = await this.dynamicFetchChildren(ctx);

        let i = 0;
        for (const child of children) {
          const name = child.emoji ? `${child.emoji} ${child.name}` : child.name;
          
          range.text(name, async (ctx) => {
            ctx.session.currentElementId = child.id;
            await ctx.menu.nav('discovery-a');
          });

          if (++i % 2 === 0) range.row();
        }
      })
      .row()
      .text('Close', async (ctx) => await ctx.menu.close());

    menuDiscoveryA.register(menuDiscoveryB);
    this.bot.use(menuDiscoveryA);

    return { menuDiscoveryA, menuDiscoveryB };
  }

  private async fetchChildren(id: number | null | undefined) {
    const children: typeof TButtons.$inferSelect[] = id
      ? await this.db.select().from(TButtons).where(eq(TButtons.parentId, id)).all()
      : await this.db.select().from(TButtons).where(isNull(TButtons.parentId)).all();

    const isRoot = id === null || id === undefined;
    const hasChildren = children.length > 0;

    // already have children, return them
    if (!isRoot && hasChildren) {
      return children;
    }

    if (isRoot && hasChildren) {
      return children;
    }

    // nothin in DB, create defaults
    if (isRoot && !hasChildren) {
      return await this.db
        .insert(TButtons)
        .values([
          { name: 'Water', emoji: '💧', parentId: null },
          { name: 'Fire', emoji: '🔥', parentId: null },
          { name: 'Air', emoji: '💨', parentId: null },
          { name: 'Earth', emoji: '🌍', parentId: null },
        ])
        .returning();
    }

    const button = await this.db
      .select()
      .from(TButtons)
      .where(eq(TButtons.id, id as number))
      .get();

    if (!button) throw new Error(`Button with id ${id} not found`);

    const generator = new ItemGenerator(this.env.AI, this.db);
    const items = await generator.generate(button.name);

    return await this.db
      .insert(TButtons)
      .values(items.map(item => ({ 
        name: item.name, 
        emoji: item.emoji, 
        parentId: button.id,
      })))
      .returning();
  }
}
