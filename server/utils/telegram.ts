import { useRuntimeConfig } from "#imports";
import { Menu, } from "@grammyjs/menu";
import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { H3Event } from "h3";


export const useTelegram = (event?: H3Event) => {
    const config = useRuntimeConfig(event);
    if (!config.BOT_TOKEN) throw new Error("BOT_TOKEN is not set");

    const botInfo = config.BOT_INFO as unknown as UserFromGetMe
    if (!botInfo) throw new Error("BOT_INFO is not set");

    const bot = new Bot(config.BOT_TOKEN, { botInfo });

    // Create the submenu
    const subMenu = new Menu("sub-menu")
        .text("Sub-item 1", async (ctx) => await ctx.reply("Sub-item 1!"))
        .row()
        .text("Sub-item 2", async (ctx) => await ctx.reply("Sub-item 2!"))
        .row()
        .back("Back");

    // Create the main menu
    const mainMenu = new Menu("main-menu")
        .text("Option 1", async (ctx) => await ctx.reply("Option 1!"))
        .row()
        .submenu("Open Submenu", "sub-menu") // Links to the submenu
        .row()
        .text("Option 2", async (ctx) => await ctx.reply("Option 2!"))
        .row()
        .text("Close", async (ctx) => await ctx.menu.close());


    mainMenu.register(subMenu);
    bot.use(mainMenu)

    bot.command("start", async (ctx) => await ctx.reply("menu:", { reply_markup: mainMenu }));
    bot.on(":text", async (ctx) => await ctx.reply(`echo: ${ctx.message?.text}`));

    bot.api
        .setMyCommands([{ command: "start", description: "Start " },])
        .then(i => console.info('setMyCommands:', i))
        .catch(e => console.error('setMyCommands:', e))

    return bot;
}
