import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { getStore, type HabitRecord, type OccurrenceRecord } from "../store.js";

// Weekly recap — 7-day grid summary with completion rate and encouraging tip.
// Entry: "📊 Weekly recap" button on the main menu (recap:view callback).

registerMainMenuItem({ label: "📊 Weekly recap", data: "recap:view", order: 30 });

const composer = new Composer<Ctx>();

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayName(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
}

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const TIPS = [
  "Consistency beats perfection — even a small step counts.",
  "You're building something real. Keep going!",
  "Missed a day? That's normal. Start fresh right now.",
  "Stack your habit onto something you already do daily.",
  "Celebrate every win — you earned it.",
];

function pickTip(): string {
  const idx = Math.floor(Date.now() / 86400000) % TIPS.length;
  return TIPS[idx];
}

// ── Entry point ──────────────────────────────────────────────────────────────
composer.callbackQuery("recap:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = ctx.from?.id;
  if (!userId) return;

  const habits = await store.listHabitsForUser(userId);
  const active = habits.filter((h) => h.status === "active");

  if (active.length === 0) {
    await ctx.editMessageText(
      "No habits to recap yet — create one first!",
      { reply_markup: inlineKeyboard([[inlineButton("➕ New habit", "habit:create")]]) },
    );
    return;
  }

  // Build 7-day grid
  const today = todayString();
  const todayIdx = new Date().getUTCDay();
  const dayOffsets = [0, -1, -2, -3, -4, -5, -6];
  const dateLabels = dayOffsets.map((off) => {
    const ds = dateStr(off);
    return { date: ds, label: dayName(ds), isToday: ds === today };
  });

  // Count completions across all habits for each day
  let totalScheduled = 0;
  let totalDone = 0;

  const lines: string[] = ["📊 Your week at a glance:\n"];

  for (const h of active) {
    const row: string[] = [`<b>${h.name}</b>`];
    for (const { date: ds, label, isToday } of dateLabels) {
      const occs = await store.listOccurrencesForDay(userId, ds);
      const occ = occs.find((o) => o.habit_id === h.id);
      const mark = occ?.status === "done" ? "✅" : occ?.status === "skip" ? "❌" : "·";
      row.push(`${label.slice(0, 2)}${isToday ? "→" : ""} ${mark}`);
      totalScheduled++;
      if (occ?.status === "done") totalDone++;
    }
    lines.push(row.join("  "));
  }

  const rate = totalScheduled > 0 ? Math.round((totalDone / totalScheduled) * 100) : 0;
  lines.push("");
  lines.push(`Completion: ${totalDone}/${totalScheduled} (${rate}%)`);
  lines.push(`\n💡 ${pickTip()}`);

  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

export default composer;
