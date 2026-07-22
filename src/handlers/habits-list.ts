import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getStore, type HabitRecord, type OccurrenceRecord } from "../store.js";

// Habits list — shows all habits with today's status and one-tap check-in.
// Entry: "📋 My habits" button on the main menu (habits:list callback).

registerMainMenuItem({ label: "📋 My habits", data: "habits:list", order: 20 });

const composer = new Composer<Ctx>();

// ── Today helper ─────────────────────────────────────────────────────────────
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── List entry point ─────────────────────────────────────────────────────────
composer.callbackQuery("habits:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const habits = await store.listHabitsForUser(userId);
  const active = habits.filter((h) => h.status === "active");

  if (active.length === 0) {
    await ctx.editMessageText(
      "No habits yet — tap ➕ New habit to create your first one.",
      { reply_markup: inlineKeyboard([[inlineButton("➕ New habit", "habit:create")]]) },
    );
    return;
  }

  const today = todayString();
  const todayOccs = await store.listOccurrencesForDay(userId, today);
  const occMap = new Map<string, OccurrenceRecord>();
  for (const o of todayOccs) occMap.set(o.habit_id, o);

  const lines: string[] = ["Your habits today:\n"];
  const buttons: import("../toolkit/index.js").InlineButton[][] = [];

  for (const h of active) {
    const occ = occMap.get(h.id);
    const status = occ ? (occ.status === "done" ? "✅" : occ.status === "skip" ? "⏭️" : "⏳") : "⏳";
    lines.push(`${status} ${h.name} — 🔥 ${h.current_streak} day streak`);

    if (!occ || occ.status === "postponed") {
      buttons.push([
        inlineButton(`✅ Done`, `hl:done:${h.id}`),
        inlineButton(`⏭️ Skip`, `hl:skip:${h.id}`),
      ]);
    }
  }

  buttons.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard(buttons),
  });
});

// ── Mark done from list ──────────────────────────────────────────────────────
composer.callbackQuery(/^hl:done:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Nice work! 🎉" });
  const store = getStore();
  const userId = ctx.from?.id;
  const habitId = ctx.match[1];
  if (!userId || !habitId) return;

  const today = todayString();
  const occId = await store.genId();
  await store.setOccurrence({
    id: occId,
    habit_id: habitId,
    user_id: userId,
    date: today,
    status: "done",
    timestamp: Date.now(),
  });

  // Update streak
  const habit = await store.getHabit(habitId);
  if (habit) {
    const newStreak = habit.current_streak + 1;
    await store.setHabit({
      ...habit,
      current_streak: newStreak,
      longest_streak: Math.max(habit.longest_streak, newStreak),
      total_completions: habit.total_completions + 1,
    });
  }

  // Re-render list
  await rerenderList(ctx);
});

// ── Skip from list ───────────────────────────────────────────────────────────
composer.callbackQuery(/^hl:skip:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  const habitId = ctx.match[1];
  if (!userId || !habitId) return;

  const today = todayString();
  const occId = await store.genId();
  await store.setOccurrence({
    id: occId,
    habit_id: habitId,
    user_id: userId,
    date: today,
    status: "skip",
    timestamp: Date.now(),
  });

  // Reset streak on skip
  const habit = await store.getHabit(habitId);
  if (habit) {
    await store.setHabit({ ...habit, current_streak: 0 });
  }

  await rerenderList(ctx);
});

// ── Re-render the list after an action ───────────────────────────────────────
async function rerenderList(ctx: Ctx) {
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const habits = await store.listHabitsForUser(userId);
  const active = habits.filter((h) => h.status === "active");

  if (active.length === 0) {
    await ctx.editMessageText(
      "No habits yet — tap ➕ New habit to create your first one.",
      { reply_markup: inlineKeyboard([[inlineButton("➕ New habit", "habit:create")]]) },
    );
    return;
  }

  const today = todayString();
  const todayOccs = await store.listOccurrencesForDay(userId, today);
  const occMap = new Map<string, OccurrenceRecord>();
  for (const o of todayOccs) occMap.set(o.habit_id, o);

  const lines: string[] = ["Your habits today:\n"];
  const buttons: import("../toolkit/index.js").InlineButton[][] = [];

  for (const h of active) {
    const occ = occMap.get(h.id);
    const status = occ ? (occ.status === "done" ? "✅" : occ.status === "skip" ? "⏭️" : "⏳") : "⏳";
    lines.push(`${status} ${h.name} — 🔥 ${h.current_streak} day streak`);

    if (!occ || occ.status === "postponed") {
      buttons.push([
        inlineButton(`✅ Done`, `hl:done:${h.id}`),
        inlineButton(`⏭️ Skip`, `hl:skip:${h.id}`),
      ]);
    }
  }

  buttons.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.editMessageText(lines.join("\n"), {
    reply_markup: inlineKeyboard(buttons),
  });
}

export default composer;
