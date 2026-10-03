/** Prepare manual Vercel input files locally. Never deploys or prints secrets. Node 24. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBindingConfigs, parseAutomaticConfigs } from '../src/features/integrations/todays-math/sync-contract.ts';

const args = process.argv.slice(2);
const usage = 'node scripts/todays-math-sync-setup.mjs --automatic --source-origin=https://SOURCE --target-origin=https://TARGET [--new-cron] (or explicit mapping: --tenant=UUID --target-branch=ID [--binding=UUID])';
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
    const automatic = args.includes('--automatic');
    if (automatic && (option('tenant') || option('target-branch') || option('binding'))) throw new Error('Choose automatic or explicit mapping');
    const configs = automatic ? parseAutomaticConfigs(JSON.stringify([config])) : parseBindingConfigs(JSON.stringify([config]));
    const variable = automatic ? 'EYWA_SYNC_AUTO_JSON' : 'EYWA_SYNC_BINDINGS_JSON';
    // An unused private output folder: never replace an existing setup or existing application .env.
    const root = fileURLToPath(new URL('../', import.meta.url));
    const parent = resolve(root, 'work');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const folder = resolve(parent, `todays-math-sync-${randomUUID()}`);
    await mkdir(folder, { mode: 0o700 });
    const common = `${variable}=${JSON.stringify(configs)}\n`;
    const files = {
      '.env.eywa.local': `${common}TODAYS_MATH_SYNC_WAKE_SECRET=${secret()}\n`,
      '.env.todays-math.local': common,
      ...(args.includes('--new-cron') ? { '.env.eywa-cron-if-missing.local': `# Only if Production has NO existing CRON_SECRET. Never replace an existing value.\nCRON_SECRET=${secret()}\n` } : {}),
      'README.txt': [
        'These files contain secrets. Keep them private; do not paste into chat or commit them.',
        `${variable} must be identical in both projects. Paste the value after = without extra quotes.`,
        'TODAYS_MATH_SYNC_WAKE_SECRET is only for Eywa. Keep the existing CRON_SECRET unless none exists.',
        'If provided, .env.eywa-cron-if-missing.local is OPTIONAL: use it only when the Vercel project has no existing CRON_SECRET.',
        'Use Production only. Do not copy production bindings into Preview or Development.',
        'The Eywa admin script also needs the existing Supabase server environment; these files contain new settings only.',
        automatic ? 'Automatic onboarding: each enabled Eywa tenant creates its own target branch. No branch ID or per-tenant env changes needed.' : `Binding ID: ${config.bindingId}`,
        `Eywa production URL: ${configs[0].sourceBaseUrl}`,
        `Today Math production URL: ${configs[0].targetBaseUrl}`,
        '기존 계정/지점은 이름만 보고 합치지 않습니다. 기존 계정은 본인 확인 또는 승인 후 연결됩니다.',
        'OFF는 삭제가 아니라 이용 정지이며, 다시 ON이면 같은 지점과 기록을 이어 씁니다.',
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
