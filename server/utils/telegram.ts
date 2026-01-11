import {
  conversations,
  createConversation,
  type Conversation,
  type ConversationFlavor
} from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import { eq } from 'drizzle-orm';
import { Bot, Context, session, SessionFlavor } from 'grammy';
import { ignoreOld } from 'grammy-middlewares';
import type { UserFromGetMe } from 'grammy/types';
import type { StorageAdapter } from 'grammy/web';
import { H3Event } from 'h3';
import { TMessages } from '../db/schema';
import type { useDrizzle } from './drizzle';


interface Session {
  machines: Array<{ id: string; name: string }>;
  selectedMachine?: string;
}

type MyContext = Context & SessionFlavor<Session> & ConversationFlavor<Context>;
type MyConversation = Conversation<MyContext>;

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

async function createMachine(conversation: MyConversation, ctx: MyContext) {
  await ctx.reply('Enter name for new machine:');
  
  const { message } = await conversation.waitFor('message:text');
  if (!message?.text.trim()) {
    await ctx.reply('No name provided.');
    return;
  }

  const session = await conversation.external(ctx => ctx.session)
  session.machines.push({ id: Math.random().toString(), name: message.text });
  await conversation.external(ctx => ctx.session = session);

  await ctx.reply(`Machine "${message.text}" created.`);
}

async function editMachineName(conversation: MyConversation, ctx: MyContext) {
  const session = await conversation.external(ctx => ctx.session)

  if (!session.selectedMachine) {
    await ctx.reply('No machine selected.');
    return;
  }

  const machine = session.machines.find(m => m.id === session.selectedMachine);

  if (!machine) {
    await ctx.reply('Machine not found.');
    return;
  }

  await ctx.reply(`Enter new name for machine "${machine.name}":`);
  const { message } = await conversation.waitFor('message:text');

  if (!message?.text.trim()) {
    await ctx.reply('No name provided.');
    return;
  }

  for (const machine of session.machines) {
    if (machine.id !== session.selectedMachine) continue
    machine.name = message.text;
  }

  await conversation.external(ctx => ctx.session = session);
  await ctx.reply(`Machine "${machine.name}" updated.`);
}

export const useTelegram = (event: H3Event) => {
  if (!process.env.NITRO_BOT_TOKEN) throw new Error('BOT_TOKEN is not set');
  if (!process.env.NITRO_BOT_INFO) throw new Error('BOT_INFO is not set');

  const bot = new Bot<MyContext>(process.env.NITRO_BOT_TOKEN, {
    botInfo: JSON.parse(process.env.NITRO_BOT_INFO) as UserFromGetMe,
  });

  // menu machine detail
  const menuMachineDetail = new Menu<MyContext>('machine-detail')
    .text('Edit Name', async ctx => await ctx.conversation.enter('editMachineName'))
    .row()
    .text('Delete', async ctx => await ctx.reply('Button delete'))
    .row()
    .back('Back')
    .text('Close', async ctx => await ctx.menu.close());

  // menu machines list
  const menuMachinesList = new Menu<MyContext>('machines-list')
    .dynamic(async (ctx, range) => {
      for (const machine of ctx.session.machines) {
        range.submenu(machine.name, 'machine-detail', async (ctx) => {
          ctx.session.selectedMachine = machine.id;
        });
        range.row();
      }
    })
    .back('Back')
    .text('Close', async ctx => await ctx.menu.close());

  // menu start
  const menuStart = new Menu<MyContext>('start')
    .submenu('List Machines', 'machines-list')
    .row()
    .text('Create Machine', async ctx => await ctx.conversation.enter('createMachine'))
    .row()
    .text('Close', async ctx => await ctx.menu.close());

  // register menus
  menuMachinesList.register(menuMachineDetail);
  menuStart.register(menuMachinesList);

  // ignore
  bot.use(ignoreOld(60))

  // session
  bot.use(session({ 
    storage: new DrizzleAdapter(event.context.db),
    initial: (): Session => ({ machines: [] })
  }));

  // conversations
  bot.use(conversations({ 
    storage: {
      type: 'key',
      prefix: 'conversation:',
      adapter: new DrizzleAdapter(event.context.db)
    }
  }));
  bot.use(createConversation(createMachine));
  bot.use(createConversation(editMachineName));

  // register menus
  bot.use(menuStart)

  // command handlers
  bot.command('start', async (ctx) => {
    await ctx.reply('Machine menu', { reply_markup: menuStart });
  });

  // echo text
  bot.on(':text', async ctx => await ctx.reply(`echo: ${ctx.message?.text}`));

  return bot;
};
