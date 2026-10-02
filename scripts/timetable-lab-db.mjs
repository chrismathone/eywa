// node --env-file=.env.local scripts/timetable-lab-db.mjs [--apply | --test]
// Only this feature's additive migration; test fixtures always roll back. Never print credentials.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const migration = 'supabase/migrations/0333a_timetable_lab_drafts.sql';
const mode = process.argv[2] ?? '--check';
if (!['--check', '--apply', '--test'].includes(mode)) throw new Error('Use --check, --apply or --test.');
let connection, ref;
try { connection = new URL(process.env.DATABASE_URL ?? 'missing:'); ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'missing:').hostname.split('.')[0]; }
catch { throw new Error('Database environment configuration is invalid.'); }
if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) throw new Error('Database and app project do not match.');
const sql = postgres(connection.toString(), { ssl: 'require', prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  const [state] = await sql`select current_database() as database_name, to_regclass('public.timetable_lab_drafts')::text as draft_table,
    to_regprocedure('public.auth_tenant_id()')::text as tenant_function, to_regprocedure('public.is_super_admin(uuid)')::text as super_function,
    exists(select 1 from pg_available_extensions where name='pgtap') as pgtap_available`;
  console.log(JSON.stringify({ project: ref, ...state }));
  if (!state.tenant_function || !state.super_function) throw new Error('Required auth functions are missing.');
  if (mode === '--apply') {
    if (state.draft_table) throw new Error('Draft table already exists; inspect it instead of overwriting a migration.');
    await sql.unsafe(readFileSync(migration, 'utf8'));
    console.log('Applied timetable_lab_drafts migration.');
    await sql`notify pgrst, 'reload schema'`;
  }
  if (mode === '--test') {
    const results = await sql.unsafe(readFileSync('supabase/tests/timetable_lab_drafts.sql', 'utf8'));
    const lines = results.flatMap(result => Array.isArray(result) ? result.flatMap(row => Object.values(row)) : Object.values(result));
    const text = lines.filter(value => typeof value === 'string').join('\n');
    console.log(text.split('\n').filter(line => /^(?:ok |not ok |1\.\.|#)/.test(line)).join('\n'));
    if ((text.match(/^ok \d+ /gm) ?? []).length !== 33 || /not ok|Looks like you failed|planned .+ but ran/i.test(text)) process.exitCode = 1;
    const [fixtures] = await sql`select count(*)::int as remaining from public.tenants where id in ('10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000072')`;
    if (fixtures.remaining !== 0) throw new Error('Test fixtures were not fully rolled back.');
  }
  if (mode === '--apply' || state.draft_table) {
    const [checked] = await sql`select c.relrowsecurity as rls_enabled,
      (select count(*)::int from pg_policies where schemaname='public' and tablename='timetable_lab_drafts') as policies,
      has_table_privilege('anon','public.timetable_lab_drafts','select') as anonymous_read,
      has_table_privilege('authenticated','public.timetable_lab_drafts','update') as authenticated_update,
      has_table_privilege('authenticated','public.timetable_lab_drafts','delete') as authenticated_delete,
      (select prosecdef from pg_proc where oid='public.auth_can_use_timetable_lab()'::regprocedure) as permission_bypasses_rls
      from pg_class c where c.oid='public.timetable_lab_drafts'::regclass`;
    console.log(JSON.stringify(checked));
    if (!checked?.rls_enabled || checked.policies !== 2 || checked.anonymous_read || checked.authenticated_update || checked.authenticated_delete || checked.permission_bypasses_rls) throw new Error('Draft permission verification failed.');
  }
} catch (error) {
  await sql`rollback`.catch(() => {});
  // Database messages for these fixed SQL scripts contain no connection string or credential.
  console.error(JSON.stringify({ code: error.code ?? 'ERROR', message: error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database-url]') }));
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
