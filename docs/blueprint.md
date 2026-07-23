# Neobank Calorie Tracker — Bot specification

**Archetype:** workflow

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that tracks calorie consumption with user-defined category budgets. Users log meals/purchases via chat or buttons, assign them to categories, and monitor remaining calories per category over daily/weekly periods.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- individuals tracking calorie budgets

## Success criteria

- Users can log transactions and view real-time budget status
- Notifications for low-budget alerts and summaries are delivered on schedule

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
  - outputs: Welcome message with profile setup prompt
- **Log Transaction** (button, actor: user, callback: log:start) — Begin transaction logging flow
  - inputs: meal description, category, calories
  - outputs: Confirmation message with transaction summary
- **/view** (command, actor: user, command: /view) — Show current budget status
  - inputs: category filter (optional)
  - outputs: Budget summary with consumed/remaining calories
- **Quick Log** (button, actor: user, callback: quicklog:show) — Access preset calorie amounts and recent categories
  - inputs: preset amount, category
  - outputs: Logged transaction confirmation

## Flows

### Onboarding
_Trigger:_ /start

1. Collect time zone
2. Create default categories
3. Set initial budgets
4. Confirm budget period (daily/weekly)

_Data touched:_ User Profile, Categories, Budget Period Snapshot

### Transaction Logging
_Trigger:_ log:start or /log

1. Request meal description
2. Suggest category via buttons
3. Request calorie amount
4. Confirm and record transaction

_Data touched:_ Transaction, Budget Period Snapshot

### Budget Status View
_Trigger:_ /view or status button

1. Display remaining calories per category
2. Show 7/30-day trends if requested

_Data touched:_ Budget Period Snapshot, Transaction

### Notification Management
_Trigger:_ User preference changes

1. Store notification preferences
2. Schedule daily/weekly summaries
3. Trigger low-budget alerts

_Data touched:_ Notification Preference

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User Profile** _(retention: persistent)_ — User preferences and metadata
  - fields: time zone, notification preferences
- **Category** _(retention: persistent)_ — Calorie budget category with period settings
  - fields: name, budget amount, period (daily/weekly)
- **Transaction** _(retention: persistent)_ — Logged meal/purchase with metadata
  - fields: timestamp, description, category, calories
- **Budget Period Snapshot** _(retention: persistent)_ — Calculated consumed/remaining calories per category
  - fields: category reference, current period start/end, total consumed, remaining
- **Notification Preference** _(retention: persistent)_ — User-configured alert settings
  - fields: daily summary time, low-budget threshold, enabled status

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Edit/delete transactions
- Adjust category budgets
- Enable/disable notifications
- Export data on request

## Notifications

- Daily summary at 8:00 local time
- Low-budget alerts when remaining calories <15%

## Permissions & privacy

- Data retention: All transactions and budgets stored indefinitely
- User must explicitly request data export/deletion

## Edge cases

- Time zone transitions affecting budget periods
- Multiple category budget alerts in single day
- Invalid calorie input handling

## Required tests

- End-to-end onboarding flow with budget setup
- Transaction logging with category assignment
- Notification delivery across time zones
- Budget recalculation after transaction edits

## Assumptions

- Default categories include Dining, Groceries, Snacks, etc.
- Budget period defaults to daily
- Calories entered manually by user
- Notifications default to enabled with 8:00 AM daily summary
