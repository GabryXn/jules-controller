# Jules Orchestration System — Improvements Design

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Bug fixes + feature additions across 3 implementation waves

---

## Context

Jules Controller is a centralized GitHub orchestration system that dispatches the Google Jules AI agent to target repositories via GitHub Actions, Google Calendar (Apps Script), and GitHub Issues. The system is functional but has known bugs and missing features identified through code review.

---

## Wave 1: Bug Fixes

### 1.1 — `jules_agent.yml`: Align issue trigger prompt with dispatch trigger

**Problem:** The `workflow_dispatch` trigger includes a detailed system prompt (Senior SWE role, create PR, never merge, `TASK START/END` delimiters). The `issues` trigger sends only the raw issue body with no behavioral instructions and no `DATABASE_CONTEXT`/`USER_REQUEST_ORIGIN` header lines.

**Fix:** Add the full header lines (`DATABASE_CONTEXT`, `USER_REQUEST_ORIGIN`) and the ISTRUZIONI CRITICHE block (points 1–5: Senior SWE, act autonomously, execute changes, create PR, no merge) to the `issues` trigger prompt. The `USER_REQUEST_ORIGIN` value on the issue path should reference the issue number: `GitHub Issue #${{ github.event.issue.number }}`. The issue body is already delimited with `USER REQUEST START/END` — those delimiters are intentionally different from the dispatch path's `TASK START/END` and should be preserved.

**File:** `jules-controller/templates/jules_agent.yml`

---

### 1.2 — Apps Script: Fragile `calendar_automation` config check

**Problem:** `triggerJulesOnGithub` checks `configText.includes("calendar_automation: false")`. This matches commented YAML lines (e.g., `# calendar_automation: false`) and fails on whitespace variations.

**Context:** In `jules_config.yml`, the flag is at `features.calendar_automation` (indented under `features:`). The regex must match the indented form. Full YAML parsing is not available in Apps Script without a library, so a regex approach is used with the documented assumption that the key `calendar_automation` does not appear at the top level.

**Fix:** Replace with:
```typescript
const calendarDisabled = /^\s+calendar_automation\s*:\s*false\s*$/m.test(configText);
if (calendarDisabled) { ... }
```
The leading `\s+` (one or more spaces) ensures the match only hits indented YAML keys, not commented lines which start with `#`.

**Constraints on YAML convention:** This regex does not handle quoted boolean values (e.g., `calendar_automation: 'false'` will NOT match and will be silently ignored, leaving automation enabled). The `jules_config.yml` convention must always use unquoted booleans for feature flags.

**File:** `jules-controller/calendar-integration/src/index.ts`

---

### 1.3 — `sync-schedules.py`: Missing `auto-config-sync.yml` in cron mapping

**Problem:** `auto-config-sync.yml` has a daily cron (`0 0 * * *`) hardcoded and never updated when timezone offsets change.

**Fix:**
1. Add `auto_config_sync_time: "01:00"` to `schedules:` in `jules_config.yml`
2. Add entry to the `mapping` dict in `sync-schedules.py`:
   ```python
   'auto_config_sync_time': ['auto-config-sync.yml']
   ```

**Files:** `jules-controller/scripts/sync-schedules.py`, `jules-controller/jules_config.yml`

---

### 1.4 — Apps Script: `fetchAllTargets` affiliation inconsistency

**Problem:** `fetchAllTargets` uses `affiliation=owner` (excludes collaborator repos). `master-setup.yml` uses `permissions.push == true` which includes all repos with write access.

**Fix:** Change the API call URL to:
```
/user/repos?visibility=all&affiliation=owner,collaborator&per_page=100
```
And filter the response:
```typescript
.filter((repo: any) => !repo.archived && repo.permissions?.push === true)
```

**File:** `jules-controller/calendar-integration/src/index.ts`

---

## Wave 2: Workflow Feature Additions

### 2.1 — Per-automation `enabled` flag in `jules_targets.yml`

**Purpose:** Allow disabling a single automation without removing it.

**Design:**
- Add optional `enabled` boolean field to each automation block (default: `true` when absent)
- `controller.yml` filters out disabled automations using this `jq` expression (applied after `yq -o=json jules_targets.yml | jq -c '.targets[]'`):
  ```bash
  echo "$automation" | jq -r '.enabled // true'
  ```
  If the result is not `"true"`, skip with a log message.

**Example:**
```yaml
automations:
  - name: "vulnerability-scan"
    enabled: false
    prompt: |
      ...
```

---

### 2.2 — Repo exclusion list in `jules_config.yml` for `master-setup.yml`

**Purpose:** Exclude specific repos from the universal setup.

**Design:**
- Add `excluded_repos` list to `jules_config.yml`:
  ```yaml
  excluded_repos:
    - "GabryXn/jules-controller"
  ```
- In `master-setup.yml`, after reading `repos_list.txt`, add a check:
  ```bash
  EXCLUDED=$(yq eval '.excluded_repos[]' jules_config.yml 2>/dev/null | sed 's/[.[\*^${}\\+?|()]/\\&/g' | tr '\n' '|' | sed 's/|$//')
  # In the loop:
  if [ -n "$EXCLUDED" ] && echo "$REPO" | grep -qE "^(${EXCLUDED})$"; then
    echo "⏩ Skipping excluded repo: $REPO"
    continue
  fi
  ```
  Notes:
  - The `sed 's/[.[\*^${}\\+?|()]/\\&/g'` step escapes regex metacharacters in repo names (important for names containing dots, e.g. `owner/my.repo`)
  - The `[ -n "$EXCLUDED" ]` guard prevents the grep from running when the list is empty (which would match incorrectly in some shells)
  - If `excluded_repos` is absent or empty in YAML, `EXCLUDED` will be empty and no repos are skipped

**Files:** `jules-controller/jules_config.yml`, `jules-controller/.github/workflows/master-setup.yml`

---

### 2.3 — Dry-run mode in `controller.yml`

**Purpose:** Test dispatch configuration without invoking Jules.

**Design:**
- Add `workflow_dispatch` input:
  ```yaml
  dry_run:
    description: 'Log dispatches without executing them'
    required: false
    default: 'false'
    type: boolean
  ```
- Dry-run is **manual-only**: the dry-run input only has effect when `github.event_name == 'workflow_dispatch'`. Cron-triggered runs always operate normally regardless of any default value.
- The dispatch step becomes:
  ```bash
  if [ "${{ inputs.dry_run }}" == "true" ]; then
    echo "  [DRY RUN] Would dispatch [$NAME] to $REPO"
  else
    gh workflow run jules_agent.yml -R "$REPO" -f prompt="$PROMPT"
  fi
  ```
- The `cyclic_automation` feature flag check is **not** bypassed by dry-run. If the feature is disabled, dry-run also reports nothing. This ensures dry-run reflects the real behavior.

---

### 2.4 — Per-automation schedule granularity

**Purpose:** Allow different automations to run at different frequencies.

**Design:**
- Optional `schedule` field per automation: `"daily"` (default), `"weekly"` (Mondays), `"monthly"` (1st of the month)
- `controller.yml` evaluates the check using UTC dates from the runner (GitHub Actions runners run in UTC). Schedule granularity is therefore UTC-based:
  - `"weekly"`: runs when `$(date -u +%u)` == `1` (Monday UTC)
  - `"monthly"`: runs when `$(date -u +%d)` == `01` (1st UTC)
  - This means a "monthly" automation may fire on the evening of the last day of the month in Rome time when it is already the 1st in UTC. This is documented and accepted behavior.
- Implementation in `controller.yml`:
  ```bash
  SCHEDULE=$(echo "$automation" | jq -r '.schedule // "daily"')
  DOW=$(date -u +%u)  # 1=Monday
  DOM=$(date -u +%d)  # 01-31

  SHOULD_RUN=false
  case "$SCHEDULE" in
    daily)   SHOULD_RUN=true ;;
    weekly)  [ "$DOW" == "1" ] && SHOULD_RUN=true ;;
    monthly) [ "$DOM" == "01" ] && SHOULD_RUN=true ;;
    *)       echo "  ⚠️ Unknown schedule '$SCHEDULE', defaulting to daily"; SHOULD_RUN=true ;;
  esac

  if [ "$SHOULD_RUN" != "true" ]; then
    echo "  ⏩ Skipping [$NAME] — schedule '$SCHEDULE' not due today"
    continue
  fi
  ```

---

## Wave 3: Recurring Calendar Events (Apps Script Refactoring)

### Root Cause

Google Apps Script's `CalendarApp.getEvents()` returns recurring event instances with the **same `eventId`** for all occurrences of a series. The current state store is keyed by `eventId`, so after the first occurrence triggers Jules, all subsequent occurrences are blocked by the 5-minute deduplication check and the "already scheduled" guard in `processCalendarEvents`.

### Solution Architecture

#### 3.1 — Composite state key

Replace `eventId` → `eventId + "_" + startTime.getTime()` as the composite key throughout **both** `processCalendarEvents` and `checkAndTriggerJules`.

**`processCalendarEvents` — sites to change:**

1. **`activeJulesEvents` population** — Change from bare `eventId` to composite key. Google Calendar event IDs themselves can contain underscores, so `split('_')[0]` is not safe to reverse. Instead, key the map by composite key too, which eliminates the need to extract the base `eventId` in the cleanup loop:
   ```typescript
   events.forEach(event => {
     const compositeKey = event.getId() + '_' + event.getStartTime().getTime();
     if (extractTargetRepos(event.getTitle() || '').length > 0) {
       activeJulesEvents.set(compositeKey, event);
     }
   });
   ```

2. **Cleanup loop** — iterate `scheduledEvents` keys as `compositeKey` and look up directly in `activeJulesEvents` by composite key (no base `eventId` extraction needed):
   ```typescript
   for (const compositeKey in scheduledEvents) {
     const scheduledData = scheduledEvents[compositeKey];
     const activeEvent = activeJulesEvents.get(compositeKey); // direct lookup
     // ...cancel/delete logic using compositeKey...
   }
   ```

3. **Checksum comparison (edit detection)** — read/write `scheduledEvents[compositeKey]`

4. **Creation pass** — iterate `activeJulesEvents` by composite key directly:
   ```typescript
   activeJulesEvents.forEach((event, compositeKey) => {
     if (!scheduledEvents[compositeKey]) {
       const startTime = event.getStartTime();
       if (startTime.getTime() < now.getTime()) return;
       // ...create entry using compositeKey...
     }
   });
   ```

**`checkAndTriggerJules` — explicit pseudocode:**

```typescript
events.forEach(event => {
  const eventId = event.getId();
  const compositeKey = eventId + "_" + event.getStartTime().getTime(); // ← NEW
  const targetRepos = extractTargetRepos(event.getTitle() || '');

  if (targetRepos.length > 0) {
    const eventStartTime = event.getStartTime().getTime();
    const diff = Math.abs(eventStartTime - nowMs);

    // Dedup check — READ uses compositeKey (not bare eventId)
    const eventData = scheduledEvents[compositeKey]; // ← CHANGED from [eventId]
    const lastTriggered = eventData ? (eventData.lastTriggered || 0) : 0;

    if (nowMs - lastTriggered < minInterval) {
      console.log(`⏩ Skipping — already triggered: ${compositeKey}`);
      return;
    }

    if (diff <= 120000) {
      // ... dispatch logic ...

      if (eventTriggered) {
        if (!scheduledEvents[compositeKey]) {           // ← CHANGED
          scheduledEvents[compositeKey] = { ... };     // ← CHANGED
        }
        scheduledEvents[compositeKey].lastTriggered = nowMs; // ← CHANGED
        stateChanged = true;
      }
    }
  }
});
```

#### 3.2 — Migration from old state schema

The switch from bare `eventId` keys to composite keys is a **breaking change** on the live `SCHEDULED_EVENTS` PropertiesService entry. Deployment procedure:

1. Deploy the new Apps Script code
2. **Immediately** run `setupCalendarTrigger()` manually from the Apps Script editor — this function will be updated to also clear `SCHEDULED_EVENTS` from `PropertiesService` before re-initializing (one-time migration wipe)
3. `processCalendarEvents()` will re-scan the next 14 days and rebuild state with composite keys

The migration wipe is safe because:
- `processCalendarEvents` will recreate all future entries immediately
- Past/fired occurrences don't need to be preserved (they won't re-fire because their start times are in the past)
- Active Apps Script time-driven triggers created by old code: `setupCalendarTrigger` explicitly deletes **all** outstanding `checkAndTriggerJules` triggers before wiping state (step 3 below). This eliminates the race condition where an old trigger could fire after the wipe but before `processCalendarEvents` rebuilds state. Because trigger deletion and state wipe happen in the same `setupCalendarTrigger` call, no old trigger can fire in the gap.

`setupCalendarTrigger` updated behavior:
```typescript
export function setupCalendarTrigger() {
  // 1. Delete all existing checkAndTriggerJules triggers FIRST
  //    (must happen before wiping state to eliminate the race window
  //     where an old trigger could fire against empty state)
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkAndTriggerJules')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 2. Clear stale state — safe now, no old triggers can fire after step 1
  PropertiesService.getScriptProperties().deleteProperty('SCHEDULED_EVENTS');

  // 3. Set up onCalendarEvent trigger (idempotent)
  // ... existing logic ...

  // 4. Set up 6-hour periodic trigger (idempotent)
  // ... new logic ...
}
```

#### 3.3 — 6-hour periodic re-scan trigger

Add a time-based trigger that calls `processCalendarEvents` every 6 hours. This ensures recurring occurrences are scheduled as they enter the 14-day window, even if no calendar edits happen.

`setupCalendarTrigger` adds (idempotently):
```typescript
const hasPeriodicTrigger = ScriptApp.getProjectTriggers()
  .some(t => t.getHandlerFunction() === 'processCalendarEvents' &&
             t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK);
if (!hasPeriodicTrigger) {
  ScriptApp.newTrigger('processCalendarEvents')
    .timeBased()
    .everyHours(6)
    .create();
}
```

**Lock contention:** If the 6-hour trigger and an `onCalendarEvent` fire within 30 seconds of each other, the second call will fail to acquire `LockService.getScriptLock()` and log an error. This is **intentional and accepted** — the 6-hour cycle means the next attempt will occur within 6 hours, which is sufficient for calendar-driven automation. No retry queue is needed.

#### 3.4 — Modification handling (Option B — approved)

When a recurring series is edited:
- Occurrences with `lastTriggered` set are **not touched** (already fired)
- Future occurrences (no `lastTriggered`) are detected by checksum mismatch, cancelled, and rescheduled with the new time/prompt
- Detection in `processCalendarEvents`:
  ```typescript
  const compositeKey = eventId + "_" + startTime.getTime();
  const currentChecksum = generateEventChecksum(event);
  if (scheduledEvents[compositeKey]?.checksum !== currentChecksum
      && !scheduledEvents[compositeKey]?.lastTriggered) {
    // cancel old trigger, create new one
  }
  ```

#### 3.5 — `generateEventChecksum` — verification only

The existing implementation at `index.ts:457` already includes `event.getStartTime().getTime()` as the first field:
```typescript
const data = `${event.getStartTime().getTime()}|${event.getTitle()}|${event.getDescription()}`;
```
**No change is needed.** This section confirms the existing checksum already distinguishes occurrences of the same series — the composite key change in 3.1 is sufficient.

### State Schema (updated)

```
SCHEDULED_EVENTS: {
  "<eventId>_<startTimeMs>": {
    time: number,           // occurrence start time (ms)
    checksum: string,       // hash(startTime|title|description)
    triggerId: string,      // Apps Script trigger UID
    lastTriggered?: number  // ms timestamp of last dispatch; absent if not yet fired
  }
}
```

### Edge Cases

| Scenario | Behavior |
|---|---|
| First occurrence of recurring event | Composite key entry created, trigger scheduled |
| Recurring event fires | `lastTriggered` set on that key; other occurrences have separate keys and are unaffected |
| Series edited (time/prompt) | Future entries (no `lastTriggered`) cancelled + rescheduled; past entries unchanged |
| Series deleted | All composite-key entries cleaned up on next `processCalendarEvents` scan |
| Single occurrence deleted | That specific composite-key entry cleaned up |
| Event re-enters 14-day window | Picked up by 6-hour periodic scan |
| Recurrence interval > 14 days (e.g. quarterly) | **Out of scope.** The 6-hour scan will pick it up when it enters the 14-day window. If the interval exceeds 14 days, the event will be scheduled approximately 14 days before it fires, which is acceptable. |
| Lock contention between 6h trigger and onCalendarEvent | Second caller fails silently; retried on next 6-hour cycle (intentional) |

---

## Files Changed per Wave

### Wave 1
- `jules-controller/templates/jules_agent.yml`
- `jules-controller/calendar-integration/src/index.ts`
- `jules-controller/scripts/sync-schedules.py`
- `jules-controller/jules_config.yml`

### Wave 2
- `jules-controller/jules_config.yml`
- `jules-controller/jules_targets.yml` (example additions)
- `jules-controller/.github/workflows/controller.yml`
- `jules-controller/.github/workflows/master-setup.yml`

### Wave 3
- `jules-controller/calendar-integration/src/index.ts`
- `jules-controller/calendar-integration/dist/Code.js` (rebuilt via `pnpm run build`)

---

## Out of Scope

- Notification system (Jules sends Gmail notifications natively)
- Dashboard UI
- Multi-user support
- Recurrence intervals configurable beyond daily/weekly/monthly
