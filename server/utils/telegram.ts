import { Menu, } from "@grammyjs/menu";
import { Bot } from "grammy";

// Replace 'YOUR_BOT_TOKEN' with your actual bot token from @BotFather
const token = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN";
console.info('token:', token)

if (token === "YOUR_BOT_TOKEN") {
    console.warn("Please provide a valid BOT_TOKEN via environment variable or replace the placeholder.");
}

const bot = new Bot(token);

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

const main = async () => {
    console.log("Bot is starting...");
    await bot.api.setMyCommands([{ command: "start", description: "Start " },]);
    await bot.start()
}

main()
    .then(i => console.info(i))
    .catch(e => console.info(e))