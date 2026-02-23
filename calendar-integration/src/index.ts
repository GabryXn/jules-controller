/**
 * GITHUB REPOSITORY DISPATCH
 * URL: https://api.github.com/repos/{owner}/{repo}/actions/workflows/jules_agent.yml/dispatches
 */

const GITHUB_API_URL = 'https://api.github.com';
const JULES_EVENT_PREFIX = 'Jules: ';
const WORKFLOW_NAME = 'jules_agent.yml';

// ============================================================================
// GITHUB API
// ============================================================================


// ============================================================================
// GITHUB API WITH FALLBACK
// ============================================================================

export function triggerJulesOnGithub(targetRepo: string, prompt: string, attempt: number = 1): boolean {
    const token = PropertiesService.getScriptProperties().getProperty('PAT_TOKEN');
    if (!token) {
        console.error('PAT_TOKEN is not defined in Script Properties.');
        return false;
    }

    // --- CENTRALIZED CONTROL CHECK ---
    try {
        console.log(`🔍 Checking global config for calendar_automation...`);
        const configUrl = "https://raw.githubusercontent.com/GabryXn/jules-controller/main/jules_config.yml";
        const configResponse = UrlFetchApp.fetch(configUrl);
        const configText = configResponse.getContentText();

        if (configText.includes("calendar_automation: false")) {
            console.warn("🛑 Calendar Automation is DISABLED in global config. Skipping dispatch for this event.");
            return false;
        }
        console.log("✅ Global config check passed (enabled).");
    } catch (e: any) {
        console.warn(`⚠️ Could not fetch global config: ${e.message}. Proceeding with default (enabled).`);
    }
    // ---------------------------------

    const url = `${GITHUB_API_URL}/repos/${targetRepo}/actions/workflows/${WORKFLOW_NAME}/dispatches`;
    const payload = {
        ref: 'main',
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
        console.log(`[Attempt ${attempt}] Sending dispatch to: ${targetRepo}`);
        const response = UrlFetchApp.fetch(url, options);
        const code = response.getResponseCode();

        if (code >= 200 && code < 300) {
            console.log(`✅ Successfully dispatched Jules on ${targetRepo}. Code: ${code}`);
            return true;
        } else {
            console.error(`🚨 Error dispatching to ${targetRepo}. Code: ${code}. Body: ${response.getContentText()}`);
            if (attempt < 3 && code >= 500) {
                // Retry only on server errors (5xx)
                console.log('Retrying in 5 seconds...');
                Utilities.sleep(5000);
                return triggerJulesOnGithub(targetRepo, prompt, attempt + 1);
            }
            return false;
        }
    } catch (e: any) {
        console.error(`Exception during Github API call: ${e.message}`);
        if (attempt < 3) {
            console.log('Retrying in 5 seconds...');
            Utilities.sleep(5000);
            return triggerJulesOnGithub(targetRepo, prompt, attempt + 1);
        }
        return false;
    }
}

// ============================================================================
// REGEX AND PARSING
// ============================================================================

/**
 * Uses Regex to identify events titled "Jules: [repo]" flexibly.
 * Matches: "Jules: user/repo", "Jules : user/repo", " jules: user/repo" (case-insensitive)
 */
function extractTargetRepo(title: string): string | null {
    const regex = /^\s*jules\s*:\s*([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\s*$/i;
    const match = title.match(regex);
    return match ? match[1] : null;
}

// ============================================================================
// TIME-DRIVEN TRIGGER MANAGEMENT
// ============================================================================

export function createTimeDrivenTriggerForEvent(eventId: string, startTime: any) {
    console.log(`Creating time-driven trigger for event ${eventId} at ${startTime}`);
    ScriptApp.newTrigger('checkAndTriggerJules')
        .timeBased()
        .at(startTime)
        .create();
}

/**
 * The function fired by the time-driven trigger.
 */
export function checkAndTriggerJules(e?: any) {
    console.log('checkAndTriggerJules starting...');
    cleanupTriggers(e); // Delete the current trigger

    const calendar = CalendarApp.getDefaultCalendar();
    const now = new Date();

    // 2-minute window
    const startWindow = new Date(now.getTime() - 60000);
    const endWindow = new Date(now.getTime() + 120000);

    const events = calendar.getEvents(startWindow, endWindow);

    events.forEach(event => {
        const title = event.getTitle() || '';
        const targetRepo = extractTargetRepo(title);

        // If Regex successfully extracted a repo
        if (targetRepo) {
            const diff = Math.abs(event.getStartTime().getTime() - now.getTime());
            // Make sure the event actually started NOW (not a manually dragged long event intersecting now)
            if (diff <= 120000) {
                const prompt = event.getDescription() || '';
                console.log(`🤖 Triggering Jules for ${targetRepo}. Event: "${title}"`);
                const success = triggerJulesOnGithub(targetRepo, prompt);
                if (success) {
                    console.log(`✨ Successfully initiated dispatch for ${targetRepo}`);
                } else {
                    console.error(`🚨 FAILED to initiate dispatch for ${targetRepo}. Check logs above for details.`);
                }
            }
        }
    });
}

function cleanupTriggers(e?: any) {
    if (e && e.triggerUid) {
        const triggers = ScriptApp.getProjectTriggers();
        for (const trigger of triggers) {
            if (trigger.getUniqueId() === e.triggerUid) {
                ScriptApp.deleteTrigger(trigger);
                break;
            }
        }
    }
}

// ============================================================================
// ONCHANGE CALENDAR TRIGGER (DETECTS CREATIONS, EDITS AND DELETIONS)
// ============================================================================

export function onCalendarEvent(e: any) {
    console.log('Calendar OnChange Event triggered.');
    processCalendarEvents();
}

export function processCalendarEvents() {
    const calendar = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const futureLimit = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // look 14 days ahead

    const events = calendar.getEvents(now, futureLimit);
    const props = PropertiesService.getScriptProperties();

    // We store scheduled events as a stringified map: { eventId: { time: number, checksum: string } }
    const scheduledStr = props.getProperty('SCHEDULED_EVENTS') || '{}';
    const scheduledEvents = JSON.parse(scheduledStr);

    let stateChanged = false;

    // First: clean up events that no longer exist or are in the past
    // If an event was deleted from Calendar, it won't be in the 'events' array fetching.
    // If it was modified to not have "Jules:" anymore, it won't be processed as active.

    // Map of currently active Jules events in the window
    const activeJulesEvents = new Map<string, GoogleAppsScript.Calendar.CalendarEvent>();

    events.forEach(event => {
        const title = event.getTitle() || '';
        if (extractTargetRepo(title)) {
            activeJulesEvents.set(event.getId(), event);
        }
    });

    // Sync state and handle Edits / Deletions
    for (const eventId in scheduledEvents) {
        const scheduledData = scheduledEvents[eventId];

        // 1. If the event is in the past, just clean it from memory. (Trigger already fired and cleaned itself)
        if (scheduledData.time < now.getTime()) {
            delete scheduledEvents[eventId];
            stateChanged = true;
            continue;
        }

        // 2. If it's in the future and NOT in activeJulesEvents anymore (means Deleted, or Title changed removing Jules)
        const activeEvent = activeJulesEvents.get(eventId);
        if (!activeEvent) {
            console.log(`Event ${eventId} was deleted or renamed. Canceling schedule.`);
            cancelScheduledTriggerForEvent(eventId);
            delete scheduledEvents[eventId];
            stateChanged = true;
            continue;
        }

        // 3. If the event exists, but the Time or Details changed (Edit)
        // We calculate a simple checksum combining start time + title + description
        const currentChecksum = generateEventChecksum(activeEvent);
        if (scheduledData.checksum !== currentChecksum) {
            console.log(`Event ${eventId} was modified. Rescheduling...`);
            cancelScheduledTriggerForEvent(eventId);

            // Re-schedule based on new info
            const newStartTime = activeEvent.getStartTime();
            createTimeDrivenTriggerForEvent(eventId, newStartTime);
            scheduledEvents[eventId] = { time: newStartTime.getTime(), checksum: currentChecksum };
            stateChanged = true;
        }
    }

    // New Creations: Handle events in activeJulesEvents that aren't in our scheduled state at all
    activeJulesEvents.forEach((event, eventId) => {
        if (!scheduledEvents[eventId]) {
            const startTime = event.getStartTime();
            const checksum = generateEventChecksum(event);
            console.log(`New event detected: ${event.getTitle()}. Scheduling trigger.`);
            createTimeDrivenTriggerForEvent(eventId, startTime);
            scheduledEvents[eventId] = { time: startTime.getTime(), checksum: checksum };
            stateChanged = true;
        }
    });

    if (stateChanged) {
        props.setProperty('SCHEDULED_EVENTS', JSON.stringify(scheduledEvents));
    }
}

/**
 * Cancel a specific trigger that was previously scheduled for a known eventId.
 * Because trigger functions don't receive custom parameters, we find the trigger
 * by looking at all checkAndTriggerJules triggers and finding the one closest to
 * the previously scheduled time (or just clean them and rely on the next pass).
 * But since we can't easily map trigger to eventId without properties, a better way
 * is just wiping all outstanding checkAndTriggerJules triggers and letting the script rebuild them.
 * This is totally safe since processCalendarEvents scans the next X days anyway.
 */
function cancelScheduledTriggerForEvent(eventId: string) {
    // For simplicity, we just wipe all time-based triggers for 'checkAndTriggerJules'
    // and let the processCalendarEvents rebuild the active ones loop finish.
    // This perfectly cleans up orphaned triggers.
    const triggers = ScriptApp.getProjectTriggers();
    for (const t of triggers) {
        if (t.getHandlerFunction() === 'checkAndTriggerJules') {
            ScriptApp.deleteTrigger(t);
        }
    }
    console.log('Cleared all outstanding checkAndTriggerJules triggers to allow rebuild.');
    // The main processCalendarEvents will continue its loop and re-create triggers for
    // ALL the valid future events. To force a full rebuild of triggers, we must clear the state.
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('SCHEDULED_EVENTS'); // This ensures the loop treats everything as new next time.
}

function generateEventChecksum(event: GoogleAppsScript.Calendar.CalendarEvent): string {
    const data = `${event.getStartTime().getTime()}|${event.getTitle()}|${event.getDescription()}`;
    // Simple string hash function for checksum
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

/**
 * INITIAL SETUP SCRIPT
 */
export function setupCalendarTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    let hasTrigger = false;
    for (const trigger of triggers) {
        if (trigger.getHandlerFunction() === 'onCalendarEvent') {
            hasTrigger = true;
            break;
        }
    }
    if (!hasTrigger) {
        const calendar = CalendarApp.getDefaultCalendar();
        ScriptApp.newTrigger('onCalendarEvent')
            .forUserCalendar(calendar.getId())
            .onEventUpdated()
            .create();
        console.log('Calendar OnChange trigger successfully created!');
    } else {
        console.log('Trigger already exists.');
    }
}

