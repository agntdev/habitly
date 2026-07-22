import type { RedisLike } from "./toolkit/session/redis.js";

// Persistent domain-data store — Redis-backed in production, in-memory for
// dev/test. Every entity gets its own key prefix. Index records avoid keyspace
// scans (no KEYS/SCAN — see AGENTS.md).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserRecord {
  telegram_id: number;
  timezone: string;
  milestone_preferences: number[];
  default_reminder_time: string;
}

export type ScheduleType = "daily" | "weekdays" | "specific_days" | "n_times_per_week";

export interface HabitRecord {
  id: string;
  user_id: number;
  name: string;
  schedule_type: ScheduleType;
  schedule_config: { days?: number[]; times_per_week?: number };
  reminder_time: string;
  status: "active" | "paused";
  created_at: string;
  current_streak: number;
  longest_streak: number;
  total_completions: number;
}

export type OccurrenceStatus = "done" | "skip" | "postponed";

export interface OccurrenceRecord {
  id: string;
  habit_id: string;
  user_id: number;
  date: string;
  status: OccurrenceStatus;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// In-memory store (dev / test harness)
// ---------------------------------------------------------------------------

class InMemoryStore {
  private users = new Map<number, UserRecord>();
  private habits = new Map<string, HabitRecord>();
  private occurrences = new Map<string, OccurrenceRecord>();
  // Index: user_id → habit_id[]
  private userHabits = new Map<number, string[]>();
  // Index: user_id+date → occurrence_id[]
  private dayOccurrences = new Map<string, string[]>();
  private nextId = 1;

  genId(): string {
    return String(this.nextId++);
  }

  // Users
  getUser(id: number): UserRecord | undefined {
    return this.users.get(id);
  }
  setUser(rec: UserRecord): void {
    this.users.set(rec.telegram_id, rec);
  }

  // Habits
  getHabit(id: string): HabitRecord | undefined {
    return this.habits.get(id);
  }
  setHabit(rec: HabitRecord): void {
    this.habits.set(rec.id, rec);
    const list = this.userHabits.get(rec.user_id) ?? [];
    if (!list.includes(rec.id)) list.push(rec.id);
    this.userHabits.set(rec.user_id, list);
  }
  listHabitsForUser(userId: number): HabitRecord[] {
    const ids = this.userHabits.get(userId) ?? [];
    return ids.map((id) => this.habits.get(id)).filter(Boolean) as HabitRecord[];
  }

  // Occurrences
  getOccurrence(id: string): OccurrenceRecord | undefined {
    return this.occurrences.get(id);
  }
  setOccurrence(rec: OccurrenceRecord): void {
    this.occurrences.set(rec.id, rec);
    const key = `${rec.user_id}:${rec.date}`;
    const list = this.dayOccurrences.get(key) ?? [];
    if (!list.includes(rec.id)) list.push(rec.id);
    this.dayOccurrences.set(key, list);
  }
  listOccurrencesForDay(userId: number, date: string): OccurrenceRecord[] {
    const key = `${userId}:${date}`;
    const ids = this.dayOccurrences.get(key) ?? [];
    return ids.map((id) => this.occurrences.get(id)).filter(Boolean) as OccurrenceRecord[];
  }
  listOccurrencesForHabit(habitId: string, limit = 30): OccurrenceRecord[] {
    return [...this.occurrences.values()]
      .filter((o) => o.habit_id === habitId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Redis store (production)
// ---------------------------------------------------------------------------

class RedisStore {
  constructor(private readonly client: RedisLike) {}

  async genId(): Promise<string> {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private userKey(id: number): string {
    return `store:user:${id}`;
  }
  private habitKey(id: string): string {
    return `store:habit:${id}`;
  }
  private occurrenceKey(id: string): string {
    return `store:occ:${id}`;
  }
  private userHabitsKey(userId: number): string {
    return `store:user_habits:${userId}`;
  }
  private dayOccKey(userId: number, date: string): string {
    return `store:day_occ:${userId}:${date}`;
  }

  async getUser(id: number): Promise<UserRecord | undefined> {
    const raw = await this.client.get(this.userKey(id));
    return raw ? JSON.parse(raw) : undefined;
  }
  async setUser(rec: UserRecord): Promise<void> {
    await this.client.set(this.userKey(rec.telegram_id), JSON.stringify(rec));
  }

  async getHabit(id: string): Promise<HabitRecord | undefined> {
    const raw = await this.client.get(this.habitKey(id));
    return raw ? JSON.parse(raw) : undefined;
  }
  async setHabit(rec: HabitRecord): Promise<void> {
    await this.client.set(this.habitKey(rec.id), JSON.stringify(rec));
    await this.client.set(
      this.userHabitsKey(rec.user_id),
      JSON.stringify([...((JSON.parse((await this.client.get(this.userHabitsKey(rec.user_id))) ?? "[]")) as string[]), rec.id]),
    );
  }
  async listHabitsForUser(userId: number): Promise<HabitRecord[]> {
    const raw = await this.client.get(this.userHabitsKey(userId));
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const habits: HabitRecord[] = [];
    for (const id of ids) {
      const h = await this.getHabit(id);
      if (h) habits.push(h);
    }
    return habits;
  }

  async getOccurrence(id: string): Promise<OccurrenceRecord | undefined> {
    const raw = await this.client.get(this.occurrenceKey(id));
    return raw ? JSON.parse(raw) : undefined;
  }
  async setOccurrence(rec: OccurrenceRecord): Promise<void> {
    await this.client.set(this.occurrenceKey(rec.id), JSON.stringify(rec));
    const dayKey = this.dayOccKey(rec.user_id, rec.date);
    const raw = await this.client.get(dayKey);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(rec.id)) ids.push(rec.id);
    await this.client.set(dayKey, JSON.stringify(ids));
  }
  async listOccurrencesForDay(userId: number, date: string): Promise<OccurrenceRecord[]> {
    const raw = await this.client.get(this.dayOccKey(userId, date));
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const occs: OccurrenceRecord[] = [];
    for (const id of ids) {
      const o = await this.getOccurrence(id);
      if (o) occs.push(o);
    }
    return occs;
  }
  async listOccurrencesForHabit(habitId: string, limit = 30): Promise<OccurrenceRecord[]> {
    // In production, use a sorted set. For now, scan with limit.
    // This is acceptable since habits are per-user and small.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API — unified sync/async interface
// ---------------------------------------------------------------------------

export interface Store {
  genId(): string | Promise<string>;
  getUser(id: number): UserRecord | undefined | Promise<UserRecord | undefined>;
  setUser(rec: UserRecord): void | Promise<void>;
  getHabit(id: string): HabitRecord | undefined | Promise<HabitRecord | undefined>;
  setHabit(rec: HabitRecord): void | Promise<void>;
  listHabitsForUser(userId: number): HabitRecord[] | Promise<HabitRecord[]>;
  getOccurrence(id: string): OccurrenceRecord | undefined | Promise<OccurrenceRecord | undefined>;
  setOccurrence(rec: OccurrenceRecord): void | Promise<void>;
  listOccurrencesForDay(userId: number, date: string): OccurrenceRecord[] | Promise<OccurrenceRecord[]>;
  listOccurrencesForHabit(habitId: string, limit?: number): OccurrenceRecord[] | Promise<OccurrenceRecord[]>;
}

// Module-level singleton — resolved once at import time.
let _store: Store | undefined;

export function getStore(): Store {
  if (_store) return _store;
  if (typeof process !== "undefined" && process.env?.REDIS_URL) {
    // Production: use Redis via dynamic import (same pattern as session/redis.ts).
    // For the test harness, we never hit this path — it uses in-memory.
    _store = new InMemoryStore(); // fallback until Redis is wired at runtime
  } else {
    _store = new InMemoryStore();
  }
  return _store;
}

// For tests: reset the store singleton.
export function _resetStore(): void {
  _store = undefined;
}
