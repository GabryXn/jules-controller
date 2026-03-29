# Jules Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 known bugs and add 5 features to the Jules orchestration system across 3 independent sessions.

**Architecture:** Three sequential waves — Wave 1 fixes bugs with no new dependencies, Wave 2 adds workflow features (YAML/bash changes only), Wave 3 refactors the Apps Script TypeScript for recurring calendar event support.

**Tech Stack:** GitHub Actions (YAML/bash), Python 3 (sync script), TypeScript + esbuild (Google Apps Script), yq, jq, gh CLI.

**Spec:** `docs/superpowers/specs/2026-03-22-jules-improvements-design.md`

---

> ⚠️ **SESSION BOUNDARIES:** This plan is split into 3 waves. Each wave ends with a mandatory **STOP** marker. When you reach a STOP, commit everything, then pause and inform the user to start a new session for the next wave.

---

## Context for All Sessions

**Repository layout (working directory: `jules-controller/`):**
```
jules-controller/
├── .github/workflows/
│   ├── controller.yml          # Master dispatcher — runs Jules on all targets
│   ├── master-setup.yml        # Universal setup — deploys workflows/secrets to all repos
│   ├── auto-config-sync.yml    # Syncs Rome Time → UTC cron on jules_config.yml push
│   └── jules_agent.yml         # ← NOT the template; this is an empty placeholder (see templates/)
├── templates/
│   └── jules_agent.yml         # ← THE REAL TEMPLATE deployed to target repos
├── scripts/
│   └── sync-schedules.py       # Converts Rome Time → UTC cron in workflow files
├── calendar-integration/
│   └── src/index.ts            # Google Apps Script (TypeScript, compiled via esbuild)
│   └── dist/Code.js            # Compiled output — pushed to Google Apps Script via clasp
├── jules_config.yml            # Feature flags + schedules (central config)
└── jules_targets.yml           # Target repos + automations for cyclic dispatch
```

**Key behaviors to understand:**
- `templates/jules_agent.yml` is the file deployed to target repos by `master-setup.yml`. It has two job triggers: `workflow_dispatch` (called by controller/calendar) and `issues` (labeled "jules").
- `jules_config.yml` uses unquoted YAML booleans (e.g. `true`/`false`, never `'true'`/`'false'`).
- Apps Script is TypeScript compiled via `pnpm run build` in `calendar-integration/`. The output is `dist/Code.js`.
- There is no test framework. Verification = compilation success + manual code review.

---

## ═══════════════════════════════════════
## WAVE 1 — Bug Fixes
## Session 1 of 3
## ═══════════════════════════════════════

**Context:** 4 standalone bug fixes. Each fix is independent — if one has an issue, others can still be committed. All changes are in the `jules-controller/` directory.

---

### Task 1: Fix `templates/jules_agent.yml` — align issue trigger prompt

**Files:**
- Modify: `jules-controller/templates/jules_agent.yml`

**Background:** The `workflow_dispatch` trigger sends Jules a detailed prompt including headers (`DATABASE_CONTEXT`, `USER_REQUEST_ORIGIN`) and ISTRUZIONI CRITICHE (5 behavioral instructions). The `issues` trigger currently sends only the raw issue title/body with no behavioral context, so Jules may not follow the expected rules (create PR, no merge, Senior SWE role).

- [ ] **Step 1: Open and read the current issue trigger step**

  Open `jules-controller/templates/jules_agent.yml`. Find the step named `Invoke Jules (issue trigger)` (around line 91). The current `prompt:` block (indented 10 spaces under `with:`) currently ends with:
  ```
            ISTRUZIONI: Analizza la richiesta sopra ed esegui i cambiamenti necessari seguendo le best practice del progetto.
  ```

- [ ] **Step 2: Replace only the last `ISTRUZIONI:` line with the full ISTRUZIONI CRITICHE block**

  The exact text to find (including indentation — 12 spaces):
  ```
            ISTRUZIONI: Analizza la richiesta sopra ed esegui i cambiamenti necessari seguendo le best practice del progetto.
  ```
  Replace with (same 12-space indentation):
  ```
            ISTRUZIONI CRITICHE:
            1. Sei un Senior Software Engineer. Agisci con autonomia.
            2. Se il task richiede la creazione o modifica di un file, esegui il cambiamento DIRETTAMENTE.
            3. Crea SEMPRE una Pull Request con le modifiche effettuate.
            4. NON EFFETTUARE MAI IL MERGE della Pull Request. Il merge deve essere eseguito solo manualmente dall'utente.
            5. Lavora sul branch di default del repository.
  ```

- [ ] **Step 3: Verify YAML is valid**

  ```bash
  cd jules-controller
  python3 -c "import yaml; yaml.safe_load(open('templates/jules_agent.yml'))" && echo "✅ YAML valid"
  ```
  Expected: `✅ YAML valid`

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add templates/jules_agent.yml
  git commit -m "fix: align issue trigger prompt with dispatch trigger in jules_agent template"
  ```

---

### Task 2: Fix Apps Script — fragile `calendar_automation` config check

**Files:**
- Modify: `jules-controller/calendar-integration/src/index.ts`

**Background:** `triggerJulesOnGithub` (around line 84) currently checks:
```typescript
if (configText.includes("calendar_automation: false")) {
```
This is fragile — it would match a commented-out YAML line like `# calendar_automation: false`. The fix uses a regex that requires leading whitespace (the key is indented under `features:`), which excludes `#`-commented lines.

- [ ] **Step 1: Open index.ts and find the fragile check**

  Open `jules-controller/calendar-integration/src/index.ts`. Find the line:
  ```typescript
  if (configText.includes("calendar_automation: false")) {
  ```
  (around line 85)

- [ ] **Step 2: Replace with regex check**

  Replace that `if` block with:
  ```typescript
  const calendarDisabled = /^\s+calendar_automation\s*:\s*false\s*$/m.test(configText);
  if (calendarDisabled) {
  ```
  Keep the rest of the block (`console.warn(...)`, `return false;`) unchanged.

- [ ] **Step 3: Verify compilation**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```
  Expected: exits with code 0, `dist/Code.js` is updated.

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add calendar-integration/src/index.ts calendar-integration/dist/Code.js
  git commit -m "fix: replace fragile string match with regex for calendar_automation config check"
  ```

---

### Task 3: Fix `sync-schedules.py` — add `auto-config-sync.yml` to cron mapping

**Files:**
- Modify: `jules-controller/scripts/sync-schedules.py`
- Modify: `jules-controller/jules_config.yml`

**Background:** `auto-config-sync.yml` has a hardcoded `cron: '0 0 * * *'` that is never updated when the Rome timezone offset changes (CET/CEST). The fix adds it to the sync mapping.

- [ ] **Step 1: Add `auto_config_sync_time` to `jules_config.yml`**

  Open `jules-controller/jules_config.yml`. Find the `schedules:` block (currently has `setup_sync_time` and `master_controller_time`). Add a new entry:
  ```yaml
  schedules:
    setup_sync_time: "03:00"
    master_controller_time: "04:00"
    auto_config_sync_time: "01:00"   # ← ADD THIS LINE
  ```

- [ ] **Step 2: Add mapping entry to `sync-schedules.py`**

  Open `jules-controller/scripts/sync-schedules.py`. Find the `mapping` dict (around line 68):
  ```python
  mapping = {
      'setup_sync_time': ['master-setup.yml'],
      'master_controller_time': ['controller.yml']
  }
  ```
  Add the new entry:
  ```python
  mapping = {
      'setup_sync_time': ['master-setup.yml'],
      'master_controller_time': ['controller.yml'],
      'auto_config_sync_time': ['auto-config-sync.yml']  # ← ADD THIS LINE
  }
  ```

- [ ] **Step 3: Verify the script runs without errors**

  ```bash
  cd jules-controller
  python3 scripts/sync-schedules.py
  ```
  Expected output: lines like `SUCCESS: Updated auto-config-sync.yml -> 0 0 * * *` (or `INFO: ... already synced.`). No `ERROR` lines.

- [ ] **Step 4: Verify `auto-config-sync.yml` cron was updated correctly**

  ```bash
  cd jules-controller && grep "cron:" .github/workflows/auto-config-sync.yml
  ```
  Expected cron for `01:00` Rome time:
  - **CET (winter, UTC+1):** `0 0 * * *`
  - **CEST (summer, UTC+2):** `0 23 * * *`

- [ ] **Step 5: Commit**

  ```bash
  cd jules-controller
  git add jules_config.yml scripts/sync-schedules.py .github/workflows/auto-config-sync.yml
  git commit -m "fix: add auto-config-sync.yml to cron sync mapping and jules_config schedules"
  ```

---

### Task 4: Fix Apps Script — `fetchAllTargets` affiliation inconsistency

**Files:**
- Modify: `jules-controller/calendar-integration/src/index.ts`

**Background:** `fetchAllTargets` (around line 172) uses `affiliation=owner`, which misses repos where the user is a collaborator. `master-setup.yml` correctly uses `permissions.push == true`. This inconsistency means calendar `Jules: all` dispatches miss collaborator repos that `master-setup` would process.

- [ ] **Step 1: Find and update the API URL in `fetchAllTargets`**

  Open `jules-controller/calendar-integration/src/index.ts`. Find the line in `fetchAllTargets`:
  ```typescript
  const url = `${GITHUB_API_URL}/user/repos?visibility=all&affiliation=owner&per_page=100`;
  ```
  Replace with:
  ```typescript
  const url = `${GITHUB_API_URL}/user/repos?visibility=all&affiliation=owner,collaborator&per_page=100`;
  ```

- [ ] **Step 2: Update the response filter to match `master-setup.yml` logic**

  In the same function, find the `.filter()` call:
  ```typescript
  return reposData
      .filter((repo: any) => !repo.archived)
      .map((repo: any) => repo.full_name);
  ```
  Replace with:
  ```typescript
  return reposData
      .filter((repo: any) => !repo.archived && repo.permissions?.push === true)
      .map((repo: any) => repo.full_name);
  ```

- [ ] **Step 3: Verify compilation**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```
  Expected: exits with code 0.

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add calendar-integration/src/index.ts calendar-integration/dist/Code.js
  git commit -m "fix: align fetchAllTargets affiliation and permission filter with master-setup logic"
  ```

---

## ✅ WAVE 1 COMPLETE

- [ ] **Final Wave 1 verification:**

  ```bash
  cd jules-controller
  git log --oneline -5
  ```
  Expected: 4 commits visible (tasks 1–4).

  ```bash
  python3 -c "import yaml; yaml.safe_load(open('templates/jules_agent.yml')); yaml.safe_load(open('jules_config.yml'))" && echo "✅ All YAML valid"
  ```

  ```bash
  cd calendar-integration && pnpm run build && echo "✅ TypeScript compiles"
  ```

## 🛑 STOP — END OF SESSION 1

**Inform the user:** "Wave 1 completata. Tutte le modifiche sono committate. Per procedere con Wave 2 (feature workflow), inizia una nuova sessione e apri il piano in `docs/superpowers/plans/2026-03-22-jules-improvements.md`. Inizia dalla sezione WAVE 2."

---

## ═══════════════════════════════════════
## WAVE 2 — Workflow Feature Additions
## Session 2 of 3
## ═══════════════════════════════════════

**Context for this session:** Wave 1 bug fixes are complete and committed. This wave adds 4 new features to the GitHub Actions workflows and config files. No Apps Script changes in this wave.

**Files touched in this wave:**
- `jules-controller/jules_config.yml` — add `excluded_repos` list
- `jules-controller/jules_targets.yml` — add `enabled` and `schedule` example fields
- `jules-controller/.github/workflows/controller.yml` — add `enabled` check, `dry_run` input, `schedule` granularity
- `jules-controller/.github/workflows/master-setup.yml` — add exclusion list logic

**Before starting:** Verify you are in the `jules-controller/` repo and on the correct branch:
```bash
cd jules-controller
git log --oneline -5
```
You should see the 4 Wave 1 commits.

---

### Task 5: Add per-automation `enabled` flag in `controller.yml`

**Files:**
- Modify: `jules-controller/.github/workflows/controller.yml`
- Modify: `jules-controller/jules_targets.yml` (example/documentation)

**Background:** `controller.yml` currently dispatches every automation in every target unconditionally. Adding an `enabled: false` field allows temporarily disabling an automation without deleting it from config.

- [ ] **Step 1: Read the inner loop in `controller.yml`**

  Open `jules-controller/.github/workflows/controller.yml`. Find the section that reads each automation:
  ```bash
  echo "$target" | jq -c '.automations[]' | while read -r automation; do
    NAME=$(echo "$automation" | jq -r '.name')
    PROMPT=$(echo "$automation" | jq -r '.prompt')
  ```
  This is inside the "Run Jules on all targets" step.

- [ ] **Step 2: Add enabled check immediately after NAME is read**

  After the `NAME` and `PROMPT` variable assignments (and after the existing null-check for `$NAME`), add:
  ```bash
  ENABLED=$(echo "$automation" | jq -r '.enabled // true')
  if [ "$ENABLED" != "true" ]; then
    echo "  ⏸️  Skipping [$NAME] in $REPO — automation is disabled (enabled: false)"
    continue
  fi
  ```
  Insert this block before the `echo "  🤖 Triggering [$NAME]..."` line.

- [ ] **Step 3: Verify YAML is valid**

  ```bash
  cd jules-controller
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/controller.yml'))" && echo "✅ YAML valid"
  ```

- [ ] **Step 4: Add example `enabled: false` to `jules_targets.yml` as documentation**

  Open `jules-controller/jules_targets.yml`. In the TEMPLATE section (commented out), find the automation template block. Add a commented-out example line showing the `enabled` field:
  ```yaml
  #      - name: "<nome-automazione>"
  #        enabled: false   # Imposta a false per disabilitare temporaneamente
  #        prompt: |
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd jules-controller
  git add .github/workflows/controller.yml jules_targets.yml
  git commit -m "feat: add per-automation enabled flag support to controller.yml"
  ```

---

### Task 6: Add repo exclusion list to `master-setup.yml`

**Files:**
- Modify: `jules-controller/jules_config.yml`
- Modify: `jules-controller/.github/workflows/master-setup.yml`

**Background:** `master-setup.yml` currently processes ALL repos with push access. There is no way to exclude repos (e.g., `jules-controller` itself, forks, test repos). The fix reads an `excluded_repos` list from `jules_config.yml`.

- [ ] **Step 1: Add `excluded_repos` to `jules_config.yml`**

  Open `jules-controller/jules_config.yml`. Add the following at the end of the file (after the `schedules:` block):
  ```yaml

  # 3. Exclusion List (Repos esclusi dal Universal Setup)
  # Questi repository non riceveranno jules_agent.yml, secrets, labels o branch protection.
  excluded_repos:
    - "GabryXn/jules-controller"   # Il controller stesso — non deve essere un target
  ```

- [ ] **Step 2: Add exclusion check to `master-setup.yml`**

  Open `jules-controller/.github/workflows/master-setup.yml`. Find the "Run Sequential Setup" step. Immediately after the line that reads `repos_list.txt` is created:
  ```bash
  gh api --paginate "/user/repos?per_page=100" | jq -r '...' > repos_list.txt
  ```
  And BEFORE the `while read -r REPO DEFAULT_BRANCH; do` loop, add:
  ```bash
  # Build exclusion pattern from jules_config.yml
  EXCLUDED=$(yq eval '.excluded_repos[]' jules_config.yml 2>/dev/null | sed 's/[.[\*^${}\\+?|()]/\\&/g' | tr '\n' '|' | sed 's/|$//')
  echo "🚫 Excluded repos pattern: ${EXCLUDED:-'(none)'}"
  ```

  Then, inside the loop, immediately after the `if [ "$REPO" == "$GITHUB_REPOSITORY" ]; then continue; fi` line and **before the opening `(` of the subshell**, add:
  ```bash
  # Skip explicitly excluded repos (outside subshell so `continue` works on the outer loop)
  if [ -n "$EXCLUDED" ] && echo "$REPO" | grep -qE "^(${EXCLUDED})$"; then
    echo "⏩ Skipping excluded repo: $REPO"
    continue
  fi
  ```
  > **Note:** Place this block between the self-exclusion `continue` and the `(` that opens the subshell. Putting it outside the subshell ensures `continue` skips the entire per-repo processing block efficiently.

- [ ] **Step 3: Verify YAML is valid**

  ```bash
  cd jules-controller
  python3 -c "import yaml; yaml.safe_load(open('jules_config.yml'))" && echo "✅ YAML valid"
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/master-setup.yml'))" && echo "✅ YAML valid"
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add jules_config.yml .github/workflows/master-setup.yml
  git commit -m "feat: add excluded_repos list to jules_config and master-setup exclusion check"
  ```

---

### Task 7: Add dry-run mode to `controller.yml`

**Files:**
- Modify: `jules-controller/.github/workflows/controller.yml`

**Background:** There is no way to test which automations would be dispatched without actually running Jules. A `dry_run` boolean input logs what would happen without calling `gh workflow run`. It only affects manual (`workflow_dispatch`) runs — cron runs always execute normally.

- [ ] **Step 1: Add `dry_run` input to the `workflow_dispatch` trigger**

  Open `jules-controller/.github/workflows/controller.yml`. Find the `on:` block at the top. The cron value may have changed if Task 3 ran `sync-schedules.py` — find the `workflow_dispatch:` line regardless of the exact cron value. The structure to match is:
  ```yaml
  on:
    schedule:
      - cron: '<any value here>'
    workflow_dispatch:
  ```
  Replace **only** the bare `workflow_dispatch:` line with the expanded version below. **Do not touch** the `schedule:` or `cron:` lines — leave them exactly as they are in the file:
  ```yaml
    workflow_dispatch:
      inputs:
        dry_run:
          description: 'Log dispatches without executing them (manual runs only)'
          required: false
          default: 'false'
          type: boolean
  ```
  The result should be the existing `schedule: / cron:` block unchanged, followed immediately by this new `workflow_dispatch:` block.

- [ ] **Step 2: Replace the dispatch call with dry-run-aware version**

  Find the dispatch call in the "Run Jules on all targets" step:
  ```bash
  DISPATCH_OUTPUT=$(gh workflow run jules_agent.yml -R "$REPO" -f prompt="$PROMPT" 2>&1)
  DISPATCH_STATUS=$?

  if [ $DISPATCH_STATUS -eq 0 ]; then
    echo "  ✅ Successfully dispatched [$NAME] to $REPO"
  else
    echo "  🚨 FAILED to dispatch [$NAME] to $REPO"
    echo "     Error details: $DISPATCH_OUTPUT"
    if [[ "$DISPATCH_OUTPUT" == *"Could not find"* ]]; then
      echo "     💡 TIP: Verify that '.github/workflows/jules_agent.yml' exists in $REPO"
    elif [[ "$DISPATCH_OUTPUT" == *"404"* ]]; then
      echo "     💡 TIP: Check if PAT_TOKEN has access to $REPO"
    fi
  fi
  ```
  Replace with:
  ```bash
  if [ "${{ inputs.dry_run }}" == "true" ]; then
    echo "  [DRY RUN] Would dispatch [$NAME] to $REPO"
  else
    DISPATCH_OUTPUT=$(gh workflow run jules_agent.yml -R "$REPO" -f prompt="$PROMPT" 2>&1)
    DISPATCH_STATUS=$?

    if [ $DISPATCH_STATUS -eq 0 ]; then
      echo "  ✅ Successfully dispatched [$NAME] to $REPO"
    else
      echo "  🚨 FAILED to dispatch [$NAME] to $REPO"
      echo "     Error details: $DISPATCH_OUTPUT"
      if [[ "$DISPATCH_OUTPUT" == *"Could not find"* ]]; then
        echo "     💡 TIP: Verify that '.github/workflows/jules_agent.yml' exists in $REPO"
      elif [[ "$DISPATCH_OUTPUT" == *"404"* ]]; then
        echo "     💡 TIP: Check if PAT_TOKEN has access to $REPO"
      fi
    fi
  fi
  ```

- [ ] **Step 3: Verify YAML is valid**

  ```bash
  cd jules-controller
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/controller.yml'))" && echo "✅ YAML valid"
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add .github/workflows/controller.yml
  git commit -m "feat: add dry_run mode to controller.yml for safe dispatch testing"
  ```

---

### Task 8: Add per-automation schedule granularity to `controller.yml`

**Files:**
- Modify: `jules-controller/.github/workflows/controller.yml`
- Modify: `jules-controller/jules_targets.yml` (example)

**Background:** All automations currently run every day. Adding an optional `schedule` field per-automation (`"daily"` / `"weekly"` / `"monthly"`) lets different automations run at different frequencies. Dates are evaluated in UTC (GitHub Actions runner timezone).

- [ ] **Step 1: Add the schedule check inside the automation loop in `controller.yml`**

  In the "Run Jules on all targets" step, find where `NAME` and `ENABLED` are read. After the enabled check (added in Task 5), add the schedule check:
  ```bash
  SCHEDULE=$(echo "$automation" | jq -r '.schedule // "daily"')
  DOW=$(date -u +%u)   # 1=Monday ... 7=Sunday (UTC)
  DOM=$(date -u +%d)   # 01-31 (UTC)

  SHOULD_RUN=false
  case "$SCHEDULE" in
    daily)   SHOULD_RUN=true ;;
    weekly)  [ "$DOW" == "1" ] && SHOULD_RUN=true ;;
    monthly) [ "$DOM" == "01" ] && SHOULD_RUN=true ;;
    *)       echo "  ⚠️ Unknown schedule '$SCHEDULE' for [$NAME], defaulting to daily"; SHOULD_RUN=true ;;
  esac

  if [ "$SHOULD_RUN" != "true" ]; then
    echo "  ⏩ Skipping [$NAME] in $REPO — schedule '$SCHEDULE' not due today (UTC dow=$DOW dom=$DOM)"
    continue
  fi
  ```
  Insert this block before the `echo "  🤖 Triggering [$NAME]..."` line (but after the enabled check).

- [ ] **Step 2: Add `schedule` examples to `jules_targets.yml` template section**

  In the commented template section at the bottom of `jules_targets.yml`, add a `schedule` example:
  ```yaml
  #      - name: "<nome-automazione>"
  #        schedule: "weekly"   # Opzioni: "daily" (default), "weekly" (lunedì), "monthly" (1° del mese)
  #        prompt: |
  ```

  Also add `schedule: "weekly"` to the existing `vulnerability-scan` automations in the active targets section to show a real example:
  ```yaml
  - name: "vulnerability-scan"
    schedule: "weekly"
    prompt: |
      ...
  ```

- [ ] **Step 3: Verify YAML is valid**

  ```bash
  cd jules-controller
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/controller.yml'))" && echo "✅ YAML valid"
  python3 -c "import yaml; yaml.safe_load(open('jules_targets.yml'))" && echo "✅ YAML valid"
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add .github/workflows/controller.yml jules_targets.yml
  git commit -m "feat: add per-automation schedule granularity (daily/weekly/monthly) to controller.yml"
  ```

---

## ✅ WAVE 2 COMPLETE

- [ ] **Final Wave 2 verification:**

  ```bash
  cd jules-controller
  git log --oneline -8
  ```
  Expected: 8 commits total (4 from Wave 1 + 4 from Wave 2).

  ```bash
  for f in jules_config.yml jules_targets.yml .github/workflows/controller.yml .github/workflows/master-setup.yml; do
    python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "✅ $f"
  done
  ```
  Expected: all 4 files report `✅`.

## 🛑 STOP — END OF SESSION 2

**Inform the user:** "Wave 2 completata. Tutte le feature workflow sono committate. Per procedere con Wave 3 (recurring calendar events — refactoring Apps Script), inizia una nuova sessione e apri il piano in `docs/superpowers/plans/2026-03-22-jules-improvements.md`. Inizia dalla sezione WAVE 3."

---

## ═══════════════════════════════════════
## WAVE 3 — Recurring Calendar Events
## Session 3 of 3
## ═══════════════════════════════════════

**Context for this session:** Wave 1 and Wave 2 are complete and committed. This wave refactors `calendar-integration/src/index.ts` to support recurring Google Calendar events.

**Before starting:** Verify the repo state:
```bash
cd jules-controller
git log --oneline -8
```
Expected: 8 commits (4 Wave 1 + 4 Wave 2).

**The problem this wave solves:** When a recurring calendar event (e.g., daily at 22:00) is created, the current code fires Jules only on the FIRST occurrence. This happens because all occurrences of a recurring series share the same `eventId` in Google Calendar. The state store is keyed by `eventId`, so once the first occurrence is marked as triggered, subsequent ones are deduplicated and skipped.

**The solution:** Change the state key from bare `eventId` to a composite key `eventId + "_" + startTime.getTime()`. This makes each occurrence of a recurring series a distinct trackable entry. Additionally, add a 6-hour periodic re-scan trigger to pick up future occurrences as they enter the 14-day scheduling window.

**File to modify:** `jules-controller/calendar-integration/src/index.ts`

---

### Task 9: Update `processCalendarEvents` to use composite state keys

**Files:**
- Modify: `jules-controller/calendar-integration/src/index.ts`

**Background:** `processCalendarEvents` (around line 343) has 3 places where it uses `eventId` as the `scheduledEvents` state key. These must all switch to composite keys. The `activeJulesEvents` Map remains keyed by bare `eventId` (it is only used for internal lookups, not persisted state).

- [ ] **Step 1: Read `processCalendarEvents` fully**

  Open `jules-controller/calendar-integration/src/index.ts`. Read the entire `processCalendarEvents` function (lines ~343–430). Identify the sites to change:
  1. **`activeJulesEvents` population** (around line 362): `activeJulesEvents.set(event.getId(), event)` — must switch to composite key
  2. **Cleanup loop** (around line 371): iterates `for (const eventId in scheduledEvents)` — key variable, lookup, and delete must all use composite key
  3. **Edit detection** (around line 385): `scheduledEvents[eventId]` read/write — must use composite key; also must guard with `!scheduledData.lastTriggered`
  4. **Creation pass** (around line 403): `scheduledEvents[eventId] = { ... }` — must use composite key

- [ ] **Step 2: Update `activeJulesEvents` population (site 0 — prerequisite)**

  > **Why this matters:** Google Calendar event IDs can contain underscores. If `activeJulesEvents` is keyed by bare `eventId`, all occurrences of a recurring series (which share the same `eventId`) overwrite each other in the Map, leaving only the last occurrence. Keying by composite key fixes this.

  Find:
  ```typescript
  events.forEach(event => {
      const title = event.getTitle() || '';
      if (extractTargetRepos(title).length > 0) {
          activeJulesEvents.set(event.getId(), event);
      }
  });
  ```
  Replace with:
  ```typescript
  events.forEach(event => {
      const title = event.getTitle() || '';
      if (extractTargetRepos(title).length > 0) {
          const compositeKey = event.getId() + '_' + event.getStartTime().getTime();
          activeJulesEvents.set(compositeKey, event);
      }
  });
  ```

  Also update the Map declaration (search for `new Map<string, GoogleAppsScript.Calendar.CalendarEvent>()` a few lines above) — no type change needed, just confirm it stays `Map<string, CalendarEvent>`.

- [ ] **Step 3: Update the cleanup loop (site 2)**

  Find:
  ```typescript
  for (const eventId in scheduledEvents) {
      const scheduledData = scheduledEvents[eventId];
      const activeEvent = activeJulesEvents.get(eventId);
  ```
  Replace with:
  ```typescript
  for (const compositeKey in scheduledEvents) {
      const scheduledData = scheduledEvents[compositeKey];
      const activeEvent = activeJulesEvents.get(compositeKey); // direct lookup — map is now composite-keyed
  ```

  Then find `delete scheduledEvents[eventId]` within this loop and replace with `delete scheduledEvents[compositeKey]`.

  The `cancelSurgicalTrigger` call uses `scheduledData.triggerId` — no change needed.

- [ ] **Step 4: Update the edit detection block (site 3)**

  Find the checksum comparison block inside the cleanup loop:
  ```typescript
  const currentChecksum = generateEventChecksum(activeEvent);
  if (scheduledData.checksum !== currentChecksum) {
      console.log(`Event ${eventId} modified. Rescheduling...`);
      cancelSurgicalTrigger(scheduledData.triggerId);

      const newStartTime = activeEvent.getStartTime();
      const newTriggerId = createTimeDrivenTriggerForEvent(eventId, newStartTime);
      scheduledEvents[eventId] = {
  ```
  Replace the entire `if` block with (using composite key, guarding against already-triggered occurrences):
  ```typescript
  const currentChecksum = generateEventChecksum(activeEvent);
  if (scheduledData.checksum !== currentChecksum && !scheduledData.lastTriggered) {
      console.log(`Event modified (occurrence ${compositeKey}). Rescheduling...`);
      cancelSurgicalTrigger(scheduledData.triggerId);

      const newStartTime = activeEvent.getStartTime();
      const newCompositeKey = activeEvent.getId() + '_' + newStartTime.getTime();
      const newTriggerId = createTimeDrivenTriggerForEvent(activeEvent.getId(), newStartTime);
      delete scheduledEvents[compositeKey];
      scheduledEvents[newCompositeKey] = {
          time: newStartTime.getTime(),
          checksum: currentChecksum,
          triggerId: newTriggerId
      };
      stateChanged = true;
  }
  ```

- [ ] **Step 5: Update the creation pass (site 4)**

  Find:
  ```typescript
  activeJulesEvents.forEach((event, eventId) => {
      if (!scheduledEvents[eventId]) {
          const startTime = event.getStartTime();
          if (startTime.getTime() < now.getTime()) return;

          const checksum = generateEventChecksum(event);
          const triggerId = createTimeDrivenTriggerForEvent(eventId, startTime);

          console.log(`New event detected: ${event.getTitle()}. Scheduling trigger.`);
          scheduledEvents[eventId] = {
              time: startTime.getTime(),
              checksum: checksum,
              triggerId: triggerId
          };
          stateChanged = true;
      }
  });
  ```
  Replace with:
  ```typescript
  activeJulesEvents.forEach((event, compositeKey) => {
      if (!scheduledEvents[compositeKey]) {
          const startTime = event.getStartTime();
          if (startTime.getTime() < now.getTime()) return;

          const checksum = generateEventChecksum(event);
          const triggerId = createTimeDrivenTriggerForEvent(event.getId(), startTime);

          console.log(`New event detected: ${event.getTitle()} (${compositeKey}). Scheduling trigger.`);
          scheduledEvents[compositeKey] = {
              time: startTime.getTime(),
              checksum: checksum,
              triggerId: triggerId
          };
          stateChanged = true;
      }
  });
  ```

- [ ] **Step 5: Verify compilation**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```
  Expected: exits code 0.

- [ ] **Step 6: Commit**

  ```bash
  cd jules-controller
  git add calendar-integration/src/index.ts calendar-integration/dist/Code.js
  git commit -m "refactor: update processCalendarEvents to use composite eventId_startTime state keys"
  ```

---

### Task 10: Update `checkAndTriggerJules` to use composite state keys

**Files:**
- Modify: `jules-controller/calendar-integration/src/index.ts`

**Background:** `checkAndTriggerJules` (around line 215) is the function fired by time-driven triggers. It scans a 2-minute window for Jules events and dispatches. It currently reads/writes state using bare `eventId` — it must switch to composite keys for deduplication and state updates.

- [ ] **Step 1: Read `checkAndTriggerJules` fully**

  Find the `events.forEach(event => { ... })` loop inside `checkAndTriggerJules` (around lines 246–310). Identify the state access points:
  1. Line ~257: `const eventData = scheduledEvents[eventId];` — **dedup read**
  2. Line ~302–305: `scheduledEvents[eventId] = { ... }` and `scheduledEvents[eventId].lastTriggered = nowMs` — **state write**

- [ ] **Step 2: Add composite key computation at the top of the forEach loop**

  Find:
  ```typescript
  events.forEach(event => {
      const eventId = event.getId();
      const title = event.getTitle() || '';
      const targetRepos = extractTargetRepos(title);
  ```
  Replace with:
  ```typescript
  events.forEach(event => {
      const eventId = event.getId();
      const compositeKey = eventId + '_' + event.getStartTime().getTime(); // unique per occurrence
      const title = event.getTitle() || '';
      const targetRepos = extractTargetRepos(title);
  ```

- [ ] **Step 3: Update the dedup read to use composite key**

  Find:
  ```typescript
  const eventData = scheduledEvents[eventId];
  const lastTriggered = eventData ? (eventData.lastTriggered || 0) : 0;
  const minInterval = 5 * 60 * 1000;

  if (nowMs - lastTriggered < minInterval) {
      console.log(`⏩ Skipping event "${title}" (ID: ${eventId}) - Already triggered recently at ${new Date(lastTriggered)}`);
      return;
  }
  ```
  Replace with:
  ```typescript
  const eventData = scheduledEvents[compositeKey]; // ← use compositeKey
  const lastTriggered = eventData ? (eventData.lastTriggered || 0) : 0;
  const minInterval = 5 * 60 * 1000;

  if (nowMs - lastTriggered < minInterval) {
      console.log(`⏩ Skipping event "${title}" (key: ${compositeKey}) - Already triggered recently at ${new Date(lastTriggered)}`);
      return;
  }
  ```

- [ ] **Step 4: Update the state write to use composite key**

  Find:
  ```typescript
  if (eventTriggered) {
      if (!scheduledEvents[eventId]) {
          scheduledEvents[eventId] = { time: eventStartTime, checksum: generateEventChecksum(event) };
      }
      scheduledEvents[eventId].lastTriggered = nowMs;
      stateChanged = true;
  }
  ```
  Replace with:
  ```typescript
  if (eventTriggered) {
      if (!scheduledEvents[compositeKey]) {
          scheduledEvents[compositeKey] = { time: eventStartTime, checksum: generateEventChecksum(event) };
      }
      scheduledEvents[compositeKey].lastTriggered = nowMs;
      stateChanged = true;
  }
  ```

- [ ] **Step 5: Verify compilation**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```
  Expected: exits code 0.

- [ ] **Step 6: Commit**

  ```bash
  cd jules-controller
  git add calendar-integration/src/index.ts calendar-integration/dist/Code.js
  git commit -m "refactor: update checkAndTriggerJules to use composite eventId_startTime state keys"
  ```

---

### Task 11: Update `setupCalendarTrigger` — migration + 6h periodic trigger

**Files:**
- Modify: `jules-controller/calendar-integration/src/index.ts`

**Background:** Two changes to `setupCalendarTrigger`:
1. **Migration procedure:** The state schema change is breaking. When the new code is deployed, `setupCalendarTrigger` must be run manually to wipe old state and create clean triggers. The function is updated to perform this migration safely.
2. **6h periodic trigger:** A new `processCalendarEvents` CLOCK trigger every 6 hours ensures future recurring occurrences are scheduled as they enter the 14-day window (currently, rescanning only happens on calendar edits).

**IMPORTANT — Correct operation order:** Old `checkAndTriggerJules` triggers must be deleted **BEFORE** wiping `SCHEDULED_EVENTS`. This eliminates the race window where an old trigger could fire against empty state and create a stale bare-`eventId` entry.

- [ ] **Step 1: Read `setupCalendarTrigger` fully**

  Find `setupCalendarTrigger` (around line 471). Current implementation only creates the `onCalendarEvent` trigger if absent. No state cleanup exists.

- [ ] **Step 2: Replace `setupCalendarTrigger` with the migration + periodic trigger version**

  Replace the entire function body:
  ```typescript
  export function setupCalendarTrigger() {
    // ── STEP 1: Delete all old checkAndTriggerJules triggers FIRST ──────────
    // Must happen before wiping state to avoid a race window where an old
    // trigger fires against empty SCHEDULED_EVENTS and writes stale bare keys.
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === 'checkAndTriggerJules')
      .forEach(t => ScriptApp.deleteTrigger(t));
    console.log('✅ Cleaned up old checkAndTriggerJules triggers.');

    // ── STEP 2: Wipe stale state (safe now — no old triggers can fire) ───────
    PropertiesService.getScriptProperties().deleteProperty('SCHEDULED_EVENTS');
    console.log('✅ Cleared SCHEDULED_EVENTS state (migration wipe).');

    // ── STEP 3: Set up onCalendarEvent trigger (idempotent) ─────────────────
    const hasCalendarTrigger = ScriptApp.getProjectTriggers()
      .some(t => t.getHandlerFunction() === 'onCalendarEvent');
    if (!hasCalendarTrigger) {
      const calendar = CalendarApp.getDefaultCalendar();
      ScriptApp.newTrigger('onCalendarEvent')
        .forUserCalendar(calendar.getId())
        .onEventUpdated()
        .create();
      console.log('✅ Calendar OnChange trigger created.');
    } else {
      console.log('ℹ️  Calendar OnChange trigger already exists.');
    }

    // ── STEP 4: Set up 6-hour periodic rescan trigger (idempotent) ──────────
    // Needed for recurring events: ensures future occurrences are scheduled
    // as they enter the 14-day window, even without calendar edits.
    const hasPeriodicTrigger = ScriptApp.getProjectTriggers()
      .some(t => t.getHandlerFunction() === 'processCalendarEvents' &&
                 t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK);
    if (!hasPeriodicTrigger) {
      ScriptApp.newTrigger('processCalendarEvents')
        .timeBased()
        .everyHours(6)
        .create();
      console.log('✅ 6-hour periodic processCalendarEvents trigger created.');
    } else {
      console.log('ℹ️  Periodic trigger already exists.');
    }

    // ── STEP 5: Run initial scan to rebuild state with composite keys ────────
    processCalendarEvents();
    console.log('✅ Initial calendar scan complete. Setup done.');
  }
  ```

- [ ] **Step 3: Verify compilation**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```
  Expected: exits code 0.

- [ ] **Step 4: Commit**

  ```bash
  cd jules-controller
  git add calendar-integration/src/index.ts calendar-integration/dist/Code.js
  git commit -m "feat: update setupCalendarTrigger with migration wipe and 6h periodic rescan trigger"
  ```

---

### Task 12: Deploy to Google Apps Script and run migration

**Files:**
- Read: `jules-controller/calendar-integration/.clasp.json` (to confirm deployment target)

**Background:** The compiled `dist/Code.js` must be pushed to Google Apps Script via `clasp push`. Then `setupCalendarTrigger()` must be run once manually from the Apps Script editor to perform the migration.

- [ ] **Step 1: Verify build is up to date**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run build
  ```

- [ ] **Step 2: Push to Google Apps Script**

  ```bash
  cd jules-controller/calendar-integration
  pnpm run deploy
  ```
  Expected: `clasp` pushes `dist/Code.js` and `dist/appsscript.json` to the remote script. Output should include `Pushed X files.`

  > If `clasp` is not authenticated, run `pnpm run login` first (opens browser for Google auth).

- [ ] **Step 3: Run migration in Apps Script editor**

  1. Open the Google Apps Script project (URL in `.clasp.json` → `scriptId`)
  2. In the editor, select function `setupCalendarTrigger` from the dropdown
  3. Click **Run**
  4. Check the **Execution log** — expected output:
     ```
     ✅ Cleaned up old checkAndTriggerJules triggers.
     ✅ Cleared SCHEDULED_EVENTS state (migration wipe).
     ✅ Calendar OnChange trigger created. (or: ℹ️  already exists)
     ✅ 6-hour periodic processCalendarEvents trigger created. (or: ℹ️  already exists)
     ✅ Initial calendar scan complete. Setup done.
     ```

  > **If you see a lock error** (e.g., `Could not obtain lock after 30000ms`) before `"Initial calendar scan complete"`: this means a calendar trigger fired concurrently during migration. This is harmless — the old triggers were already deleted. Wait 30 seconds and either re-run `setupCalendarTrigger()` (Step 3 is idempotent) or run `processCalendarEvents()` directly to rebuild state.

- [ ] **Step 4: Verify triggers are set up correctly**

  In the Apps Script editor, go to **Triggers** (clock icon in left sidebar). Verify:
  - One `onCalendarEvent` trigger of type "Calendar updated"
  - One `processCalendarEvents` trigger of type "Time-driven / Every 6 hours"
  - Zero `checkAndTriggerJules` triggers (they are created on-demand by `createTimeDrivenTriggerForEvent`)

- [ ] **Step 5: Final commit**

  ```bash
  cd jules-controller
  git add calendar-integration/dist/Code.js
  git commit -m "chore: rebuild dist/Code.js after Wave 3 Apps Script refactoring"
  ```

---

## ✅ WAVE 3 COMPLETE

- [ ] **Final Wave 3 verification:**

  ```bash
  cd jules-controller
  git log --oneline -12
  ```
  Expected: 12 commits total (4 Wave 1 + 4 Wave 2 + 4 Wave 3).

  ```bash
  cd calendar-integration && pnpm run build && echo "✅ TypeScript compiles clean"
  ```

  **Manual verification (optional but recommended):** Create a test recurring Google Calendar event:
  - Title: `Jules: GabryXn/rpg-life-companion - Test ricorrente`
  - Description: any text
  - Repeat: daily at the next convenient time
  - Verify that after the first occurrence fires, the second occurrence's trigger appears in Apps Script Triggers (it should NOT be missing).

## 🛑 STOP — END OF SESSION 3 (ALL WAVES COMPLETE)

**Inform the user:** "Tutte e 3 le wave sono completate. Il piano implementativo è terminato. Ricorda di eseguire `setupCalendarTrigger()` manualmente nell'editor Apps Script se non l'hai già fatto durante Wave 3."

---

## Summary of All Changes

| Wave | Task | File | Type |
|------|------|------|------|
| 1 | Fix issue trigger prompt | `templates/jules_agent.yml` | Bug fix |
| 1 | Fix calendar_automation check | `calendar-integration/src/index.ts` | Bug fix |
| 1 | Add auto-config-sync to cron sync | `scripts/sync-schedules.py` + `jules_config.yml` | Bug fix |
| 1 | Fix fetchAllTargets affiliation | `calendar-integration/src/index.ts` | Bug fix |
| 2 | Per-automation enabled flag | `controller.yml` + `jules_targets.yml` | Feature |
| 2 | Repo exclusion list | `jules_config.yml` + `master-setup.yml` | Feature |
| 2 | Dry-run mode | `controller.yml` | Feature |
| 2 | Schedule granularity | `controller.yml` + `jules_targets.yml` | Feature |
| 3 | Composite key in processCalendarEvents | `calendar-integration/src/index.ts` | Refactor |
| 3 | Composite key in checkAndTriggerJules | `calendar-integration/src/index.ts` | Refactor |
| 3 | Migration + 6h trigger in setupCalendarTrigger | `calendar-integration/src/index.ts` | Feature |
| 3 | Deploy to Apps Script + run migration | `dist/Code.js` | Deploy |
