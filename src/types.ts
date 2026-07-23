// Domain entities for the calorie tracker. All durable data — these records
// live in the toolkit's persistent store (Redis in production, in-memory in
// dev/tests via resolveSessionStorage), keyed per chat, NEVER in module-level
// maps. See src/store.ts.

export type BudgetPeriod = "daily" | "weekly";

/** User Profile — preferences + onboarding state. */
export interface Profile {
  tz: string;
  period: BudgetPeriod;
  onboarded: boolean;
  /** Monotonic counter for transaction ids (avoids collisions after deletes). */
  txSeq?: number;
}

/** Category — a calorie budget slot with its own period. */
export interface Category {
  name: string;
  budget: number;
  period: BudgetPeriod;
}

/** Transaction — one logged meal/purchase. */
export interface Transaction {
  id: string;
  timestamp: number;
  description: string;
  category: string;
  calories: number;
}

/** Notification Preference — alert settings. */
export interface NotifPref {
  enabled: boolean;
  /** "HH:mm" local-time daily summary, e.g. "08:00". */
  summaryTime: string;
  /** Low-budget alert threshold as a fraction of budget (0–1), e.g. 0.15. */
  threshold: number;
}

/** A computed view of a category's current-period budget status. */
export interface BudgetStatus {
  name: string;
  period: BudgetPeriod;
  budget: number;
  consumed: number;
  remaining: number;
  /** Fraction of budget remaining (0–1). */
  ratio: number;
}
