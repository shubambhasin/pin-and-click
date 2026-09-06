#!/usr/bin/env node
/**
 * Upload and publish the extension to the Chrome Web Store.
 *
 *   node scripts/publish-store.mjs            # upload + publish
 *   node scripts/publish-store.mjs --draft    # upload only, publish by hand
 *
 * Env (all required):
 *   CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
 *
 * Notes that bite people:
 *   - The manifest version MUST be higher than what is already in the store, or
 *     the upload fails with "Version number is invalid or too low".
 *   - Publishing queues the item for REVIEW. It is not live the moment this exits.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ID = process.env.CWS_EXTENSION_ID;
const CLIENT_ID = process.env.CWS_CLIENT_ID;
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.CWS_REFRESH_TOKEN;
const draftOnly = process.argv.includes('--draft');

const missing = Object.entries({ CWS_EXTENSION_ID: ID, CWS_CLIENT_ID: CLIENT_ID,
  CWS_CLIENT_SECRET: CLIENT_SECRET, CWS_REFRESH_TOKEN: REFRESH_TOKEN })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('✗ missing env: ' + missing.join(', '));
  console.error('  See "Publishing automatically" in README.md for how to get these once.');
  process.exit(1);
}

const ZIP = 'site/pin-and-click.zip';

/** Exchange the long-lived refresh token for a short-lived access token. */
async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('oauth: ' + (json.error_description || json.error || res.status));
  return json.access_token;
}

async function main() {
  execSync('./scripts/build-zip.sh', { stdio: 'inherit' });
  if (!existsSync(ZIP)) throw new Error('no zip at ' + ZIP);

  const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
  const token = await accessToken();
  const auth = { Authorization: 'Bearer ' + token, 'x-goog-api-version': '2' };

  console.log(`uploading version ${version}…`);
  const up = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${ID}`,
    { method: 'PUT', headers: auth, body: readFileSync(ZIP) });
  const upJson = await up.json();
  if (upJson.uploadState !== 'SUCCESS') {
    console.error('✗ upload ' + upJson.uploadState);
    for (const e of upJson.itemError || []) console.error('  ' + (e.error_detail || e.error_code));
    process.exit(1);
  }
  console.log('✓ uploaded');

  if (draftOnly) {
    console.log('draft only — publish from the dashboard when ready');
    return;
  }

  const pub = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${ID}/publish`,
    { method: 'POST', headers: { ...auth, 'Content-Length': '0' } });
  const pubJson = await pub.json();
  if (!pub.ok) {
    console.error('✗ publish failed: ' + JSON.stringify(pubJson).slice(0, 300));
    process.exit(1);
  }
  console.log('✓ publish requested — status: ' + (pubJson.status || []).join(', '));
  for (const d of pubJson.statusDetail || []) console.log('  ' + d);
  console.log('\nGoogle now reviews it. That can take hours to days; the current');
  console.log('version stays live in the meantime.');
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
