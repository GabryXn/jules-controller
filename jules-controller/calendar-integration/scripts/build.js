import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');
const distDir = path.resolve(rootDir, 'dist');

async function build() {
    console.log('Building Google Apps Script project...');

    // Ensure dist directory exists
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    try {
        await esbuild.build({
            entryPoints: [path.resolve(srcDir, 'index.ts')],
            bundle: true,
            outfile: path.resolve(distDir, 'Code.js'),
            format: 'iife',
            target: 'es2020',
            globalName: 'GASApp',
            // Google Apps Script doesn't support let/const in global scope well across files, 
            // but since we bundle into one IIFE, we just expose top-level functions.
            // A small banner to expose functions to the global scope for trigger compatibility
            banner: {
                js: 'var processCalendarEvents, onCalendarEvent, createTimeDrivenTriggerForEvent, checkAndTriggerJules, triggerJulesOnGithub, setupCalendarTrigger;'
            },
            footer: {
                js: `
// Expose functions directly to global scope for Google Apps Script triggers
processCalendarEvents = GASApp.processCalendarEvents;
onCalendarEvent = GASApp.onCalendarEvent;
createTimeDrivenTriggerForEvent = GASApp.createTimeDrivenTriggerForEvent;
checkAndTriggerJules = GASApp.checkAndTriggerJules;
triggerJulesOnGithub = GASApp.triggerJulesOnGithub;
setupCalendarTrigger = GASApp.setupCalendarTrigger;

// Boilerplate wrapper functions to ensure GAS sees them in the dropdown
function __setupCalendarTrigger() { setupCalendarTrigger(); }
function __onCalendarEvent(e) { onCalendarEvent(e); }
function __checkAndTriggerJules(e) { checkAndTriggerJules(e); }
function __processCalendarEvents() { processCalendarEvents(); }
`
            }
        });

        // Copy appsscript.json to dist
        fs.copyFileSync(
            path.resolve(rootDir, 'appsscript.json'),
            path.resolve(distDir, 'appsscript.json')
        );

        console.log('Build completed successfully!');

    } catch (e) {
        console.error('Build failed', e);
        process.exit(1);
    }
}

build();
