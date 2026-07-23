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

// Transaction logging — a guided, button-first flow: description → category
// (buttons) → calories (typed) → confirm → record. Reachable from the main menu
// ("➕ Log meal") and via the /log shortcut (free-form typed input the user
// already knows: a meal description).

registerMainMenuItem({ label: "➕ Log meal", data: "log:start", order: 10 });

const composer = new Composer<Ctx>();

composer.command("log", async (ctx) => {
  await startLog(ctx);
});

composer.callbackQuery("log:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await startLog(ctx);
});

async function startLog(ctx: Ctx): Promise<void> {
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.reply("Let's set up your tracker first — tap ⚙️ Setup to choose your time zone and budgets.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const cats = await getCategories(ctx.chat!.id);
  if (cats.length === 0) {
    await ctx.reply("You don't have any categories yet. Tap ⚙️ Setup to create some.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  ctx.session.log = { step: "desc" };
  await ctx.reply(
    "What did you have? Send a short description, like 'chicken salad' or 'morning coffee'.",
    { reply_markup: inlineKeyboard([[inlineButton("Cancel", "log:cancel")], [inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
}

async function askCategory(ctx: Ctx, desc: string): Promise<void> {
  const cats = await getCategories(ctx.chat!.id);
  ctx.session.log = { step: "category", desc };
  const rows = cats.map((c) => [inlineButton(c.name, `log:cat:${encodeURIComponent(c.name)}`)]);
  rows.push([inlineButton("Cancel", "log:cancel")]);
  await ctx.reply("Which category does it go in?", { reply_markup: inlineKeyboard(rows) });
}

async function askCalories(ctx: Ctx, desc: string, category: string): Promise<void> {
  ctx.session.log = { step: "calories", desc, category };
  await ctx.reply(`How many calories for "${desc}" in ${category}? Send a number.`, {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "log:cancel")]]),
  });
}

composer.callbackQuery(/^log:cat:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const log = ctx.session.log;
  if (log?.step !== "category" || !log.desc) return;
  const category = decodeURIComponent(ctx.callbackQuery.data.slice("log:cat:".length));
  await askCalories(ctx, log.desc, category);
});

async function askConfirm(ctx: Ctx): Promise<void> {
  const log = ctx.session.log!;
  ctx.session.log = {
    step: "confirm",
    desc: log.desc,
    category: log.category,
    calories: log.calories,
  };
  await ctx.reply(
    `Log this meal?\n\n${log.desc}\n${log.category} · ${log.calories} cal`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Confirm", "log:confirm:yes"), inlineButton("Cancel", "log:confirm:no")],
      ]),
    },
  );
}

composer.callbackQuery("log:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const log = ctx.session.log;
  if (log?.step !== "confirm" || log.calories == null || !log.category || !log.desc) {
    await ctx.reply("That log session expired. Tap ➕ Log meal to start again.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const profile = await getProfile(ctx.chat!.id);
  const txs = await getTransactions(ctx.chat!.id);
  const seq = profile?.txSeq ?? 0;
  const id = `t${seq}`;
  const tx: Transaction = {
    id,
    timestamp: now().getTime(),
    description: log.desc,
    category: log.category,
    calories: log.calories,
  };
  txs.push(tx);
  await setTransactions(ctx.chat!.id, txs);
  if (profile) {
    profile.txSeq = seq + 1;
    await setProfile(ctx.chat!.id, profile);
  }
  ctx.session.log = undefined;

  const cats = await getCategories(ctx.chat!.id);
  const statuses = budgetStatus(cats, txs, profile?.tz ?? "UTC");
  const notif = await getNotif(ctx.chat!.id);
  const alerts = notif ? lowBudgetCategories(statuses, notif.threshold) : [];

  const lines = [`Logged: ${tx.description} · ${tx.category} · ${tx.calories} cal`];
  if (alerts.length > 0) {
    lines.push("");
    lines.push("Heads up — you're low on:");
    for (const a of alerts) lines.push(`• ${statusLine(a)}`);
  }
  lines.push("");
  lines.push("Tap 📊 Status for your full budget, or ➕ Log meal to add another.");
  await ctx.reply(lines.join("\n"), { reply_markup: mainMenuKeyboard() });
});

composer.callbackQuery("log:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.log = undefined;
  await ctx.editMessageText("Log cancelled. Tap ➕ Log meal when you're ready.", {
    reply_markup: mainMenuKeyboard(),
  });
});

composer.callbackQuery("log:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.log = undefined;
  await ctx.editMessageText("Log cancelled.", { reply_markup: mainMenuKeyboard() });
});

// Free-form text inputs: the description and the calorie amount.
composer.on("message:text", async (ctx, next) => {
  const log = ctx.session.log;
  if (!log) return next();

  if (log.step === "desc") {
    const desc = ctx.message.text.trim();
    if (desc.length === 0) {
      await ctx.reply("Send a short description of what you had.");
      return;
    }
    await askCategory(ctx, desc.slice(0, 200));
    return;
  }

  if (log.step === "calories") {
    const n = Number(ctx.message.text.trim());
    if (!Number.isFinite(n) || n <= 0 || n > 100000 || !Number.isInteger(n)) {
      await ctx.reply("Send a whole number of calories (1–100000). Try again.");
      return;
    }
    log.calories = n;
    ctx.session.log = log;
    await askConfirm(ctx);
    return;
  }

  return next();
});

export default composer;
