import { createDatabase } from "db0";
import cloudflareD1 from "db0/connectors/cloudflare-d1";
import { drizzle } from "db0/integrations/drizzle";
import { H3Event } from "h3";
import * as schema from "../db/schema";

export const useDrizzle = (event?: H3Event) => {
    const db = createDatabase(cloudflareD1({ bindingName: "DB" }));
    return drizzle<typeof schema>(db);
}