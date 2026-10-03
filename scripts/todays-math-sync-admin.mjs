/** Node 22.18+/24. Load the intended environment with node --env-file=... .
 * Defaults to read-only preview; credentials and individual records never print.
 */
import { createClient } from '@supabase/supabase-js';
import { parseBindingConfigs, parseAutomaticConfigs, resolveBindingConfigs, manifestSchema } from '../src/features/integrations/todays-math/sync-contract.ts';

const args = process.argv.slice(2);
const command = args.find((item) => !item.startsWith('--')) ?? 'status';
const option = (name) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes('--apply');
const allowed = new Set(['status', 'automatic', 'configure', 'snapshot', 'wake', 'reconcile', 'retry']);
try {
  if (!allowed.has(command)) throw new Error('Use status|automatic|configure|snapshot|wake|reconcile|retry');
  const configs = parseBindingConfigs(process.env.EYWA_SYNC_BINDINGS_JSON);
  const automatic = parseAutomaticConfigs(process.env.EYWA_SYNC_AUTO_JSON);
  const id = option('binding') ?? option('tenant');
  const config = id ? resolveBindingConfigs(configs, automatic, id)[0] : configs[0];
  if (['configure','snapshot'].includes(command) && (!config || (!id && new Set(configs.map((item) => item.bindingId)).size !== 1))) throw new Error('Select one configured --binding=UUID or automatic --tenant=UUID');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Supabase server environment missing');
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const rpc = async (name, input = {}) => {
    const { data, error } = await db.rpc(name, input);
    if (error) throw new Error(`RPC ${name} failed (${error.code ?? 'unavailable'})`);
    return data;
  };
  let output;
  if (command === 'status') output = await rpc('tm_sync_status', { p_binding_id: id ?? null });
  if (command === 'automatic') {
    if (!automatic.length && !args.includes('--disable')) throw new Error('Automatic environment missing');
    const input = { p_enabled: !args.includes('--disable'), p_excluded_tenants: [...new Set(configs.map((c) => c.tenantId))] };
    output = apply ? { bindings: await rpc('tm_sync_configure_automatic', input) } : { ...input, preview: true };
  }
  if (command === 'configure') {
    const mode = option('mode') ?? 'shadow';
    if (!['shadow', 'active'].includes(mode)) throw new Error('Mode must be shadow|active');
    output = await rpc('tm_sync_configure_binding', { p_binding_id: config.bindingId, p_tenant_id: config.tenantId,
      p_target_branch_id: config.targetBranchId, p_mode: mode, p_apply: apply });
  }
  if (command === 'snapshot') {
    if (!apply) throw new Error('Snapshot creates a frozen export; pass --apply to run');
    const value = manifestSchema.parse(await rpc('tm_sync_create_snapshot', { p_binding_id: config.bindingId }));
    output = { snapshotId: value.snapshotId, bindingId: value.bindingId, sourceEpoch: value.sourceEpoch,
      securityRevision: value.securityRevision, contentGeneration: value.contentGeneration,
      complete: value.complete, counts: Object.fromEntries(Object.entries(value.collections).map(([name, collection]) => [name, collection.total])) };
  }
  if (command === 'wake') {
    const sourceOrigin = config?.sourceBaseUrl ?? automatic[0]?.sourceBaseUrl;
    if (!sourceOrigin) throw new Error('Source origin missing');
    const secret = process.env.TODAYS_MATH_SYNC_WAKE_SECRET?.trim();
    if (!secret || secret.length < 32) throw new Error('Wake secret missing or too short');
    if (!apply) output = { sourceOrigin, configured: false, preview: true };
    else output = await rpc('tm_sync_configure_wake', { p_source_origin: sourceOrigin, p_wake_secret: secret, p_apply: true });
  }
  if (command === 'reconcile') {
    if (!apply) throw new Error('Reconciliation persists events; pass --apply to run');
    output = await rpc('tm_sync_reconcile');
  }
  if (command === 'retry') {
    const eventId = option('event');
    if (!eventId || !apply) throw new Error('Retry needs --event=UUID --apply');
    output = { accepted: await rpc('tm_sync_retry_event', { p_event_id: eventId }) };
  }
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  // Zod/config errors may contain input values; print only our known safe errors.
  const safe = error instanceof Error && /^(Use |Select |Supabase server |RPC |Mode |Snapshot |Wake secret |Reconciliation |Retry )/.test(error.message);
  console.error(safe ? error.message : 'Sync configuration or response validation failed');
  process.exitCode = 1;
}
