import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  mainMenuKeyboard,
  registerMainMenuItem,
} from "../toolkit/index.js";
import type { NotifPref } from "../types.js";
import {
  getCategories,
  getNotif,
  getProfile,
  getTransactions,
  setNotif,
} from "../store.js";
import { budgetStatus, statusLine } from "../budget.js";
import { parseTime } from "../time.js";

// Notification management — store preferences (enable/disable, daily summary
// time, low-budget threshold) and deliver an on-demand summary. Low-budget
// alerts are also surfaced inline after each log (see log-start / quicklog).
//
// Scheduled delivery of the daily summary at the chosen local time requires
// the Cloudflare Workers Durable-Object alarm runtime (remindAt), which is
// not part of the Node build; the preference is stored and the summary is
// available on demand here. (Scheduling gap noted for the owner.)

registerMainMenuItem({ label: "🔔 Alerts", data: "notif:show", order: 40 });

const composer = new Composer<Ctx>();

const TIME_PRESETS = ["06:00", "07:00", "08:00", "09:00", "20:00", "21:00"];
const THRESHOLDS = [10, 15, 20, 25];

composer.callbackQuery("notif:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.editMessageText("Set up your tracker first — tap ⚙️ Setup.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const notif = await ensureNotif(ctx);
  const enabledLabel = notif.enabled ? "✅ Alerts on" : "🚫 Alerts off";
  await ctx.editMessageText(
    [
      "Your alert settings:",
      `• Daily summary: ${notif.summaryTime} (your time zone)`,
      `• Low-budget alert: when a category drops below ${Math.round(notif.threshold * 100)}%`,
      `• Status: ${notif.enabled ? "on" : "off"}`,
    ].join("\n"),
    {
      reply_markup: inlineKeyboard([
        [inlineButton(enabledLabel, "notif:toggle")],
        [inlineButton("Summary time", "notif:time")],
        [inlineButton("Alert threshold", "notif:thr")],
        [inlineButton("Send summary now", "notif:now")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

async function ensureNotif(ctx: Ctx): Promise<NotifPref> {
  const existing = await getNotif(ctx.chat!.id);
  if (existing) return existing;
  const fresh: NotifPref = { enabled: true, summaryTime: "08:00", threshold: 0.15 };
  await setNotif(ctx.chat!.id, fresh);
  return fresh;
}

composer.callbackQuery("notif:toggle", async (ctx) => {
  await ctx.answerCallbackQuery();
  const notif = await ensureNotif(ctx);
  notif.enabled = !notif.enabled;
  await setNotif(ctx.chat!.id, notif);
  await ctx.editMessageText(
    `Alerts are now ${notif.enabled ? "on" : "off"}.`,
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to alerts", "notif:show")], [inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
});

composer.callbackQuery("notif:time", async (ctx) => {
  await ctx.answerCallbackQuery();
  const rows = TIME_PRESETS.map((t) => [inlineButton(t, `notif:time:set:${encodeURIComponent(t)}`)]);
  rows.push([inlineButton("Type a time", "notif:time:type")]);
  rows.push([inlineButton("⬅️ Back", "notif:show")]);
  await ctx.editMessageText("When should your daily summary arrive? (your local time)", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery("notif:time:type", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.notif = { step: "time" };
  await ctx.editMessageText("Send the time as HH:mm (24-hour), like 08:00 or 21:30.", {
    reply_markup: inlineKeyboard([[inlineButton("Cancel", "notif:show")]]),
  });
});

composer.callbackQuery(/^notif:time:set:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const t = decodeURIComponent(ctx.callbackQuery.data.slice("notif:time:set:".length));
  const parsed = parseTime(t);
  if (!parsed) {
    await ctx.reply("That time isn't valid. Use HH:mm like 08:00.");
    return;
  }
  const notif = await ensureNotif(ctx);
  notif.summaryTime = t;
  await setNotif(ctx.chat!.id, notif);
  await ctx.editMessageText(`Daily summary set for ${t} (your local time).`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to alerts", "notif:show")]]),
  });
});

composer.callbackQuery("notif:thr", async (ctx) => {
  await ctx.answerCallbackQuery();
  const notif = await ensureNotif(ctx);
  const rows = THRESHOLDS.map((p) => [
    inlineButton(
      `${p}%${Math.round(notif.threshold * 100) === p ? " ✓" : ""}`,
      `notif:thrset:${p}`,
    ),
  ]);
  rows.push([inlineButton("⬅️ Back", "notif:show")]);
  await ctx.editMessageText("Alert me when a category drops below…", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^notif:thrset:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const pct = Number(ctx.callbackQuery.data.slice("notif:thrset:".length));
  const notif = await ensureNotif(ctx);
  notif.threshold = pct / 100;
  await setNotif(ctx.chat!.id, notif);
  await ctx.editMessageText(`Low-budget alert threshold set to ${pct}%.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to alerts", "notif:show")]]),
  });
});

composer.callbackQuery("notif:now", async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendSummary(ctx);
});

async function sendSummary(ctx: Ctx): Promise<void> {
  const profile = await getProfile(ctx.chat!.id);
  if (!profile?.onboarded) {
    await ctx.editMessageText("Set up your tracker first — tap ⚙️ Setup.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const cats = await getCategories(ctx.chat!.id);
  const txs = await getTransactions(ctx.chat!.id);
  const statuses = budgetStatus(cats, txs, profile.tz);
  const total = statuses.reduce((a, s) => a + s.consumed, 0);
  const lines = ["Here's your daily summary:"];
  lines.push("");
  if (statuses.length === 0) {
    lines.push("No categories set up yet — tap ⚙️ Setup.");
  } else {
    for (const s of statuses) lines.push(statusLine(s));
  }
  lines.push("");
  lines.push(`Total this period: ${total} cal`);
  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to alerts", "notif:show")], [inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
}

// Free-form text input: the daily-summary time (HH:mm).
composer.on("message:text", async (ctx, next) => {
  const n = ctx.session.notif;
  if (n?.step !== "time") return next();
  const parsed = parseTime(ctx.message.text.trim());
  if (!parsed) {
    await ctx.reply("That time isn't valid. Use HH:mm like 08:00.");
    return;
  }
  const notif = await ensureNotif(ctx);
  notif.summaryTime = ctx.message.text.trim();
  await setNotif(ctx.chat!.id, notif);
  ctx.session.notif = undefined;
  await ctx.reply(`Daily summary set for ${notif.summaryTime} (your local time).`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to alerts", "notif:show")]]),
  });
});

export default composer;
