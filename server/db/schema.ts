import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const TUsers = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type User = typeof TUsers.$inferSelect;
export type NewUser = typeof TUsers.$inferInsert;
