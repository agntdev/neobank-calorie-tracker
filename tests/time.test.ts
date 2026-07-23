import { describe, it, expect, afterEach } from "vitest";
import {
  currentPeriodKey,
  isValidTimezone,
  localWallToEpoch,
  nextLocalTimeMs,
  periodKey,
  setClock,
  resetClock,
} from "../src/time.js";
import { budgetStatus, dailyTotals } from "../src/budget.js";
import type { Category, Transaction } from "../src/types.js";

afterEach(() => resetClock());

describe("time utilities", () => {
  it("validates IANA timezone names", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Not/A Zone")).toBe(false);
  });

  it("daily period key is the local calendar date", () => {
    // 2024-06-01 23:30 UTC = 2024-06-02 00:30 in Europe/Berlin (UTC+2).
    const t = Date.UTC(2024, 5, 1, 23, 30);
    expect(periodKey(t, "UTC", "daily")).toBe("2024-06-01");
    expect(periodKey(t, "Europe/Berlin", "daily")).toBe("2024-06-02");
    // Same instant, different local day → different daily key (tz transition boundary).
  });

  it("weekly period key is the Monday of the local week (Monday→Sunday weeks)", () => {
    // 2024-06-02 is a Sunday; Monday of that week is 2024-05-27.
    const sun = Date.UTC(2024, 5, 2, 12, 0);
    expect(periodKey(sun, "UTC", "weekly")).toBe("2024-05-27");
    // Wednesday 2024-06-05 is in the next week → Monday 2024-06-03.
    const wed = Date.UTC(2024, 5, 5, 12, 0);
    expect(periodKey(wed, "UTC", "weekly")).toBe("2024-06-03");
  });

  it("nextLocalTimeMs finds the next 08:00 in the given timezone", () => {
    // Fix the clock at 2024-06-01 07:00 UTC = 09:00 Berlin. Next 08:00 Berlin
    // is the following day (08:00 Berlin = 06:00 UTC on 2024-06-02).
    setClock(() => new Date(Date.UTC(2024, 5, 1, 7, 0)));
    const fromMs = Date.UTC(2024, 5, 1, 7, 0);
    const next = nextLocalTimeMs("Europe/Berlin", 8, 0, fromMs);
    // 08:00 Berlin on 2024-06-02 = 06:00 UTC.
    expect(new Date(next).toISOString()).toBe("2024-06-02T06:00:00.000Z");
  });

  it("localWallToEpoch round-trips a local wall time to the correct instant", () => {
    // 2024-06-01 08:00 Berlin (UTC+2, DST) = 06:00 UTC.
    const epoch = localWallToEpoch(2024, 6, 1, 8, 0, "Europe/Berlin");
    expect(new Date(epoch).toISOString()).toBe("2024-06-01T06:00:00.000Z");
    // In January (no DST) Berlin is UTC+1: 08:00 Berlin = 07:00 UTC.
    const winter = localWallToEpoch(2024, 1, 15, 8, 0, "Europe/Berlin");
    expect(new Date(winter).toISOString()).toBe("2024-01-15T07:00:00.000Z");
  });
});

describe("budget computation across time zones", () => {
  const cats: Category[] = [
    { name: "Dining", budget: 600, period: "daily" },
    { name: "Snacks", budget: 300, period: "daily" },
  ];

  it("counts a transaction in the period of its local day", () => {
    // A meal logged at 23:30 UTC on 2024-06-01 belongs to 2024-06-02 in Berlin.
    const txs: Transaction[] = [
      {
        id: "t0",
        timestamp: Date.UTC(2024, 5, 1, 23, 30),
        description: "late dinner",
        category: "Dining",
        calories: 400,
      },
    ];
    // At 2024-06-01 12:00 UTC (still June 1 in Berlin) → meal is "tomorrow" → not yet counted.
    setClock(() => new Date(Date.UTC(2024, 5, 1, 12, 0)));
    const statusUtcDay1 = budgetStatus(cats, txs, "Europe/Berlin");
    const diningDay1 = statusUtcDay1.find((s) => s.name === "Dining")!;
    expect(diningDay1.consumed).toBe(0);
    expect(diningDay1.remaining).toBe(600);

    // After local midnight (2024-06-02 Berlin = 2024-06-01 22:00 UTC) → counted.
    setClock(() => new Date(Date.UTC(2024, 5, 2, 0, 30)));
    const statusUtcDay2 = budgetStatus(cats, txs, "Europe/Berlin");
    const diningDay2 = statusUtcDay2.find((s) => s.name === "Dining")!;
    expect(diningDay2.consumed).toBe(400);
    expect(diningDay2.remaining).toBe(200);
  });

  it("dailyTotals groups by local calendar day", () => {
    const txs: Transaction[] = [
      { id: "a", timestamp: Date.UTC(2024, 5, 1, 23, 30), description: "x", category: "Dining", calories: 100 },
      { id: "b", timestamp: Date.UTC(2024, 5, 2, 0, 30), description: "y", category: "Dining", calories: 250 },
    ];
    setClock(() => new Date(Date.UTC(2024, 5, 3, 12, 0)));
    const totals = dailyTotals(txs, 3, "Europe/Berlin");
    // 23:30 UTC Jun1 → Jun2 Berlin; 00:30 UTC Jun2 → Jun2 Berlin. Both land on 2024-06-02.
    const jun2 = totals.find((d) => d.day === "2024-06-02")!;
    expect(jun2.total).toBe(350);
  });

  it("currentPeriodKey respects the injectable clock", () => {
    setClock(() => new Date(Date.UTC(2024, 5, 1, 12, 0)));
    expect(currentPeriodKey("UTC", "daily")).toBe("2024-06-01");
    expect(currentPeriodKey("America/Los_Angeles", "daily")).toBe("2024-06-01");
  });
});
