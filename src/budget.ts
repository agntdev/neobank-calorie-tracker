// Budget computation shared across features: status per category, trend sums,
// and low-budget alert detection. All derived from the chat's stored
// transactions (recalculated live — so edits/deletes are reflected instantly,
// the "Budget recalculation after transaction edits" requirement).

import type { BudgetPeriod, BudgetStatus, Category, Transaction } from "./types.js";
import { currentPeriodKey, lastNDayKeys, localYMD, now, periodKey } from "./time.js";

/** Sum calories of transactions in `txs` for `category` whose period key matches `key`. */
function sumForPeriod(
  txs: Transaction[],
  category: string,
  tz: string,
  period: BudgetPeriod,
  key: string,
): number {
  let sum = 0;
  for (const t of txs) {
    if (t.category.toLowerCase() !== category.toLowerCase()) continue;
    if (periodKey(t.timestamp, tz, period) === key) sum += t.calories;
  }
  return sum;
}

/** Current-period status for every category, in stored order. */
export function budgetStatus(
  cats: Category[],
  txs: Transaction[],
  tz: string,
  at: Date = now(),
): BudgetStatus[] {
  return cats.map((c) => {
    const key = currentPeriodKey(tz, c.period, at);
    const consumed = sumForPeriod(txs, c.name, tz, c.period, key);
    const remaining = c.budget - consumed;
    const ratio = c.budget > 0 ? remaining / c.budget : 0;
    return { name: c.name, period: c.period, budget: c.budget, consumed, remaining, ratio };
  });
}

/** Total consumed per calendar day across ALL categories for the last N days. */
export function dailyTotals(
  txs: Transaction[],
  n: number,
  tz: string,
  at: Date = now(),
): { day: string; total: number }[] {
  const keys = lastNDayKeys(n, tz, at);
  const map = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const t of txs) {
    const { y, m, d } = localYMD(new Date(t.timestamp), tz);
    const k = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + t.calories);
  }
  return keys.map((k) => ({ day: k, total: map.get(k) ?? 0 }));
}

/** Categories whose remaining calories are below a threshold fraction. */
export function lowBudgetCategories(
  statuses: BudgetStatus[],
  threshold: number,
): BudgetStatus[] {
  return statuses.filter((s) => s.budget > 0 && s.ratio < threshold);
}

/** Find a category by name (case-insensitive) or undefined. */
export function findCategory(cats: Category[], name: string): Category | undefined {
  return cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

/** A short, professional one-line summary of a category's status. */
export function statusLine(s: BudgetStatus): string {
  const pct = s.budget > 0 ? Math.round(s.ratio * 100) : 0;
  const periodTag = s.period === "weekly" ? " (weekly)" : "";
  return `${s.name}${periodTag}: ${s.consumed}/${s.budget} cal — ${s.remaining} left (${pct}%)`;
}
