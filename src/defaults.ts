// Shared constants + small helpers used across feature handlers.

import type { Category } from "./types.js";
import { inlineButton, inlineKeyboard, type InlineKeyboardMarkup } from "./toolkit/index.js";

/** Default categories offered during onboarding (spec: Dining, Groceries, Snacks, …). */
export const DEFAULT_CATEGORIES: { name: string; budget: number }[] = [
  { name: "Dining", budget: 600 },
  { name: "Groceries", budget: 800 },
  { name: "Snacks", budget: 300 },
  { name: "Drinks", budget: 200 },
  { name: "Other", budget: 400 },
];

/** Common time zones surfaced as quick-pick buttons during onboarding. */
export const COMMON_TIMEZONES: string[] = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Tokyo",
];

/** A single "Back to menu" keyboard. */
export function backMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

/** A two-button row: Cancel + Back to menu. */
export function cancelBackMenu(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("Cancel", "setup:cancel")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

/** Build Category records from the default list with a given period. */
export function defaultCategories(period: "daily" | "weekly"): Category[] {
  return DEFAULT_CATEGORIES.map((c) => ({ ...c, period }));
}
