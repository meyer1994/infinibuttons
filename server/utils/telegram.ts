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
import { TButtons, TMessages } from '~~/server/db/schema';
import { ItemGenerator } from '~~/server/utils/ai';
import type { useDrizzle } from '~~/server/utils/drizzle';


interface Session {
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


async function getOrGenerateButtons(
  ctx: MyContext,
  parentId: number | null,
  userId: string | undefined
): Promise<typeof TButtons.$inferSelect[]> {
  const { ai, db } = ctx;
  console.info(`getOrGenerateButtons: Getting buttons for parentId=${parentId}`);
  // Get existing children
  const existing = parentId === null
    ? await db.select().from(TButtons).where(isNull(TButtons.parentId)).all()
    : await db.select().from(TButtons).where(eq(TButtons.parentId, parentId)).all();

  // If children exist, return them
  if (existing.length > 0) {
    console.info(`getOrGenerateButtons: Found ${existing.length} existing buttons`);
    return existing;
  }

  // Otherwise, generate new ones
  try {
    await ctx.react('🤔');

    let parentName: string | undefined = 'Root' 
    if (parentId !== null) {
      const parent = await db
        .select()
        .from(TButtons)
        .where(eq(TButtons.id, parentId))
        .get();
      parentName = parent?.name;
    } else {
      // For root, if nothing exists, we can provide defaults or generate
      // Let's provide defaults for the very first time
      const defaults = [
        { name: 'Water', emoji: '💧', parentId: null },
        { name: 'Fire', emoji: '🔥', parentId: null },
        { name: 'Air', emoji: '💨', parentId: null },
        { name: 'Earth', emoji: '🌍', parentId: null },
      ];
      
      const inserted = await db
        .insert(TButtons)
        .values(defaults)
        .returning();
      
      await ctx.react([]);
      return inserted;
    }
    parentName = parentName ?? 'Root';

    // Generate new elements using LLM
    console.info(`getOrGenerateButtons: Generating new buttons for parent "${parentName}"`);
    const generator = new ItemGenerator(ai, db);
    const items = await generator.generate(parentName);
    console.info(`getOrGenerateButtons: Generated ${items.length} new items`);
    
    if (items.length > 0) {
      const newlyDiscovered = await db
        .insert(TButtons)
        .values(items.map(item => ({ 
          name: item.name, 
          emoji: item.emoji, 
          parentId, discoveredBy: userId 
        })))
        .returning({ id: TButtons.id });

      const discoveredIds = newlyDiscovered
        .filter(row => !ctx.session.discoveredButtonIds.includes(row.id))
        .map(row => row.id);

      ctx.session.discoveredButtonIds.push(...discoveredIds);
    }

    // Query to get the inserted rows
    const inserted = parentId === null
      ? await db.select().from(TButtons).where(isNull(TButtons.parentId)).all()
      : await db.select().from(TButtons).where(eq(TButtons.parentId, parentId)).all();

    // Clear "thinking" reaction
    await ctx.react([]);
    console.info(`getOrGenerateButtons: Returning ${inserted.length} buttons`);

    return inserted;
  } catch (e) {
    console.error('Error generating buttons:', e);
    await ctx.react('😱');
    throw e;
  }
}

function getStatsMessage(ctx: MyContext) {
  const depth = ctx.session.history.length;
  const discovered = ctx.session.discoveredButtonIds.length;
  const viewed = ctx.session.viewedButtonIds.length;
  const pressed = ctx.session.totalPressed;
  return `Infinite Buttons!\n\nDepth: ${depth}\nDiscovered: ${discovered}\nViewed: ${viewed}\nPressed: ${pressed}`;
}


export class TelegramBot {
  public bot: Bot<MyContext>;
  private static GLOBAL_BOT: Bot<MyContext>;

  constructor(private event: H3Event) {
    console.info('TelegramBot: Initializing bot...');
    const token = process.env.NITRO_BOT_TOKEN;
    const botInfoStr = process.env.NITRO_BOT_INFO;

    if (!token) throw new Error('BOT_TOKEN is not set');
    if (!botInfoStr) throw new Error('BOT_INFO is not set');

    if (!TelegramBot.GLOBAL_BOT) {
      TelegramBot.GLOBAL_BOT = new Bot<MyContext>(token, {
        botInfo: JSON.parse(botInfoStr) as UserFromGetMe,
      });
      console.info('TelegramBot: Bot created successfully');

      this.setupMiddleware();
      this.setupHandlers();
      console.info('TelegramBot: Setup complete');
    }

    this.bot = TelegramBot.GLOBAL_BOT;
  }

  private setupMiddleware() {
    console.info('TelegramBot: Setting up middleware...');
    const { event } = this;

    // ignore old updates
    this.bot.use(ignoreOld(60 * 24 * 7));  // games last 7 days

    // inject ai and db into context
    this.bot.use(async (ctx, next) => {
      ctx.ai = event.context.ai;
      ctx.db = event.context.db;
      await next();
    });

    // this.bot.use(sequentialize(ctx => ctx.from?.id.toString()));

    const getSessionKey = (ctx: MyContext) => '/' + [
      'chat',
      ctx.from?.id.toString(),
      'message',
      ctx.message?.message_id.toString(),
    ].join('/');

    // session management
    this.bot.use(session({ 
      prefix: 'session:',
      getSessionKey: getSessionKey,
      storage: new DrizzleAdapter(event.context.db),
      initial: (): Session => ({ 
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
        getStorageKey: getSessionKey,
        adapter: new DrizzleAdapter(event.context.db)
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
      ctx.session.currentElementId = null;
      ctx.session.history = [];
      ctx.session.totalPressed = 0;
      ctx.session.viewedButtonIds = [];
      ctx.session.discoveredButtonIds = [];
      
      // Ensure root buttons exist and are tracked in session
      await this.getChildrenAndTrack(ctx, null);
      await ctx.reply(getStatsMessage(ctx), { reply_markup: menuDiscoveryA });
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

  private async getChildrenAndTrack(ctx: MyContext, parentId: number | null) {
    const userId = ctx.from?.id.toString();
    console.info(`getChildrenAndTrack: Fetching children for parentId=${parentId}, userId=${userId}`);
    const children = await getOrGenerateButtons(ctx, parentId, userId);
    for (const child of children) {
      if (!ctx.session.viewedButtonIds.includes(child.id)) {
        ctx.session.viewedButtonIds.push(child.id);
      }
    }
    console.info(`getChildrenAndTrack: Tracked ${children.length} children`);
    return children;
  }

  private async dynamic(ctx: MyContext, range: MenuRange<MyContext>, nextMenuId: string) {
    const parentId = ctx.session.currentElementId ?? null;
    console.info(`dynamic: Building menu for parentId=${parentId}, nextMenuId=${nextMenuId}`);
    const children = await this.getChildrenAndTrack(ctx, parentId);
    
    let i = 0
    for (const child of children) {
      const name = child.emoji ? `${child.emoji} ${child.name}` : child.name;
      console.info('Child name:', name);

      range.submenu(name, nextMenuId, async (ctx) => {
        console.info(`dynamic: Button clicked - "${name}" (id=${child.id})`);
        ctx.session.history.push(ctx.session.currentElementId ?? null);
        ctx.session.currentElementId = child.id;
        ctx.session.totalPressed++;
        // Pre-fetch and track children for the next level to update stats
        await this.getChildrenAndTrack(ctx, child.id);
        await ctx.editMessageText(getStatsMessage(ctx));
      });
      if (++i % 2 === 0) range.row();
    }

    if (ctx.session.history.length > 0) {
      range.row().text('⬅️ Back', async (ctx) => {
        const prevId = ctx.session.history.pop();
        console.info(`dynamic: Back button clicked, navigating to parentId=${prevId}`);
        ctx.session.currentElementId = prevId ?? null;
        ctx.session.totalPressed++;
        // Pre-fetch and track children for the previous level to update stats
        await this.getChildrenAndTrack(ctx, prevId ?? null);
        await ctx.editMessageText(getStatsMessage(ctx));
        await ctx.menu.nav(nextMenuId);
      });
    }
  }
}
