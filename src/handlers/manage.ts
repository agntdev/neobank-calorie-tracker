import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import {
  getCategories,
  getNotif,
  getProfile,
  getTransactions,
  setCategories,
  setTransactions,
  wipeAll,
} from "../store.js";

// Owner controls — edit/delete transactions, adjust category budgets, export
// data, and delete all data. Reachable from the "🧾 Manage" menu button.

registerMainMenuItem({ label: "🧾 Manage", data: "manage:show", order: 50 });

const composer = new Composer<Ctx>();

const MAX_TX = 8;

composer.callbackQuery("manage:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.editMessageText("Set up your tracker first — tap ⚙️ Setup.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  await ctx.editMessageText(
    "Manage your tracker:",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Transactions", "manage:txs")],
        [inlineButton("Category budgets", "manage:cat")],
        [inlineButton("Export data", "manage:export")],
        [inlineButton("Delete all data", "manage:wipe")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// --- transactions: list + delete -------------------------------------------

composer.callbackQuery("manage:txs", async (ctx) => {
  await ctx.answerCallbackQuery();
  const txs = await getTransactions(ctx.chat!.id);
  const recent = txs.slice(-MAX_TX).reverse();
  if (recent.length === 0) {
    await ctx.editMessageText("No transactions yet — tap ➕ Log meal to add one.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "manage:show")]]),
    });
    return;
  }
  const rows = recent.map((t) => {
    const date = new Date(t.timestamp).toISOString().slice(0, 10);
    return [
      inlineButton(
        `${date} · ${t.calories} cal · ${t.category}`,
        `manage:tx:${encodeURIComponent(t.id)}`,
      ),
    ];
  });
  rows.push([inlineButton("⬅️ Back", "manage:show")]);
  await ctx.editMessageText("Tap a transaction to edit or delete it.", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^manage:tx:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = decodeURIComponent(ctx.callbackQuery.data.slice("manage:tx:".length));
  const txs = await getTransactions(ctx.chat!.id);
  const tx = txs.find((t) => t.id === id);
  if (!tx) {
    await ctx.editMessageText("That transaction no longer exists.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "manage:txs")]]),
    });
    return;
  }
  const date = new Date(tx.timestamp).toISOString().slice(0, 10);
  await ctx.editMessageText(
    [
      `${date} · ${tx.category} · ${tx.calories} cal`,
      `"${tx.description}"`,
      "",
      "Delete it, or edit the calorie amount?",
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Edit calories", `manage:edit:${encodeURIComponent(tx.id)}`)],
        [inlineButton("Delete", `manage:del:${encodeURIComponent(tx.id)}`)],
        [inlineButton("⬅️ Back", "manage:txs")],
      ]),
    },
  );
});

composer.callbackQuery(/^manage:edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = decodeURIComponent(ctx.callbackQuery.data.slice("manage:edit:".length));
  ctx.session.editId = id;
  await ctx.reply("Send the new calorie amount (a whole number).", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "manage:show")]]),
  });
});

composer.callbackQuery(/^manage:del:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = decodeURIComponent(ctx.callbackQuery.data.slice("manage:del:".length));
  await ctx.editMessageText("Delete this transaction? This can't be undone.", {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Yes, delete", `manage:delyes:${encodeURIComponent(id)}`)],
      [inlineButton("Cancel", "manage:txs")],
    ]),
  });
});

composer.callbackQuery(/^manage:delyes:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = decodeURIComponent(ctx.callbackQuery.data.slice("manage:delyes:".length));
  const txs = await getTransactions(ctx.chat!.id);
  const next = txs.filter((t) => t.id !== id);
  await setTransactions(ctx.chat!.id, next);
  await ctx.editMessageText("Deleted. Your budget is recalculated.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to transactions", "manage:txs")]]),
  });
});

// --- category budgets: list + adjust ---------------------------------------

composer.callbackQuery("manage:cat", async (ctx) => {
  await ctx.answerCallbackQuery();
  const cats = await getCategories(ctx.chat!.id);
  if (cats.length === 0) {
    await ctx.editMessageText("No categories yet — tap ⚙️ Setup to add some.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "manage:show")]]),
    });
    return;
  }
  const rows = cats.map((c, i) => [
    inlineButton(`${c.name}: ${c.budget} cal`, `manage:adj:${i}`),
  ]);
  rows.push([inlineButton("⬅️ Back", "manage:show")]);
  await ctx.editMessageText("Tap a category to change its budget.", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^manage:adj:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const idx = Number(ctx.callbackQuery.data.slice("manage:adj:".length));
  const cats = await getCategories(ctx.chat!.id);
  const c = cats[idx];
  if (!c) {
    await ctx.editMessageText("That category no longer exists.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "manage:cat")]]),
    });
    return;
  }
  ctx.session.adjust = { idx };
  await ctx.reply(`Current budget for ${c.name}: ${c.budget} cal (${c.period}). Send the new budget as a number.`, {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "manage:cat")]]),
  });
});

// --- export + wipe ----------------------------------------------------------

composer.callbackQuery("manage:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  const [profile, cats, txs, notif] = await Promise.all([
    getProfile(ctx.chat!.id),
    getCategories(ctx.chat!.id),
    getTransactions(ctx.chat!.id),
    getNotif(ctx.chat!.id),
  ]);
  const lines: string[] = ["Your data export:"];
  lines.push("");
  lines.push(`Time zone: ${profile?.tz ?? "-"}`);
  lines.push(`Period: ${profile?.period ?? "-"}`);
  lines.push("");
  lines.push("Categories:");
  for (const c of cats) lines.push(`- ${c.name}: ${c.budget} cal (${c.period})`);
  lines.push("");
  lines.push(`Transactions (${txs.length}):`);
  for (const t of txs) {
    const d = new Date(t.timestamp).toISOString();
    lines.push(`- ${d} · ${t.calories} cal · ${t.category} · ${t.description}`);
  }
  lines.push("");
  if (notif) {
    lines.push(
      `Alerts: ${notif.enabled ? "on" : "off"}, summary ${notif.summaryTime}, threshold ${Math.round(notif.threshold * 100)}%`,
    );
  }
  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "manage:show")]]),
  });
});

composer.callbackQuery("manage:wipe", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Delete ALL your data (profile, categories, transactions, alerts)? This can't be undone.", {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Yes, delete everything", "manage:wipe:yes")],
      [inlineButton("Cancel", "manage:show")],
    ]),
  });
});

composer.callbackQuery("manage:wipe:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  await wipeAll(ctx.chat!.id);
  await ctx.editMessageText("All your data has been deleted. Tap ⚙️ Setup to start over.", {
    reply_markup: mainMenuKeyboard(),
  });
});

// --- free-form text: adjust budget OR edit a transaction's calories --------

composer.on("message:text", async (ctx, next) => {
  const adjust = ctx.session.adjust;
  const editId = ctx.session.editId;

  if (editId) {
    const n = Number(ctx.message.text.trim());
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(n)) {
      await ctx.reply("Send a whole number of calories (0–100000). Try again.");
      return;
    }
    const txs = await getTransactions(ctx.chat!.id);
    const tx = txs.find((t) => t.id === editId);
    if (!tx) {
      ctx.session.editId = undefined;
      await ctx.reply("That transaction no longer exists.", { reply_markup: mainMenuKeyboard() });
      return;
    }
    tx.calories = n;
    await setTransactions(ctx.chat!.id, txs);
    ctx.session.editId = undefined;
    await ctx.reply(`Updated: ${tx.description} is now ${tx.calories} cal.`, {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  if (adjust?.idx != null) {
    const n = Number(ctx.message.text.trim());
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(n)) {
      await ctx.reply("Send a whole number of calories (0–100000). Try again.");
      return;
    }
    const cats = await getCategories(ctx.chat!.id);
    const c = cats[adjust.idx];
    if (!c) {
      ctx.session.adjust = undefined;
      await ctx.reply("That category no longer exists.", { reply_markup: mainMenuKeyboard() });
      return;
    }
    c.budget = n;
    await setCategories(ctx.chat!.id, cats);
    ctx.session.adjust = undefined;
    await ctx.reply(`${c.name} budget is now ${n} cal.`, { reply_markup: mainMenuKeyboard() });
    return;
  }

  return next();
});

export default composer;
