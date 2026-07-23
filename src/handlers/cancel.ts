import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";

// /cancel — abort any in-progress flow (onboarding, log, quick log, alerts,
// manage) and return to the main menu. A button-first bot rarely needs this,
// but it's a clean power-user escape hatch from a stuck typed-input step.

const composer = new Composer<Ctx>();

composer.command("cancel", async (ctx) => {
  ctx.session.onboard = undefined;
  ctx.session.log = undefined;
  ctx.session.quick = undefined;
  ctx.session.notif = undefined;
  ctx.session.adjust = undefined;
  ctx.session.editId = undefined;
  await ctx.reply("Cancelled. Tap a button to continue.", { reply_markup: mainMenuKeyboard() });
});

export default composer;
