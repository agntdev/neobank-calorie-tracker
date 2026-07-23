// Durable domain store for the calorie tracker.
//
// Uses the toolkit's persistent storage mechanism (resolveSessionStorage):
// Redis when REDIS_URL is set (production), in-memory otherwise (dev + the
// tokenless test harness). This is the SAME mechanism the bot's grammY session
// uses, but accessed DIRECTLY here for durable domain records (profiles,
// categories, transactions, notification prefs) — not the ephemeral session.
//
// Keys are namespaced per chat (cal:<chatId>:<record>). We NEVER enumerate the
// keyspace (no KEYS/SCAN/readAll): every collection a handler needs is read
// through an explicit stored record (e.g. the transactions array for a chat).

import { resolveSessionStorage } from "./toolkit/index.js";
import type { StorageAdapter } from "grammy";
import type { Category, NotifPref, Profile, Transaction } from "./types.js";

type Rec = Record<string, unknown>;

const storage: StorageAdapter<Rec> = resolveSessionStorage<Rec>(undefined);

function key(chatId: number | string, name: string): string {
  return `cal:${chatId}:${name}`;
}

export async function getProfile(chatId: number | string): Promise<Profile | undefined> {
  return (await storage.read(key(chatId, "profile"))) as Profile | undefined;
}

export async function setProfile(chatId: number | string, p: Profile): Promise<void> {
  await storage.write(key(chatId, "profile"), p as unknown as Rec);
}

export async function getCategories(chatId: number | string): Promise<Category[]> {
  return ((await storage.read(key(chatId, "categories"))) as Category[] | undefined) ?? [];
}

export async function setCategories(chatId: number | string, cats: Category[]): Promise<void> {
  await storage.write(key(chatId, "categories"), cats as unknown as Rec);
}

export async function getTransactions(chatId: number | string): Promise<Transaction[]> {
  return ((await storage.read(key(chatId, "tx"))) as Transaction[] | undefined) ?? [];
}

export async function setTransactions(
  chatId: number | string,
  txs: Transaction[],
): Promise<void> {
  await storage.write(key(chatId, "tx"), txs as unknown as Rec);
}

export async function getNotif(chatId: number | string): Promise<NotifPref | undefined> {
  return (await storage.read(key(chatId, "notif"))) as NotifPref | undefined;
}

export async function setNotif(chatId: number | string, n: NotifPref): Promise<void> {
  await storage.write(key(chatId, "notif"), n as unknown as Rec);
}

/** Wipe all of a chat's durable data (user-initiated data deletion only). */
export async function wipeAll(chatId: number | string): Promise<void> {
  await storage.delete(key(chatId, "profile"));
  await storage.delete(key(chatId, "categories"));
  await storage.delete(key(chatId, "tx"));
  await storage.delete(key(chatId, "notif"));
}
