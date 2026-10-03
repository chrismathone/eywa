/** Prepare manual Vercel input files locally. Never deploys or prints secrets. Node 24. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBindingConfigs } from '../src/features/integrations/todays-math/sync-contract.ts';

const args = process.argv.slice(2);
const usage = 'node scripts/todays-math-sync-setup.mjs --tenant=UUID --target-branch=ID --source-origin=https://SOURCE --target-origin=https://TARGET [--binding=UUID] [--new-cron]';
if (args.includes('--help')) {
  console.log(usage);
} else {
  try {
    const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const secret = () => randomBytes(32).toString('base64url');
    const config = {
      bindingId: option('binding') ?? randomUUID(), tenantId: option('tenant'), targetBranchId: option('target-branch'),
      sourceBaseUrl: option('source-origin'), targetBaseUrl: option('target-origin'),
      keyId: `initial-${new Date().toISOString().slice(0, 10)}`, controlSecret: secret(), webhookSecret: secret(), ssoSecret: secret(),
    };
    const configs = parseBindingConfigs(JSON.stringify([config]));
    // An unused private output folder: never replace an existing setup or existing application .env.
    const root = fileURLToPath(new URL('../', import.meta.url));
    const parent = resolve(root, 'work');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const folder = resolve(parent, `todays-math-sync-${randomUUID()}`);
    await mkdir(folder, { mode: 0o700 });
    const common = `EYWA_SYNC_BINDINGS_JSON=${JSON.stringify(configs)}\n`;
    const files = {
      '.env.eywa.local': `${common}TODAYS_MATH_SYNC_WAKE_SECRET=${secret()}\n${args.includes('--new-cron') ? `CRON_SECRET=${secret()}\n` : ''}`,
      '.env.todays-math.local': common,
      'README.txt': [
        'These files contain secrets. Keep them private; do not paste into chat or commit them.',
        'EYWA_SYNC_BINDINGS_JSON must be identical in both projects. Paste the value after = without extra quotes.',
        'TODAYS_MATH_SYNC_WAKE_SECRET is only for Eywa. Keep the existing CRON_SECRET unless none exists.',
        'Use Production only. Do not copy production bindings into Preview or Development.',
        'The Eywa admin script also needs the existing Supabase server environment; these files contain new settings only.',
        `Binding ID: ${config.bindingId}`,
        'Follow docs/todays-math-sync-operations.md before activating the connection.',
        'This generator has changed no database, deployment, or Vercel setting.',
      ].join('\n') + '\n',
    };
    for (const [name, contents] of Object.entries(files)) await writeFile(resolve(folder, name), contents, { flag: 'wx', mode: 0o600 });
    console.log(`Prepared private setup files: ${folder}`);
    console.log('No secret values printed. No remote changes made.');
  } catch {
    console.error(`Setup failed. Check required IDs/origins and local folder permissions.\n${usage}`);
    process.exitCode = 1;
  }
}
