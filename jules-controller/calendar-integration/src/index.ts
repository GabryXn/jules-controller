/**
 * JULES CALENDAR INTEGRATION — Google Apps Script
 *
 * Monitors Google Calendar for "Jules: owner/repo" events and dispatches
 * GitHub Actions workflows. Supports one-off AND recurring events.
 *
 * Architecture (event-driven, no polling):
 *   - onCalendarEvent (calendar onChange)    → processCalendarEvents()
 *   - 6-hour periodic safety-net            → processCalendarEvents()
 *   - Per-event time-driven trigger          → checkAndTriggerJules()
 *
 * Recurring event strategy:
 *   Up to TRIGGERS_PER_SERIES occurrences per event series are scheduled
 *   as triggers. When one fires, processCalendarEvents() runs again and
 *   schedules the next in line. The second trigger acts as a safety net
 *   if the first invocation fails (timeout, quota, etc.).
 *   Trigger count = (active series × TRIGGERS_PER_SERIES) + 2 system.
 */

const GITHUB_API_URL = 'https://api.github.com';
const WORKFLOW_NAME = 'jules_agent.yml';

/** How far ahead to scan for future events */
const LOOKAHEAD_DAYS = 14;
/** Grace period: don't clean up events until this long after their start */
const CLEANUP_GRACE_MS = 30 * 60 * 1000; // 30 minutes
/** Maximum per-event triggers to create (leaves room for system triggers) */
const MAX_EVENT_TRIGGERS = 17; // 20 GAS limit - 2 system - 1 buffer
/** How many triggers to keep scheduled per recurring event series.
 *  2 = next occurrence + safety net in case the first invocation fails. */
const TRIGGERS_PER_SERIES = 2;

// ============================================================================
// TYPES
// ============================================================================

interface ScheduledEvent {
    time: number;
    checksum: string;
    triggerId: string;
    seriesKey: string;
    lastTriggered?: number;
}

// ============================================================================
// GITHUB API
// ============================================================================

function getDefaultBranch(targetRepo: string, token: string): string {
    const url = `${GITHUB_API_URL}/repos/${targetRepo}`;
    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: 'get',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
        },
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        if (response.getResponseCode() === 200) {
            const data = JSON.parse(response.getContentText());
            return data.default_branch || 'main';
        }
    } catch (e) {
        console.warn(`⚠️ Could not fetch default branch for ${targetRepo}, falling back to 'main'.`);
    }
    return 'main';
}

function fetchGlobalConfig(token: string): string | null {
    const configPath = "jules_config.yml";
    const controllerRepo = "GabryXn/jules-controller";
    const url = `${GITHUB_API_URL}/repos/${controllerRepo}/contents/${configPath}`;

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: 'get',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
        },
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        if (response.getResponseCode() === 200) {
            const data = JSON.parse(response.getContentText());
            const decoded = Utilities.base64Decode(data.content);
            return Utilities.newBlob(decoded).getDataAsString();
        }
    } catch (e) {
        console.error(`❌ Error fetching global config via API: ${e}`);
    }
    return null;
}

function triggerJulesOnGithub(targetRepo: string, prompt: string, configText: string | null, attempt: number = 1): boolean {
    const token = PropertiesService.getScriptProperties().getProperty('PAT_TOKEN');
    if (!token) {
        console.error('PAT_TOKEN is not defined in Script Properties.');
        return false;
    }

    if (configText) {
        const calendarDisabled = /^\s+calendar_automation\s*:\s*false\s*$/m.test(configText);
        if (calendarDisabled) {
            console.warn(`🛑 Calendar Automation is DISABLED. Skipping dispatch for ${targetRepo}.`);
            return false;
        }
    } else {
        console.warn(`⚠️ Global config not provided for ${targetRepo}, proceeding with default (enabled).`);
    }

    const defaultBranch = getDefaultBranch(targetRepo, token);
    console.log(`🔍 Default branch for ${targetRepo}: ${defaultBranch}`);

    const url = `${GITHUB_API_URL}/repos/${targetRepo}/actions/workflows/${WORKFLOW_NAME}/dispatches`;
    const payload = {
        ref: defaultBranch,
        inputs: { prompt: prompt },
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: 'post',
        contentType: 'application/json',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
    };

    try {
        console.log(`[Attempt ${attempt}] Dispatching to: ${targetRepo} (branch: ${defaultBranch})`);
        const response = UrlFetchApp.fetch(url, options);
        const code = response.getResponseCode();

        if (code >= 200 && code < 300) {
            console.log(`✅ Dispatched Jules on ${targetRepo}. Code: ${code}`);
            return true;
        } else {
            console.error(`🚨 Error dispatching to ${targetRepo}. Code: ${code}. Body: ${response.getContentText()}`);
            if (attempt < 3 && code >= 500) {
                Utilities.sleep(5000);
                return triggerJulesOnGithub(targetRepo, prompt, configText, attempt + 1);
            }
            return false;
        }
    } catch (e: any) {
        console.error(`Exception during Github API call: ${e.message}`);
        if (attempt < 3) {
            Utilities.sleep(5000);
            return triggerJulesOnGithub(targetRepo, prompt, configText, attempt + 1);
        }
        return false;
    }
}

function fetchAllTargets(token: string): string[] {
    const url = `${GITHUB_API_URL}/user/repos?visibility=all&affiliation=owner,collaborator&per_page=100`;

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
        method: 'get',
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
        },
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        if (response.getResponseCode() === 200) {
            const reposData = JSON.parse(response.getContentText());
            return reposData
                .filter((repo: any) => !repo.archived && repo.permissions?.push === true)
                .map((repo: any) => repo.full_name);
        } else {
            console.error(`🚨 Error fetching user repos. Code: ${response.getResponseCode()}`);
        }
    } catch (e) {
        console.error(`❌ Error fetching targets via GitHub API: ${e}`);
    }
    return [];
}

// ============================================================================
// PARSING & UTILITIES
// ============================================================================

function extractTargetRepos(title: string): string[] {
    const regex = /^\s*jules\s*:\s*(.+?)(?:\s+-\s+.*)?\s*$/i;
    const match = title.match(regex);
    if (!match) return [];

    return match[1].split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => t.toLowerCase() === 'all' ? 'all' : t);
}

function sanitizePrompt(raw: string): string {
    return raw
        .replace(/<[^>]*>?/gm, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function generateEventChecksum(event: GoogleAppsScript.Calendar.CalendarEvent): string {
    const data = `${event.getStartTime().getTime()}|${event.getTitle()}|${event.getDescription()}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

/**
 * Returns a stable key identifying the event series.
 * Recurring events share a series key; one-off events use their composite key.
 */
function getSeriesKey(event: GoogleAppsScript.Calendar.CalendarEvent): string {
    if (event.isRecurringEvent()) {
        try {
            return 'series_' + event.getEventSeries().getId();
        } catch {
            // Fallback if getEventSeries() throws (e.g. deleted series)
        }
    }
    return event.getId() + '_' + event.getStartTime().getTime();
}

// ============================================================================
// TRIGGER MANAGEMENT
// ============================================================================

function createTimeDrivenTriggerForEvent(eventId: string, startTime: Date): string {
    console.log(`⏰ Creating trigger for event ${eventId} at ${startTime}`);
    const trigger = ScriptApp.newTrigger('checkAndTriggerJules')
        .timeBased()
        .at(startTime)
        .create();
    return trigger.getUniqueId();
}

function deleteTriggerById(triggerId: string) {
    if (!triggerId) return;
    for (const t of ScriptApp.getProjectTriggers()) {
        if (t.getUniqueId() === triggerId) {
            ScriptApp.deleteTrigger(t);
            console.log(`🧹 Deleted trigger: ${triggerId}`);
            return;
        }
    }
}

// ============================================================================
// CORE: CALENDAR EVENT PROCESSING
// ============================================================================

function onCalendarEvent(e: any) {
    console.log('Calendar OnChange event fired.');
    processCalendarEvents();
}

/**
 * Scans the calendar, manages scheduled event state, and creates/removes
 * per-event triggers. For recurring events, only the next occurrence per
 * series is scheduled — keeping trigger count low.
 */
function processCalendarEvents() {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        console.log('processCalendarEvents starting...');

        const calendar = CalendarApp.getDefaultCalendar();
        const now = new Date();
        const nowMs = now.getTime();
        const scanEnd = new Date(nowMs + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

        const props = PropertiesService.getScriptProperties();
        const scheduledStr = props.getProperty('SCHEDULED_EVENTS') || '{}';
        const scheduledEvents: Record<string, ScheduledEvent> = JSON.parse(scheduledStr);
        let stateChanged = false;

        // ── Build map of active Jules events (includes recurring occurrences) ──
        const calEvents = calendar.getEvents(now, scanEnd);
        const activeJulesEvents = new Map<string, GoogleAppsScript.Calendar.CalendarEvent>();

        for (const event of calEvents) {
            if (extractTargetRepos(event.getTitle() || '').length > 0) {
                const key = event.getId() + '_' + event.getStartTime().getTime();
                activeJulesEvents.set(key, event);
            }
        }

        // ── Phase 1: Cleanup past/deleted events, detect modifications ─────────

        for (const key in scheduledEvents) {
            const data = scheduledEvents[key];
            const activeEvent = activeJulesEvents.get(key);

            // Past (beyond grace period) or deleted from calendar
            if (data.time + CLEANUP_GRACE_MS < nowMs || !activeEvent) {
                if (!activeEvent && data.time >= nowMs) {
                    console.log(`🗑️ Event ${key} deleted/renamed. Cleaning up.`);
                }
                deleteTriggerById(data.triggerId);
                delete scheduledEvents[key];
                stateChanged = true;
                continue;
            }

            // Modified (checksum changed) and not yet fired — reschedule
            if (!data.lastTriggered) {
                const currentChecksum = generateEventChecksum(activeEvent);
                if (data.checksum !== currentChecksum) {
                    console.log(`✏️ Event ${key} modified. Rescheduling.`);
                    deleteTriggerById(data.triggerId);

                    const newTime = activeEvent.getStartTime().getTime();
                    const newKey = activeEvent.getId() + '_' + newTime;
                    const newTriggerId = createTimeDrivenTriggerForEvent(activeEvent.getId(), activeEvent.getStartTime());

                    delete scheduledEvents[key];
                    scheduledEvents[newKey] = {
                        time: newTime,
                        checksum: currentChecksum,
                        triggerId: newTriggerId,
                        seriesKey: getSeriesKey(activeEvent)
                    };
                    stateChanged = true;
                }
            }
        }

        // ── Phase 2: Count pending triggers per series ──────────────────────────

        const pendingPerSeries = new Map<string, number>();
        let activeTriggerCount = 0;
        for (const key in scheduledEvents) {
            const data = scheduledEvents[key];
            if (!data.lastTriggered && data.time > nowMs) {
                pendingPerSeries.set(data.seriesKey, (pendingPerSeries.get(data.seriesKey) || 0) + 1);
                activeTriggerCount++;
            }
        }

        // ── Phase 3: Schedule next occurrences per series (up to TRIGGERS_PER_SERIES) ─

        // Collect unscheduled future occurrences grouped by series, sorted by time
        const unscheduledPerSeries = new Map<string, { key: string; event: GoogleAppsScript.Calendar.CalendarEvent; time: number }[]>();

        activeJulesEvents.forEach((event, compositeKey) => {
            const startMs = event.getStartTime().getTime();
            if (startMs <= nowMs) return;                  // past
            if (scheduledEvents[compositeKey]) return;     // already tracked

            const seriesKey = getSeriesKey(event);
            const pending = pendingPerSeries.get(seriesKey) || 0;
            const slotsForSeries = TRIGGERS_PER_SERIES - pending;
            if (slotsForSeries <= 0) return;               // series already fully scheduled

            const list = unscheduledPerSeries.get(seriesKey) || [];
            list.push({ key: compositeKey, event, time: startMs });
            unscheduledPerSeries.set(seriesKey, list);
        });

        // For each series, keep only the earliest N unscheduled occurrences (N = available slots)
        const candidates: { seriesKey: string; key: string; event: GoogleAppsScript.Calendar.CalendarEvent; time: number }[] = [];
        unscheduledPerSeries.forEach((list, seriesKey) => {
            const pending = pendingPerSeries.get(seriesKey) || 0;
            const slots = TRIGGERS_PER_SERIES - pending;
            list.sort((a, b) => a.time - b.time);
            for (let i = 0; i < Math.min(slots, list.length); i++) {
                candidates.push({ seriesKey, ...list[i] });
            }
        });

        // Sort all candidates by time (nearest first) and schedule within cap
        candidates.sort((a, b) => a.time - b.time);

        for (const { seriesKey, key, event, time } of candidates) {
            if (activeTriggerCount >= MAX_EVENT_TRIGGERS) {
                console.warn(`⚠️ Trigger cap reached (${MAX_EVENT_TRIGGERS}). Remaining events deferred to next rescan.`);
                break;
            }

            const triggerId = createTimeDrivenTriggerForEvent(event.getId(), event.getStartTime());
            scheduledEvents[key] = {
                time,
                checksum: generateEventChecksum(event),
                triggerId,
                seriesKey
            };
            pendingPerSeries.set(seriesKey, (pendingPerSeries.get(seriesKey) || 0) + 1);
            stateChanged = true;
            activeTriggerCount++;
            console.log(`📅 Scheduled: ${event.getTitle()} at ${new Date(time)} (series: ${seriesKey}, slot ${pendingPerSeries.get(seriesKey)}/${TRIGGERS_PER_SERIES})`);
        }

        if (stateChanged) {
            props.setProperty('SCHEDULED_EVENTS', JSON.stringify(scheduledEvents));
        }

        console.log(`processCalendarEvents done. Tracking ${Object.keys(scheduledEvents).length} events, ${activeTriggerCount} active triggers.`);
    } catch (e: any) {
        console.error(`Error in processCalendarEvents: ${e.message}`);
    } finally {
        lock.releaseLock();
    }
}

// ============================================================================
// CORE: DISPATCH (fired by per-event time-driven triggers)
// ============================================================================

/**
 * Fired by a time-driven trigger at the event's start time.
 * Dispatches the GitHub workflow, then triggers a rescan to schedule
 * the next occurrence if the event is recurring.
 */
function checkAndTriggerJules(e?: any) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        console.log('checkAndTriggerJules starting...');

        // Clean up the trigger that fired this invocation
        if (e && e.triggerUid) {
            deleteTriggerById(e.triggerUid);
        }

        const calendar = CalendarApp.getDefaultCalendar();
        const now = new Date();
        const nowMs = now.getTime();

        const props = PropertiesService.getScriptProperties();
        const token = props.getProperty('PAT_TOKEN') || '';
        const configText = fetchGlobalConfig(token);

        const scheduledStr = props.getProperty('SCHEDULED_EVENTS') || '{}';
        const scheduledEvents: Record<string, ScheduledEvent> = JSON.parse(scheduledStr);
        let stateChanged = false;

        // Find events in a window around now (GAS triggers can fire slightly late)
        const windowStart = new Date(nowMs - 5 * 60 * 1000);  // 5 min ago
        const windowEnd = new Date(nowMs + 5 * 60 * 1000);    // 5 min ahead
        const events = calendar.getEvents(windowStart, windowEnd);

        let cachedAllRepos: string[] | null = null;

        for (const event of events) {
            const title = event.getTitle() || '';
            const targetRepos = extractTargetRepos(title);
            if (targetRepos.length === 0) continue;

            const compositeKey = event.getId() + '_' + event.getStartTime().getTime();
            const data = scheduledEvents[compositeKey];

            // Only dispatch if tracked and not yet triggered
            if (!data || data.lastTriggered) continue;

            const prompt = sanitizePrompt(event.getDescription() || '');
            console.log(`🤖 Dispatching: "${title}" → ${targetRepos.join(', ')}`);

            let dispatched = false;
            for (const target of targetRepos) {
                if (target === 'all') {
                    if (!cachedAllRepos) cachedAllRepos = fetchAllTargets(token);
                    console.log(`🌍 Dispatching to ALL repos: ${cachedAllRepos.join(', ')}`);
                    for (const repo of cachedAllRepos) {
                        if (triggerJulesOnGithub(repo, prompt, configText)) dispatched = true;
                    }
                } else {
                    if (triggerJulesOnGithub(target, prompt, configText)) {
                        console.log(`✨ Dispatched for ${target}`);
                        dispatched = true;
                    } else {
                        console.error(`🚨 FAILED to dispatch for ${target}`);
                    }
                }
            }

            if (dispatched) {
                scheduledEvents[compositeKey].lastTriggered = nowMs;
                stateChanged = true;
                console.log(`✅ Dispatch complete: ${compositeKey}`);
            }
        }

        if (stateChanged) {
            props.setProperty('SCHEDULED_EVENTS', JSON.stringify(scheduledEvents));
        }
    } catch (e: any) {
        console.error(`Error in checkAndTriggerJules: ${e.message}`);
    } finally {
        lock.releaseLock();
    }

    // Outside the lock: rescan to schedule the next occurrence for recurring events
    processCalendarEvents();
}

// ============================================================================
// SETUP (run once from the Apps Script editor)
// ============================================================================

function setupCalendarTrigger() {
    const triggers = ScriptApp.getProjectTriggers();

    // ── STEP 1: Clean up ALL existing project triggers ──────────────────────
    // Safe full reset — we recreate only what's needed below.
    for (const t of triggers) {
        ScriptApp.deleteTrigger(t);
    }
    console.log('✅ Removed all existing triggers.');

    // ── STEP 2: Wipe stale state ────────────────────────────────────────────
    PropertiesService.getScriptProperties().deleteProperty('SCHEDULED_EVENTS');
    console.log('✅ Cleared SCHEDULED_EVENTS state.');

    // ── STEP 3: Calendar onChange trigger ────────────────────────────────────
    const calendar = CalendarApp.getDefaultCalendar();
    ScriptApp.newTrigger('onCalendarEvent')
        .forUserCalendar(calendar.getId())
        .onEventUpdated()
        .create();
    console.log('✅ Calendar onChange trigger created.');

    // ── STEP 4: 6-hour periodic safety-net ──────────────────────────────────
    // Catches recurring occurrences entering the lookahead window and
    // recovers from any missed onChange events.
    ScriptApp.newTrigger('processCalendarEvents')
        .timeBased()
        .everyHours(6)
        .create();
    console.log('✅ 6-hour periodic safety-net trigger created.');

    // ── STEP 5: Initial scan ────────────────────────────────────────────────
    processCalendarEvents();
    console.log('✅ Initial scan complete. Setup done.');
}

// ============================================================================
// GLOBAL SCOPE EXPOSURE FOR GAS TRIGGERS
// ============================================================================
(globalThis as any).setupCalendarTrigger = setupCalendarTrigger;
(globalThis as any).onCalendarEvent = onCalendarEvent;
(globalThis as any).checkAndTriggerJules = checkAndTriggerJules;
(globalThis as any).processCalendarEvents = processCalendarEvents;
(globalThis as any).triggerJulesOnGithub = triggerJulesOnGithub;
