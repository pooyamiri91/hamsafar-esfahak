import { pgTable, integer, text, boolean, jsonb, bigint, serial } from 'drizzle-orm/pg-core';

export const members = pgTable('members', {
  id: integer().primaryKey(),
  name: text().notNull(),
  role: text().notNull(),
  profile: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  room: text().notNull().default(''),
  active: boolean().notNull().default(true),
  version: integer().notNull().default(0),
  updated: bigint({ mode: 'number' }).notNull().default(0),
});
export const sessions = pgTable('sessions', {
  token: text().primaryKey(),
  member: integer().notNull().references(() => members.id),
  expires: bigint({ mode: 'number' }).notNull(),
  adminProof: text('admin_proof').notNull().default(''),
});
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: text().notNull().default(''),
});
export const audit = pgTable('audit', {
  id: serial().primaryKey(), actor: integer().notNull(), target: integer().notNull(),
  action: text().notNull(), stamp: bigint({ mode: 'number' }).notNull(),
});
export const attempts = pgTable('login_attempts', {
  key: text().primaryKey(), count: integer().notNull(),
  expires: bigint({ mode: 'number' }).notNull(),
});
