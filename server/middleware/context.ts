import { eventHandler } from "h3";
import { useDrizzle } from "../utils/drizzle";


export default eventHandler(async (event) => {
    event.context.db = useDrizzle(event);
});

declare module "h3" {
    interface H3EventContext {
        db: ReturnType<typeof useDrizzle>;
    }
}