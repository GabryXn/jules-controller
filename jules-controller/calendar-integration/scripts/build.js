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
            // No globalName needed: src/index.ts assigns all GAS entry-points to
            // globalThis directly, which is the correct way to expose functions
            // from within an IIFE bundle to the Google Apps Script runtime.
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
