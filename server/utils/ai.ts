import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "~~/server/db/schema";
import { TButtons } from "~~/server/db/schema";


const Schema = z.object({
  items: z.array(z.object({
    name: z.string().describe("The name of the item"),
    emoji: z.string().describe("An emoji representing the item"),
  })).length(10).describe("A list of 10 items"),
});

type SchemaType = z.infer<typeof Schema>;

export class ItemGenerator {
  private ai: Ai;
  private db: DrizzleD1Database<typeof schema>;

  constructor(ai: Ai, db: DrizzleD1Database<typeof schema>) {
    this.ai = ai;
    this.db = db;
  }

  /**
   * Generates 10 items and returns up to 4 that are new (not in DB).
   */
  async generate(parentName: string) {
    const result = await this.ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: "You are a creative assistant that generates items for a discovery game. Each item needs a name and an emoji."
        },
        {
          role: "user",
          content: `Generate 10 items that can be derived from or are related to "${parentName}".`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  emoji: { type: "string" }
                },
                required: ["name", "emoji"]
              },
              minItems: 10,
              maxItems: 10
            }
          },
          required: ["items"]
        }
      }
    }) as { response: SchemaType };

    if (!result.response?.items || result.response.items.length === 0) return [];

    // Check which items already exist in the database
    const rows = await this.db
      .select({ name: TButtons.name })
      .from(TButtons)
      .where(inArray(TButtons.name, result.response.items.map(i => i.name)));

    const existing = rows.map(e => e.name);
    const items = result.response.items.filter(i => !existing.includes(i.name));
    return items.slice(0, 4);
  }
}
