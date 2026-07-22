import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getStore, type UserRecord } from "../store.js";

// Profile settings — edit timezone and milestone preferences.
// Entry: "⚙️ Settings" button on the main menu (user:edit callback).

registerMainMenuItem({ label: "⚙️ Settings", data: "user:edit", order: 50 });

const composer = new Composer<Ctx>();

const DEFAULT_MILESTONES = [7, 21, 60];

// ── Ensure user record exists ────────────────────────────────────────────────
async function ensureUser(store: ReturnType<typeof getStore>, userId: number): Promise<UserRecord> {
  let user = await store.getUser(userId);
  if (!user) {
    user = {
      telegram_id: userId,
      timezone: "UTC",
      milestone_preferences: [...DEFAULT_MILESTONES],
      default_reminder_time: "09:00",
    };
    await store.setUser(user);
  }
  return user;
}

// ── Entry point ──────────────────────────────────────────────────────────────
composer.callbackQuery("user:edit", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await ensureUser(store, userId);
  await ctx.editMessageText(
    `Your settings:\n\n` +
    `Timezone: ${user.timezone}\n` +
    `Milestones: ${user.milestone_preferences.join(", ")} days`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Change timezone", "ue:tz")],
        [inlineButton("Change milestones", "ue:ms")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

// ── Timezone editing ─────────────────────────────────────────────────────────
composer.callbackQuery("ue:tz", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "ue_awaiting_timezone";
  await ctx.reply(
    "What's your timezone? Enter an offset like UTC+5, UTC-8, or a city name like Europe/London.",
    {
      reply_markup: { force_reply: true, input_field_placeholder: "e.g. UTC+2 or America/New_York" },
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "ue_awaiting_timezone") return next();

  const text = ctx.message.text.trim();
  // Accept UTC±N or common timezone names
  const tzMatch = /^UTC([+-]\d{1,2})?$/.exec(text);
  const validTimezone = tzMatch || /^[A-Z][a-z]+\/[A-Z][a-z_]+/.test(text) || text === "UTC";

  if (!validTimezone) {
    await ctx.reply("Please enter a valid timezone like UTC, UTC+5, or America/New_York.");
    return;
  }

  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await ensureUser(store, userId);
  await store.setUser({ ...user, timezone: text });

  ctx.session.step = "idle";
  await ctx.reply(`✅ Timezone set to ${text}.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// ── Milestone editing ────────────────────────────────────────────────────────
composer.callbackQuery("ue:ms", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await ensureUser(store, userId);
  const current = user.milestone_preferences;

  await ctx.editMessageText(
    `Choose your milestone celebrations. Current: ${current.join(", ")} days.\n\nTap a milestone to toggle it.`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton(`7 days ${current.includes(7) ? "✅" : ""}`, "ue:ms:7"),
          inlineButton(`21 days ${current.includes(21) ? "✅" : ""}`, "ue:ms:21"),
        ],
        [
          inlineButton(`30 days ${current.includes(30) ? "✅" : ""}`, "ue:ms:30"),
          inlineButton(`60 days ${current.includes(60) ? "✅" : ""}`, "ue:ms:60"),
        ],
        [
          inlineButton(`90 days ${current.includes(90) ? "✅" : ""}`, "ue:ms:90"),
          inlineButton(`365 days ${current.includes(365) ? "✅" : ""}`, "ue:ms:365"),
        ],
        [inlineButton("Done", "ue:ms:done")],
      ]),
    },
  );
});

composer.callbackQuery(/^ue:ms:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  const days = parseInt(ctx.match[1], 10);
  if (!userId) return;

  const user = await ensureUser(store, userId);
  const current = user.milestone_preferences;
  const updated = current.includes(days)
    ? current.filter((d) => d !== days)
    : [...current, days].sort((a, b) => a - b);

  await store.setUser({ ...user, milestone_preferences: updated });

  // Re-render milestone buttons
  const text =
    `Choose your milestone celebrations. Current: ${updated.join(", ")} days.\n\n` +
    `Tap a milestone to toggle it.`;
  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard([
      [
        inlineButton(`7 days ${updated.includes(7) ? "✅" : ""}`, "ue:ms:7"),
        inlineButton(`21 days ${updated.includes(21) ? "✅" : ""}`, "ue:ms:21"),
      ],
      [
        inlineButton(`30 days ${updated.includes(30) ? "✅" : ""}`, "ue:ms:30"),
        inlineButton(`60 days ${updated.includes(60) ? "✅" : ""}`, "ue:ms:60"),
      ],
      [
        inlineButton(`90 days ${updated.includes(90) ? "✅" : ""}`, "ue:ms:90"),
        inlineButton(`365 days ${updated.includes(365) ? "✅" : ""}`, "ue:ms:365"),
      ],
      [inlineButton("Done", "ue:ms:done")],
    ]),
  });
});

composer.callbackQuery("ue:ms:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await ensureUser(store, userId);
  await ctx.editMessageText(
    `✅ Milestones saved: ${user.milestone_preferences.join(", ")} days.`,
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
});

export default composer;
