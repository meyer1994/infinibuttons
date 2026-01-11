import { eventHandler } from "h3";
import { useTelegram } from "~/utils/telegram";
import { useDrizzle } from "../utils/drizzle";


export default eventHandler(async (event) => {
    event.context.db = useDrizzle(event);
    event.context.bot = useTelegram(event);
});

declare module "h3" {
    interface H3EventContext {
        db: ReturnType<typeof useDrizzle>;
        bot: ReturnType<typeof useTelegram>;
    }
}