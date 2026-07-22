# Habit Tracker Bot — Bot specification

**Archetype:** workflow

**Voice:** encouraging and concise — write every user-facing message, button label, error, and empty state in this voice.

A private Telegram bot that helps users create and maintain personal habits with flexible schedules, gentle reminders, one-tap check-ins, and streak tracking. The bot provides weekly recaps, milestone celebrations, and allows editing/pausing habits while ensuring no double-counting of check-ins across time zones.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- individuals seeking to build personal habits

## Success criteria

- User completes 70% of scheduled habit check-ins over 28 days
- Users receive and interact with weekly recaps
- Users can edit/pause habits without losing progress

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **Create new habit** (button, actor: user, callback: habit:create) — Start the habit creation flow
- **All habits** (button, actor: user, callback: habits:list) — View compact list of all habits with status and streaks
- **Edit profile** (button, actor: user, callback: user:edit) — Update timezone or milestone preferences
- **Weekly recap** (button, actor: user, callback: recap:view) — Manually view the latest weekly recap

## Flows

### onboarding
_Trigger:_ /start

1. Detect Telegram timezone
2. Prompt for timezone override
3. Create first habit with guided questions
4. Set default reminder time

_Data touched:_ user, habit

### habit_creation
_Trigger:_ habit:create

1. Prompt for habit name
2. Select schedule type (daily/weekdays/N times/week)
3. Set reminder time
4. Confirm habit creation

_Data touched:_ habit

### reminder_flow
_Trigger:_ scheduled_reminder

1. Send reminder message with Done/Skip/Postpone buttons
2. Record user action when button clicked
3. Reschedule reminder if postponed

_Data touched:_ occurrence

### check_in_flow
_Trigger:_ habit:list interaction

1. Display habit list with today status
2. Handle Done/Skip action from list view
3. Update occurrence status

_Data touched:_ occurrence

### weekly_recap
_Trigger:_ scheduled_weekly

1. Generate 7-day grid summary
2. Calculate completion rate
3. Include encouraging tip
4. Send recap message

_Data touched:_ occurrence, metrics

### milestone_celebration
_Trigger:_ habit_completion_threshold

1. Detect milestone achievement (7/21/60 days)
2. Send concise celebration message
3. Display milestone badge in app

_Data touched:_ metrics

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **user** _(retention: persistent)_ — Telegram user account with preferences
  - fields: telegram_id, timezone, milestone_preferences
- **habit** _(retention: persistent)_ — User-created habit definition
  - fields: name, schedule_type, reminder_time, status, timezone
- **occurrence** _(retention: persistent)_ — Record of habit check-in or skip
  - fields: habit_id, date, status, timestamp
- **metrics** _(retention: persistent)_ — Computed habit performance statistics
  - fields: current_streak, longest_streak, completion_rate

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure milestone thresholds
- Set default reminder time
- Edit timezone
- Pause/resume habits

## Notifications

- Scheduled daily reminders
- Weekly recap notifications
- Milestone celebration notifications

## Permissions & privacy

- All data is private to the user's Telegram account
- No external sharing or data export
- User can delete their data at any time

## Edge cases

- Timezone changes during active streak tracking
- Postponed reminders crossing DST boundaries
- Multiple habits with overlapping reminder times
- Editing a habit during active streak

## Required tests

- Verify single check-in per scheduled window prevents double-counting
- Validate timezone-aware reminder scheduling
- Test weekly recap generation with various habit patterns
- Confirm milestone detection works across different schedule types

## Assumptions

- Users will want to maintain habits for at least 28 days
- Most users will prefer default schedule types
- Timezone auto-detection will be accurate for most users
