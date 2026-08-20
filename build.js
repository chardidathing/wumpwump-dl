import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const targets = [];
if (args.includes('--all') || args.includes('--chrome')) targets.push('chrome');
if (args.includes('--all') || args.includes('--firefox')) targets.push('firefox');
if (targets.length === 0) targets.push('chrome'); // default

const entryPoints = [
  'src/content/scraper.js',
  'src/background/worker.js',
  'src/popup/popup.js',
  'src/popup/exporter-page.js',
  'src/export/exporter.js',
];

async function build(target) {
  const outdir = resolve(__dirname, `build/${target}`);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  await esbuild.build({
    entryPoints,
    outdir,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    sourcemap: args.includes('--watch') ? 'inline' : false,
    minify: !args.includes('--watch'),
    outbase: 'src',
  });

  // Copy manifest
  const manifestSrc = resolve(__dirname, `src/manifest.${target}.json`);
  writeFileSync(
    resolve(outdir, 'manifest.json'),
    readFileSync(manifestSrc)
  );

  // Copy static assets
  for (const file of ['popup/popup.html', 'popup/exporter.html', 'popup/popup.css', 'popup/json_dl.svg', 'popup/html_dl.svg', 'popup/delete.svg', 'popup/github.svg', 'popup/kofi.svg']) {
    const src = resolve(__dirname, 'src', file);
    const dest = resolve(outdir, file);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      cpSync(src, dest);
    } catch { /* file may not exist yet */ }
  }

  // Copy icons directory
  try {
    cpSync(resolve(__dirname, 'src/icons'), resolve(outdir, 'icons'), { recursive: true });
  } catch { /* icons may not exist yet */ }

  // Copy popup fonts
  try {
    cpSync(resolve(__dirname, 'src/popup/fonts'), resolve(outdir, 'popup/fonts'), { recursive: true });
  } catch { /* fonts may not exist yet */ }

  console.log(`Built for ${target} → build/${target}/`);
}

for (const target of targets) {
  await build(target);
}

if (args.includes('--watch')) {
  const ctx = await esbuild.context({
    entryPoints,
    outdir: resolve(__dirname, `build/${targets[0]}`),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    sourcemap: 'inline',
    outbase: 'src',
  });
  await ctx.watch();
  console.log('Watching for changes...');
}
