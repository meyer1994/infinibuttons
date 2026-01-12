import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { TButtons } from "../db/schema";


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
    // @ts-expect-error: the model exists but it is not generate by warngler
    const result = await this.ai.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content: `
            You generate similar words based on the given word.

            - You may generate complex words, but prefer single words. Examples: 
              - country of france
              - japan's capital
              - someones's dog
              - big ball
            - The words must be similar to the parent word.
            - You must generate a word and an emoji that is related to the word.
          `
        },
        {
          role: "user",
          content: `Here is the word: ${parentName}`
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
    }) as { response: { items: { name: string; emoji: string }[] } };

    const items = result.response?.items ?? [];
    if (items.length === 0) return [];

    // Check which items already exist in the database
    const rows = await this.db
      .select({ name: TButtons.name })
      .from(TButtons)
      .where(inArray(TButtons.name, items.map(i => i.name)));

    const existing = rows.map(e => e.name);
    return items
      .filter(i => !existing.includes(i.name))
      .slice(0, 4);
  }
}
