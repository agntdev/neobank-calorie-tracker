import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import type { Category, NotifPref, Profile } from "../types.js";
import {
  getProfile,
  setCategories,
  setNotif,
  setProfile,
} from "../store.js";
import { isValidTimezone } from "../time.js";
import {
  COMMON_TIMEZONES,
  DEFAULT_CATEGORIES,
} from "../defaults.js";

// Onboarding — collects timezone, creates default categories, sets per-category
// budgets, and confirms the budget period (daily/weekly). Reachable from the
// /start main menu via the "⚙️ Setup" button (button-first; no slash command).

registerMainMenuItem({ label: "⚙️ Setup", data: "setup:start", order: 5 });

const composer = new Composer<Ctx>();

const DONE_MSG = "All set — your calorie tracker is ready. Tap /start anytime to log a meal or check your budget.";

// --- entry / status ---------------------------------------------------------

composer.callbackQuery("setup:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = await getProfile(ctx.chat!.id);
  if (profile?.onboarded) {
    await ctx.editMessageText(
      "You're already set up. Want to redo it? This keeps your logged meals but resets your budgets and time zone.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Redo setup", "setup:redo")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  await askTimezone(ctx);
});

composer.callbackQuery("setup:redo", async (ctx) => {
  await ctx.answerCallbackQuery();
  await askTimezone(ctx);
});

// --- step 1: time zone ------------------------------------------------------

async function askTimezone(ctx: Ctx): Promise<void> {
  ctx.session.onboard = { step: "tz" };
  const rows = COMMON_TIMEZONES.map((tz) => [
    inlineButton(tz, `setup:tz:${encodeURIComponent(tz)}`),
  ]);
  rows.push([inlineButton("Type my timezone", "setup:tz:type")]);
  rows.push([inlineButton("Cancel", "setup:cancel")]);
  await ctx.editMessageText(
    "First, your time zone — so budgets reset at the right local time. Pick yours or type it (e.g. Europe/London).",
    { reply_markup: inlineKeyboard(rows) },
  );
}

composer.callbackQuery("setup:tz:type", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.onboard = { step: "tztext" };
  await ctx.editMessageText(
    "Send your time zone as an IANA name (like America/Sao_Paulo or Asia/Kolkata).",
    { reply_markup: inlineKeyboard([[inlineButton("Cancel", "setup:cancel")], [inlineButton("⬅️ Back", "setup:start")]]) },
  );
});

composer.callbackQuery(/^setup:tz:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tz = decodeURIComponent(ctx.callbackQuery.data.slice("setup:tz:".length));
  if (!isValidTimezone(tz)) {
    await ctx.reply(`That time zone isn't recognized (${tz}). Try again or pick from the list.`);
    return;
  }
  await beginBudgets(ctx, tz);
});

// --- step 2: per-category budgets -------------------------------------------

async function beginBudgets(ctx: Ctx, tz: string): Promise<void> {
  ctx.session.onboard = { step: "budget", tz, idx: 0, budgets: {} };
  await renderBudgetPrompt(ctx);
}

async function renderBudgetPrompt(ctx: Ctx): Promise<void> {
  const ob = ctx.session.onboard!;
  const idx = ob.idx ?? 0;
  const def = DEFAULT_CATEGORIES[idx];
  if (!def) {
    await beginPeriod(ctx);
    return;
  }
  const filled = Object.keys(ob.budgets ?? {}).length;
  await ctx.editMessageText(
    `Set a daily calorie budget for ${def.name} (suggested ${def.budget}). Send a number, or use a button below. (${filled + 1}/${DEFAULT_CATEGORIES.length})`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(`Use ${def.budget}`, "setup:budget:default")],
        [inlineButton("Use all defaults", "setup:budget:alldefaults")],
        [inlineButton("Cancel", "setup:cancel")],
      ]),
    },
  );
}

async function beginPeriod(ctx: Ctx): Promise<void> {
  const ob = ctx.session.onboard!;
  ob.step = "period";
  ctx.session.onboard = ob;
  await ctx.editMessageText(
    "Last step — how often should budgets reset?",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Daily", "setup:period:daily")],
        [inlineButton("Weekly", "setup:period:weekly")],
        [inlineButton("Cancel", "setup:cancel")],
      ]),
    },
  );
}

composer.callbackQuery("setup:budget:default", async (ctx) => {
  await ctx.answerCallbackQuery();
  const ob = ctx.session.onboard;
  if (ob?.step !== "budget") return;
  const idx = ob.idx ?? 0;
  const def = DEFAULT_CATEGORIES[idx];
  if (!def) return beginPeriod(ctx);
  ob.budgets = { ...(ob.budgets ?? {}), [def.name]: def.budget };
  ob.idx = idx + 1;
  ctx.session.onboard = ob;
  await renderBudgetPrompt(ctx);
});

composer.callbackQuery("setup:budget:alldefaults", async (ctx) => {
  await ctx.answerCallbackQuery();
  const ob = ctx.session.onboard;
  if (ob?.step !== "budget") return;
  const budgets = { ...(ob.budgets ?? {}) };
  for (let i = ob.idx ?? 0; i < DEFAULT_CATEGORIES.length; i++) {
    budgets[DEFAULT_CATEGORIES[i].name] = DEFAULT_CATEGORIES[i].budget;
  }
  ob.budgets = budgets;
  ob.idx = DEFAULT_CATEGORIES.length;
  ctx.session.onboard = ob;
  await beginPeriod(ctx);
});

// --- step 3: confirm period + finalize -------------------------------------

composer.callbackQuery(/^setup:period:(daily|weekly)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ob = ctx.session.onboard;
  if (ob?.step !== "period") return;
  const period = ctx.callbackQuery.data.slice("setup:period:".length) as "daily" | "weekly";
  const tz = ob.tz ?? "UTC";
  const budgets = ob.budgets ?? {};
  const cats: Category[] = DEFAULT_CATEGORIES.map((d) => ({
    name: d.name,
    budget: budgets[d.name] ?? d.budget,
    period,
  }));
  const profile: Profile = { tz, period, onboarded: true };
  const notif: NotifPref = {
    enabled: true,
    summaryTime: "08:00",
    threshold: 0.15,
  };
  await setProfile(ctx.chat!.id, profile);
  await setCategories(ctx.chat!.id, cats);
  await setNotif(ctx.chat!.id, notif);
  ctx.session.onboard = undefined;
  await ctx.editMessageText(DONE_MSG, { reply_markup: mainMenuKeyboard() });
});

// --- cancel -----------------------------------------------------------------

composer.callbackQuery("setup:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.onboard = undefined;
  await ctx.editMessageText("Setup cancelled. Tap ⚙️ Setup whenever you're ready.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// --- free-form text inputs (timezone + budget numbers) ---------------------

composer.on("message:text", async (ctx, next) => {
  const ob = ctx.session.onboard;
  if (!ob) return next();

  if (ob.step === "tztext") {
    const tz = ctx.message.text.trim();
    if (!isValidTimezone(tz)) {
      await ctx.reply(`That time zone isn't recognized (${tz}). Try an IANA name like Europe/London.`);
      return;
    }
    await beginBudgets(ctx, tz);
    return;
  }

  if (ob.step === "budget") {
    const n = Number(ctx.message.text.trim());
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      await ctx.reply("Send a whole number of calories (0–100000). Try again.");
      return;
    }
    const idx = ob.idx ?? 0;
    const def = DEFAULT_CATEGORIES[idx];
    if (!def) {
      await beginPeriod(ctx);
      return;
    }
    ob.budgets = { ...(ob.budgets ?? {}), [def.name]: Math.round(n) };
    ob.idx = idx + 1;
    ctx.session.onboard = ob;
    await renderBudgetPrompt(ctx);
    return;
  }

  return next();
});

export default composer;
