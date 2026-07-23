import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import type { NotifPref, Transaction } from "../types.js";
import {
  getCategories,
  getNotif,
  getProfile,
  getTransactions,
  setProfile,
  setTransactions,
} from "../store.js";
import { budgetStatus, lowBudgetCategories, statusLine } from "../budget.js";
import { now } from "../time.js";

// Quick log — one tap for a preset amount, then a category (recent ones first).
// For repeat meals where you just want to record a known calorie number fast.

registerMainMenuItem({ label: "⚡ Quick log", data: "quicklog:show", order: 20 });

const composer = new Composer<Ctx>();

const PRESET_AMOUNTS = [50, 100, 200, 300, 500];

composer.callbackQuery("quicklog:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.editMessageText("Set up your tracker first — tap ⚙️ Setup.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const rows = PRESET_AMOUNTS.map((a) => [
    inlineButton(`${a} cal`, `quicklog:amt:${a}`),
  ]);
  rows.push([inlineButton("Cancel", "quicklog:cancel")]);
  await ctx.editMessageText("Pick a calorie amount to log fast:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^quicklog:amt:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const calories = Number(ctx.callbackQuery.data.slice("quicklog:amt:".length));
  ctx.session.quick = { calories };
  await askQuickCategory(ctx, calories);
});

async function askQuickCategory(ctx: Ctx, calories: number): Promise<void> {
  const cats = await getCategories(ctx.chat!.id);
  const txs = await getTransactions(ctx.chat!.id);
  const recent = recentCategories(txs, cats);
  const ordered = recent.length > 0 ? recent : cats.map((c) => c.name);
  const rows = ordered.map((name) => [
    inlineButton(`${name} · ${calories}`, `quicklog:cat:${encodeURIComponent(name)}`),
  ]);
  rows.push([inlineButton("Cancel", "quicklog:cancel")]);
  await ctx.editMessageText(`${calories} cal — which category?`, {
    reply_markup: inlineKeyboard(rows),
  });
}

/** Distinct category names from most-recent transactions, limited to known categories. */
function recentCategories(txs: Transaction[], cats: { name: string }[]): string[] {
  const known = new Set(cats.map((c) => c.name.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = txs.length - 1; i >= 0 && out.length < 6; i--) {
    const name = txs[i].category;
    const key = name.toLowerCase();
    if (known.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

composer.callbackQuery(/^quicklog:cat:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const quick = ctx.session.quick;
  if (quick?.calories == null) {
    await ctx.editMessageText("That quick-log expired. Tap ⚡ Quick log to start again.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const category = decodeURIComponent(ctx.callbackQuery.data.slice("quicklog:cat:".length));
  const profile = await getProfile(ctx.chat!.id);
  const txs = await getTransactions(ctx.chat!.id);
  const seq = profile?.txSeq ?? 0;
  const id = `t${seq}`;
  const tx: Transaction = {
    id,
    timestamp: now().getTime(),
    description: "Quick log",
    category,
    calories: quick.calories,
  };
  txs.push(tx);
  await setTransactions(ctx.chat!.id, txs);
  if (profile) {
    profile.txSeq = seq + 1;
    await setProfile(ctx.chat!.id, profile);
  }
  ctx.session.quick = undefined;

  const cats = await getCategories(ctx.chat!.id);
  const statuses = budgetStatus(cats, txs, profile?.tz ?? "UTC");
  const notif = await getNotif(ctx.chat!.id);
  const alerts = notif ? lowBudgetCategories(statuses, notif.threshold) : [];

  const lines = [`Logged: ${tx.calories} cal in ${tx.category}`];
  if (alerts.length > 0) {
    lines.push("");
    lines.push("Heads up — you're low on:");
    for (const a of alerts) lines.push(`• ${statusLine(a)}`);
  }
  lines.push("");
  lines.push("Tap 📊 Status for your full budget.");
  await ctx.editMessageText(lines.join("\n"), { reply_markup: mainMenuKeyboard() });
});

composer.callbackQuery("quicklog:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.quick = undefined;
  await ctx.editMessageText("Quick log cancelled.", { reply_markup: mainMenuKeyboard() });
});

export default composer;
