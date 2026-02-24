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

/**
 * Recupera il default branch di un repository (es. 'main' o 'master')
 */
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

/**
 * Recupera la configurazione globale in modo autenticato (supporta repo privati)
 */
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
            // Il contenuto è in base64
            const decoded = Utilities.base64Decode(data.content);
            return Utilities.newBlob(decoded).getDataAsString();
        }
    } catch (e) {
        console.error(`❌ Error fetching global config via API: ${e}`);
    }
    return null;
}

export function triggerJulesOnGithub(targetRepo: string, prompt: string, configText: string | null, attempt: number = 1): boolean {
    const token = PropertiesService.getScriptProperties().getProperty('PAT_TOKEN');
    if (!token) {
        console.error('PAT_TOKEN is not defined in Script Properties.');
        return false;
    }

    // --- CENTRALIZED CONTROL CHECK (using cached config) ---
    if (configText) {
        if (configText.includes("calendar_automation: false")) {
            console.warn(`🛑 Calendar Automation is DISABLED in global config. Skipping dispatch for ${targetRepo}.`);
            return false;
        }
    } else {
        console.warn(`⚠️ Global config not provided for ${targetRepo}, proceeding with default (enabled).`);
    }
    // ---------------------------------

    // Determina il branch di default (es. fix per 'master')
    const defaultBranch = getDefaultBranch(targetRepo, token);
    console.log(`🔍 Detected default branch for ${targetRepo}: ${defaultBranch}`);

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
        console.log(`[Attempt ${attempt}] Sending dispatch to: ${targetRepo} (branch: ${defaultBranch})`);
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
                return triggerJulesOnGithub(targetRepo, prompt, configText, attempt + 1);
            }
            return false;
        }
    } catch (e: any) {
        console.error(`Exception during Github API call: ${e.message}`);
        if (attempt < 3) {
            console.log('Retrying in 5 seconds...');
            Utilities.sleep(5000);
            return triggerJulesOnGithub(targetRepo, prompt, configText, attempt + 1);
        }
        return false;
    }
}

// ============================================================================
// REGEX AND PARSING
// ============================================================================

/**
 * Estrae l'elenco dei repository target (o "all") dal titolo dell'evento.
 * Supporta virgole per targets multipli: "Jules: repo1, repo2 - Descrizione"
 */
function extractTargetRepos(title: string): string[] {
    // Regex che cattura tutto ciò che sta tra "Jules:" e il primo "-" (o la fine del titolo)
    const regex = /^\s*jules\s*:\s*([^-\s]+(?:[^-]*[^-\s]+)?)(?:\s+-\s+.*)?\s*$/i;
    const match = title.match(regex);
    if (!match) return [];

    const rawTargets = match[1];
    // Split per virgola, trim degli spazi e lowercase per "all"
    return rawTargets.split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => t.toLowerCase() === 'all' ? 'all' : t);
}

/**
 * Recupera l'elenco di tutti i repository dell'account (owner), filtrando quelli archiviati.
 */
function fetchAllTargets(token: string): string[] {
    // visibility=all recupera sia pubblici che privati
    // affiliation=owner recupera solo i repo dell'utente (non quelli in cui è solo collaboratore)
    const url = `${GITHUB_API_URL}/user/repos?visibility=all&affiliation=owner&per_page=100`;

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
                .filter((repo: any) => !repo.archived) // Esclude archiviati
                .map((repo: any) => repo.full_name);  // owner/repo
        } else {
            console.error(`🚨 Error fetching user repos. Code: ${response.getResponseCode()}. Body: ${response.getContentText()}`);
        }
    } catch (e) {
        console.error(`❌ Error fetching targets via GitHub API: ${e}`);
    }
    return [];
}

// ============================================================================
// TIME-DRIVEN TRIGGER MANAGEMENT
// ============================================================================

export function createTimeDrivenTriggerForEvent(eventId: string, startTime: any): string {
    console.log(`Creating time-driven trigger for event ${eventId} at ${startTime}`);
    const trigger = ScriptApp.newTrigger('checkAndTriggerJules')
        .timeBased()
        .at(startTime)
        .create();
    return trigger.getUniqueId();
}

/**
 * The function fired by the time-driven trigger.
 */
export function checkAndTriggerJules(e?: any) {
    const lock = LockService.getScriptLock();
    try {
        // Wait up to 30 seconds for the lock
        lock.waitLock(30000);
        console.log('checkAndTriggerJules starting...');
        cleanupTriggers(e); // Delete the current trigger

        const calendar = CalendarApp.getDefaultCalendar();
        const now = new Date();
        const nowMs = now.getTime();

        const props = PropertiesService.getScriptProperties();
        const scheduledStr = props.getProperty('SCHEDULED_EVENTS') || '{}';
        const scheduledEvents = JSON.parse(scheduledStr);
        let stateChanged = false;

        // --- CACHE GLOBAL CONFIG ---
        const token = props.getProperty('PAT_TOKEN') || '';
        const configText = fetchGlobalConfig(token);
        // ---------------------------

        // 2-minute window
        const startWindow = new Date(nowMs - 60000);
        const endWindow = new Date(nowMs + 120000);

        const events = calendar.getEvents(startWindow, endWindow);

        // Cache for 'all' targets
        let cachedAllRepos: string[] | null = null;

        events.forEach(event => {
            const eventId = event.getId();
            const title = event.getTitle() || '';
            const targetRepos = extractTargetRepos(title);

            if (targetRepos.length > 0) {
                const eventStartTime = event.getStartTime().getTime();
                const diff = Math.abs(eventStartTime - nowMs);

                // Check if already triggered recently (5-minute deduplication)
                const eventData = scheduledEvents[eventId];
                const lastTriggered = eventData ? (eventData.lastTriggered || 0) : 0;
                const minInterval = 5 * 60 * 1000; // 5 minutes

                if (nowMs - lastTriggered < minInterval) {
                    console.log(`⏩ Skipping event "${title}" (ID: ${eventId}) - Already triggered recently at ${new Date(lastTriggered)}`);
                    return;
                }

                if (diff <= 120000) {
                    let prompt = event.getDescription() || '';

                    // --- SANITIZE PROMPT ---
                    prompt = prompt.replace(/<[^>]*>?/gm, '');
                    prompt = prompt.replace(/&nbsp;/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'");
                    // -----------------------

                    console.log(`🤖 Triggering Jules for targets: ${targetRepos.join(', ')}. Event: "${title}"`);

                    let eventTriggered = false;
                    targetRepos.forEach(target => {
                        if (target === 'all') {
                            if (!cachedAllRepos) {
                                cachedAllRepos = fetchAllTargets(token);
                            }
                            console.log(`🌍 Triggering Jules for ALL managed repositories: ${cachedAllRepos.join(', ')}`);
                            cachedAllRepos.forEach(repo => {
                                if (triggerJulesOnGithub(repo, prompt, configText)) eventTriggered = true;
                            });
                        } else {
                            const success = triggerJulesOnGithub(target, prompt, configText);
                            if (success) {
                                console.log(`✨ Successfully initiated dispatch for ${target}`);
                                eventTriggered = true;
                            } else {
                                console.error(`🚨 FAILED to initiate dispatch for ${target}.`);
                            }
                        }
                    });

                    if (eventTriggered) {
                        if (!scheduledEvents[eventId]) {
                            scheduledEvents[eventId] = { time: eventStartTime, checksum: generateEventChecksum(event) };
                        }
                        scheduledEvents[eventId].lastTriggered = nowMs;
                        stateChanged = true;
                    }
                }
            }
        });

        if (stateChanged) {
            props.setProperty('SCHEDULED_EVENTS', JSON.stringify(scheduledEvents));
        }
    } catch (e: any) {
        console.error(`Error in checkAndTriggerJules: ${e.message}`);
    } finally {
        lock.releaseLock();
    }
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
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        console.log('Synchronizing calendar events...');

        const calendar = CalendarApp.getDefaultCalendar();
        const now = new Date();
        const futureLimit = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // look 14 days ahead

        const events = calendar.getEvents(now, futureLimit);
        const props = PropertiesService.getScriptProperties();

        // State format: { eventId: { time: number, checksum: string, triggerId: string } }
        const scheduledStr = props.getProperty('SCHEDULED_EVENTS') || '{}';
        const scheduledEvents = JSON.parse(scheduledStr);

        let stateChanged = false;
        const activeJulesEvents = new Map<string, GoogleAppsScript.Calendar.CalendarEvent>();

        events.forEach(event => {
            const title = event.getTitle() || '';
            if (extractTargetRepos(title).length > 0) {
                activeJulesEvents.set(event.getId(), event);
            }
        });

        // 1. Clean up & Handle Edits/Deletions
        for (const eventId in scheduledEvents) {
            const scheduledData = scheduledEvents[eventId];
            const activeEvent = activeJulesEvents.get(eventId);

            // Se l'evento è passato o non esiste più (cancellato)
            if (scheduledData.time < now.getTime() || !activeEvent) {
                if (!activeEvent) console.log(`Event ${eventId} deleted or renamed. Cleaning up.`);
                cancelSurgicalTrigger(scheduledData.triggerId);
                delete scheduledEvents[eventId];
                stateChanged = true;
                continue;
            }

            // Se l'evento è stato modificato
            const currentChecksum = generateEventChecksum(activeEvent);
            if (scheduledData.checksum !== currentChecksum) {
                console.log(`Event ${eventId} modified. Rescheduling...`);
                cancelSurgicalTrigger(scheduledData.triggerId);

                const newStartTime = activeEvent.getStartTime();
                const newTriggerId = createTimeDrivenTriggerForEvent(eventId, newStartTime);
                scheduledEvents[eventId] = {
                    time: newStartTime.getTime(),
                    checksum: currentChecksum,
                    triggerId: newTriggerId,
                    lastTriggered: scheduledData.lastTriggered // Preserve lastTriggered
                };
                stateChanged = true;
            }
        }

        // 2. New Creations
        activeJulesEvents.forEach((event, eventId) => {
            if (!scheduledEvents[eventId]) {
                const startTime = event.getStartTime();
                // Skip events starting in the past (extra safety)
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

        if (stateChanged) {
            props.setProperty('SCHEDULED_EVENTS', JSON.stringify(scheduledEvents));
        }
    } catch (e: any) {
        console.error(`Error in processCalendarEvents: ${e.message}`);
    } finally {
        lock.releaseLock();
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
/**
 * Cancella chirugicamente UN solo trigger basandosi sul suo ID univoco.
 */
function cancelSurgicalTrigger(triggerId: string) {
    if (!triggerId) return;
    const triggers = ScriptApp.getProjectTriggers();
    for (const t of triggers) {
        if (t.getUniqueId() === triggerId) {
            ScriptApp.deleteTrigger(t);
            console.log(`Surgical cleanup of trigger: ${triggerId}`);
            return;
        }
    }
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

