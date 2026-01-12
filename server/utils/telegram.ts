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
import { H3Event } from 'h3';
import { TButtons, TMessages } from '../db/schema';
import { generateElements } from './ai';
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
  if (existing.length > 0) {
    return existing;
  }

  // Otherwise, generate new ones
  const parentName = parentId === null ? 'Root' : 
    (await db.select().from(TButtons).where(eq(TButtons.id, parentId)).get())?.name || 'Unknown';
  
  // Generate new elements using LLM
  const newElementNames = await generateElements(ai, parentName);
  
  // Insert them into the database
  for (const name of newElementNames) {
    await db
      .insert(TButtons)
      .values({ name, parentId, discoveredBy: userId });
  }

  // Query to get the inserted rows
  const inserted = parentId === null
    ? await db.select().from(TButtons).where(isNull(TButtons.parentId)).all()
    : await db.select().from(TButtons).where(eq(TButtons.parentId, parentId)).all();

  return inserted;
}

export const useTelegram = (event: H3Event) => {
  if (!process.env.NITRO_BOT_TOKEN) throw new Error('BOT_TOKEN is not set');
  if (!process.env.NITRO_BOT_INFO) throw new Error('BOT_INFO is not set');

  const bot = new Bot<MyContext>(process.env.NITRO_BOT_TOKEN, {
    botInfo: JSON.parse(process.env.NITRO_BOT_INFO) as UserFromGetMe,
  });

  // Menu Discovery A - recursively alternates with Menu Discovery B
  const menuDiscoveryA = new Menu<MyContext>('discovery-a')
    .dynamic(async (ctx, range) => {
      const parentId = ctx.session.currentElementId ?? null;
      const userId = ctx.from?.id.toString();
      const children = await getOrGenerateButtons(ctx.ai, ctx.db, parentId, userId);
      
      let i = 0
      for (const child of children) {
        range.submenu(child.name, 'discovery-b', async (ctx) => {
          ctx.session.history.push(ctx.session.currentElementId ?? null);
          ctx.session.currentElementId = child.id;
        });
        if (++i % 2 === 0) range.row();
      }

      if (ctx.session.history.length > 0) {
        range.row().text('⬅️ Back', async (ctx) => {
          const prevId = ctx.session.history.pop();
          ctx.session.currentElementId = prevId ?? null;
          await ctx.menu.nav('discovery-b');
        });
      }
    })
    .row()
    .text('Close', async (ctx) => await ctx.menu.close());

  // Menu Discovery B - recursively alternates with Menu Discovery A
  const menuDiscoveryB = new Menu<MyContext>('discovery-b')
    .dynamic(async (ctx, range) => {
      const parentId = ctx.session.currentElementId ?? null;
      const userId = ctx.from?.id.toString();
      const children = await getOrGenerateButtons(ctx.ai, ctx.db, parentId, userId);
      
      let i = 0
      for (const child of children) {
        range.submenu(child.name, 'discovery-a', async (ctx) => {
          ctx.session.history.push(ctx.session.currentElementId ?? null);
          ctx.session.currentElementId = child.id;
        });
        if (++i % 2 === 0) range.row();
      }

      if (ctx.session.history.length > 0) {
        range.row().text('⬅️ Back', async (ctx) => {
          const prevId = ctx.session.history.pop();
          ctx.session.currentElementId = prevId ?? null;
          await ctx.menu.nav('discovery-a');
        });
      }
    })
    .row()
    .text('Close', async (ctx) => await ctx.menu.close());

  // Register menus with each other for recursion
  menuDiscoveryA.register(menuDiscoveryB);

  // ignore
  bot.use(ignoreOld(60))

  bot.use(async (ctx, next) => {
    ctx.ai = event.context.ai;
    ctx.db = event.context.db;
    await next();
  });

  // session
  bot.use(session({ 
    prefix: 'session:',
    storage: new DrizzleAdapter(event.context.db),
    initial: (): Session => ({ currentElementId: null, history: [] })
  }));

  // conversations
  bot.use(conversations({ 
    storage: {
      type: 'key',
      prefix: 'conversation:',
      adapter: new DrizzleAdapter(event.context.db)
    }
  }));

  // register menus
  bot.use(menuDiscoveryA)

  // command handlers
  bot.command('start', async (ctx) => {
    ctx.session.currentElementId = null;
    ctx.session.history = [];
    
    const existingRoot = await ctx.db
      .select()
      .from(TButtons)
      .where(isNull(TButtons.parentId))
      .get();

    if (!existingRoot) {
        await ctx.db.insert(TButtons).values([
          { name: 'Water', parentId: null },
          { name: 'Fire', parentId: null },
          { name: 'Air', parentId: null },
          { name: 'Earth', parentId: null },
        ]);
      }
    
    await ctx.reply('Infinite Buttons!', { reply_markup: menuDiscoveryA });
  });

  // echo text
  bot.on(':text', async ctx => await ctx.reply(`echo: ${ctx.message?.text}`));

  return bot;
};
