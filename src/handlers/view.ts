import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import { getCategories, getProfile, getTransactions } from "../store.js";
import { budgetStatus, dailyTotals, findCategory, statusLine } from "../budget.js";
import { now } from "../time.js";

// Budget status view — remaining calories per category for the current period,
// with optional 7/30-day trend. Reachable from the "📊 Status" menu button and
// the /view command (which accepts an optional category filter as typed input).

registerMainMenuItem({ label: "📊 Status", data: "view:show", order: 30 });

const composer = new Composer<Ctx>();

composer.command("view", async (ctx) => {
  const arg = ctx.match?.toString().trim();
  await showStatus(ctx, arg || undefined, /*edit*/ false);
});

composer.callbackQuery("view:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showStatus(ctx, undefined, /*edit*/ true);
});

async function showStatus(ctx: Ctx, filter: string | undefined, edit: boolean): Promise<void> {
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    const msg = "Set up your tracker first — tap ⚙️ Setup to choose your budgets.";
    if (edit) await ctx.editMessageText(msg, { reply_markup: mainMenuKeyboard() });
    else await ctx.reply(msg, { reply_markup: mainMenuKeyboard() });
    return;
  }
  const cats = await getCategories(ctx.chat!.id);
  const txs = await getTransactions(ctx.chat!.id);
  const statuses = budgetStatus(cats, txs, profile.tz, now());
  const target = filter ? findCategory(cats, filter) : undefined;

  const kb = inlineKeyboard([
    [inlineButton("7-day trend", "view:trend:7"), inlineButton("30-day trend", "view:trend:30")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);

  if (filter && !target) {
    const msg = `Couldn't find a category called "${filter}". Try /view to see all of them.`;
    if (edit) await ctx.editMessageText(msg, { reply_markup: kb });
    else await ctx.reply(msg, { reply_markup: kb });
    return;
  }

  const shown = target ? statuses.filter((s) => s.name === target.name) : statuses;
  const lines: string[] = [];
  lines.push("Here's your budget for this period:");
  lines.push("");
  if (shown.length === 0) {
    lines.push("No categories set up yet — tap ⚙️ Setup to add some.");
  } else {
    for (const s of shown) lines.push(statusLine(s));
  }
  const total = shown.reduce((acc, s) => acc + s.consumed, 0);
  lines.push("");
  lines.push(`Total logged this period: ${total} cal`);

  const msg = lines.join("\n");
  if (edit) await ctx.editMessageText(msg, { reply_markup: kb });
  else await ctx.reply(msg, { reply_markup: kb });
}

composer.callbackQuery(/^view:trend:(7|30)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.editMessageText("Set up your tracker first — tap ⚙️ Setup.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const n = Number(ctx.callbackQuery.data.slice("view:trend:".length));
  const txs = await getTransactions(ctx.chat!.id);
  const days = dailyTotals(txs, n, profile.tz, now());
  const total = days.reduce((acc, d) => acc + d.total, 0);
  const avg = days.length > 0 ? Math.round(total / days.length) : 0;

  const lines: string[] = [`Last ${n} days — total ${total} cal · avg ${avg}/day`];
  lines.push("");
  for (const d of days) {
    const bar = "█".repeat(Math.min(20, Math.round((d.total / Math.max(1, avg || 1)) * 4)));
    lines.push(`${d.day}  ${bar || "·"} ${d.total}`);
  }
  lines.push("");
  lines.push("Tap 📊 Status for your current budget.");
  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [inlineButton("7-day trend", "view:trend:7"), inlineButton("30-day trend", "view:trend:30")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
