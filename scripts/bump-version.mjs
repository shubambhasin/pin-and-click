#!/usr/bin/env node
/**
 * Bump the manifest version. The store rejects an upload whose version is not
 * higher than the one already published, so this is the trigger for a release.
 *
 *   npm run bump           # 1.0.0 -> 1.0.1
 *   npm run bump -- minor  # 1.0.0 -> 1.1.0
 *   npm run bump -- major  # 1.0.0 -> 2.0.0
 */
import { readFileSync, writeFileSync } from 'node:fs';

const kind = process.argv[2] || 'patch';
const path = 'manifest.json';
const raw = readFileSync(path, 'utf8');
const manifest = JSON.parse(raw);

const parts = String(manifest.version).split('.').map(Number);
while (parts.length < 3) parts.push(0);
if (parts.some((n) => !Number.isFinite(n))) throw new Error('unparseable version: ' + manifest.version);

if (kind === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
else if (kind === 'minor') { parts[1]++; parts[2] = 0; }
else parts[2]++;

const next = parts.join('.');
// keep the file's formatting: swap just the version string
writeFileSync(path, raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
console.log(`${manifest.version} -> ${next}`);
console.log('commit and push; CI publishes when the manifest version changes.');
