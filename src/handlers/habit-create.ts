import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getStore, type ScheduleType } from "../store.js";

// Habit creation flow — multi-step wizard.
// Entry: "➕ New habit" button on the main menu (habit:create callback).
// Steps:
//   1. Prompt for habit name (ForceReply)
//   2. Show schedule-type buttons (daily / weekdays / specific days)
//   3. Prompt for reminder time (ForceReply, optional)
//   4. Show summary + confirm

registerMainMenuItem({ label: "➕ New habit", data: "habit:create", order: 10 });

const composer = new Composer<Ctx>();

// ── Entry point ──────────────────────────────────────────────────────────────
composer.callbackQuery("habit:create", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "hc_awaiting_name";
  ctx.session.hc_name = undefined;
  ctx.session.hc_schedule_type = undefined;
  ctx.session.hc_schedule_config = undefined;
  ctx.session.hc_reminder_time = undefined;
  await ctx.reply("What habit do you want to build?", {
    reply_markup: { force_reply: true, input_field_placeholder: "e.g. Read for 20 minutes" },
  });
});

// ── Step 2: show schedule options after name is entered ──────────────────────
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "hc_awaiting_name") return next();

  const name = ctx.message.text.trim();
  if (name.length < 1 || name.length > 50) {
    await ctx.reply("Keep it short — 1 to 50 characters. Try again.");
    return;
  }

  ctx.session.hc_name = name;
  ctx.session.step = "hc_awaiting_schedule";
  await ctx.reply(`Great — "${name}". How often?`, {
    reply_markup: inlineKeyboard([
      [inlineButton("Every day", "hc:sch:daily"), inlineButton("Weekdays", "hc:sch:weekdays")],
      [inlineButton("Custom days", "hc:sch:custom")],
    ]),
  });
});

// ── Schedule type selection ──────────────────────────────────────────────────
composer.callbackQuery("hc:sch:daily", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.hc_schedule_type = "daily";
  ctx.session.hc_schedule_config = {};
  await promptReminder(ctx);
});

composer.callbackQuery("hc:sch:weekdays", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.hc_schedule_type = "weekdays";
  ctx.session.hc_schedule_config = { days: [1, 2, 3, 4, 5] };
  await promptReminder(ctx);
});

composer.callbackQuery("hc:sch:custom", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.hc_schedule_type = "specific_days";
  ctx.session.step = "hc_awaiting_schedule";
  await ctx.reply("Which days? Tap the ones you want, then tap Done.", {
    reply_markup: inlineKeyboard([
      [
        inlineButton("Mon", "hc:day:1"),
        inlineButton("Tue", "hc:day:2"),
        inlineButton("Wed", "hc:day:3"),
        inlineButton("Thu", "hc:day:4"),
      ],
      [
        inlineButton("Fri", "hc:day:5"),
        inlineButton("Sat", "hc:day:6"),
        inlineButton("Sun", "hc:day:0"),
      ],
      [inlineButton("Done", "hc:days:done")],
    ]),
  });
});

// Track selected custom days in session
composer.callbackQuery(/^hc:day:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const day = parseInt(ctx.match[1], 10);
  const current = ctx.session.hc_schedule_config?.days ?? [];
  if (current.includes(day)) {
    ctx.session.hc_schedule_config = { days: current.filter((d) => d !== day) };
  } else {
    ctx.session.hc_schedule_config = { days: [...current, day].sort() };
  }
});

composer.callbackQuery("hc:days:done", async (ctx) => {
  await ctx.answerCallbackQuery();
  const days = ctx.session.hc_schedule_config?.days ?? [];
  if (days.length === 0) {
    await ctx.reply("Pick at least one day.");
    return;
  }
  await promptReminder(ctx);
});

// ── Step 3: reminder time ───────────────────────────────────────────────────
async function promptReminder(ctx: Ctx) {
  ctx.session.step = "hc_awaiting_reminder";
  await ctx.reply("What time should I remind you? Type a time like 09:00, or tap Skip.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Skip", "hc:rem:skip")],
    ]),
  });
}

composer.callbackQuery("hc:rem:skip", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.hc_reminder_time = "09:00";
  await showConfirm(ctx);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "hc_awaiting_reminder") return next();

  const text = ctx.message.text.trim();
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!timeMatch) {
    await ctx.reply("Please enter a valid time (HH:MM, e.g. 09:00 or 18:30).");
    return;
  }

  ctx.session.hc_reminder_time = text;
  await showConfirm(ctx);
});

// ── Step 4: confirm ─────────────────────────────────────────────────────────
async function showConfirm(ctx: Ctx) {
  ctx.session.step = "hc_confirming";
  const name = ctx.session.hc_name ?? "Untitled";
  const schedule = formatSchedule(ctx.session.hc_schedule_type, ctx.session.hc_schedule_config);
  const time = ctx.session.hc_reminder_time ?? "09:00";

  await ctx.reply(
    `Create this habit?\n\n` +
    `Name: ${name}\n` +
    `Schedule: ${schedule}\n` +
    `Reminder: ${time}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Create habit", "hc:confirm"), inlineButton("Cancel", "hc:cancel")],
      ]),
    },
  );
}

composer.callbackQuery("hc:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const habitId = await store.genId();
  const now = new Date().toISOString();
  await store.setHabit({
    id: habitId,
    user_id: userId,
    name: ctx.session.hc_name ?? "Untitled",
    schedule_type: (ctx.session.hc_schedule_type as ScheduleType) ?? "daily",
    schedule_config: ctx.session.hc_schedule_config ?? {},
    reminder_time: ctx.session.hc_reminder_time ?? "09:00",
    status: "active",
    created_at: now,
    current_streak: 0,
    longest_streak: 0,
    total_completions: 0,
  });

  ctx.session.step = "idle";
  ctx.session.hc_name = undefined;
  ctx.session.hc_schedule_type = undefined;
  ctx.session.hc_schedule_config = undefined;
  ctx.session.hc_reminder_time = undefined;

  await ctx.editMessageText(
    `✅ Habit created! You're building "${ctx.session.hc_name ?? "Untitled"}". Keep at it — consistency is everything.`,
    { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
  );
});

composer.callbackQuery("hc:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.hc_name = undefined;
  ctx.session.hc_schedule_type = undefined;
  ctx.session.hc_schedule_config = undefined;
  ctx.session.hc_reminder_time = undefined;
  await ctx.editMessageText("No worries — cancelled. Tap /start to see the menu.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSchedule(type?: string, config?: { days?: number[]; times_per_week?: number }): string {
  switch (type) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Mon – Fri";
    case "specific_days": {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const days = config?.days ?? [];
      return days.map((d) => dayNames[d]).join(", ") || "Custom";
    }
    case "n_times_per_week":
      return `${config?.times_per_week ?? 3}× per week`;
    default:
      return "Every day";
  }
}

export default composer;
