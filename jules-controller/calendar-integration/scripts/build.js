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
        const outfile = path.resolve(distDir, 'Code.js');

        await esbuild.build({
            entryPoints: [path.resolve(srcDir, 'index.ts')],
            bundle: true,
            outfile,
            format: 'iife',
            target: 'es2020',
        });

        // Append top-level function stubs so the GAS editor can discover them
        // in the function dropdown. The IIFE assigns these to globalThis, but
        // GAS only lists functions declared at the top-level scope.
        const stubs = [
            'setupCalendarTrigger',
            'onCalendarEvent',
            'checkAndTriggerJules',
            'processCalendarEvents',
            'triggerJulesOnGithub',
        ];
        const stubCode = '\n// --- GAS top-level function stubs (auto-generated) ---\n' +
            stubs.map(name => `function ${name}(e) { return globalThis.${name}(e); }`).join('\n') +
            '\n';
        fs.appendFileSync(outfile, stubCode);

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
