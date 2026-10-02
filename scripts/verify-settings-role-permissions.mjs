// Candidate migration + real authenticated-role checks. Every change is rolled back.
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = postgres(process.env.DATABASE_URL, { ssl:'require', max:1, prepare:false });
const migration = await readFile('supabase/migrations/20261002075120_report_settings_menu_permissions.sql','utf8');
const tenant = process.argv[2];
if (!tenant || !/^[0-9a-f-]{36}$/i.test(tenant)) throw new Error('Usage: node --env-file=.env.local scripts/verify-settings-role-permissions.mjs TENANT_UUID');
const results = [];
try {
  const [before] = await db`select md5(data::text) hash from tenant_settings where tenant_id=${tenant}`;
  try {
    await db.begin(async tx => {
      await tx.unsafe(migration);
      const [actor] = await tx`select id from users where tenant_id=${tenant} and system_role='admin' and status='active' and not is_super_admin(id) limit 1`;
      assert.ok(actor, 'test actor is required');
      async function configure(overrides, userOverrides=[]) {
        await tx`update tenant_settings set data=jsonb_set(data,'{permissions}',${tx.json({overrides,userOverrides})}) where tenant_id=${tenant}`;
      }
      async function actorQuery(fn) {
        return tx.savepoint(async s => {
          await s`select set_config('request.jwt.claims',${JSON.stringify({sub:actor.id,role:'authenticated'})},true)`;
          await s.unsafe('set local role authenticated');
          const result = await fn(s);
          await s.unsafe('reset role');
          await s`select set_config('request.jwt.claims','',true)`;
          return result;
        });
      }
      async function check(name, allowed, fn) {
        let failure;
        try { await actorQuery(fn); } catch(e) { failure = e; }
        if (allowed && failure) throw failure;
        if (!allowed) assert.ok(failure && ['P0001','42501'].includes(failure.code), `${name}: expected authorization error, got ${failure?.code ?? 'success'}`);
        results.push(name);
      }
      const reportWrite = s => s`update tenant_settings set data=jsonb_set(data,'{report}',coalesce(data->'report','{}') || '{"__role_test":true}'::jsonb) where tenant_id=${tenant}`;
      await configure([]);
      await check('default admin cannot change report settings',false,reportWrite);
      await configure([{menu:'report_settings',role:'admin',access:'readonly'}]);
      await check('readonly cannot change report settings',false,reportWrite);
      await configure([{menu:'report_settings',role:'admin',access:'full'}]);
      await check('delegated report settings saves',true,reportWrite);
      await check('report grant does not grant profile settings',false,s => s`update tenant_settings set data=jsonb_set(data,'{profile}',coalesce(data->'profile','{}') || '{"__role_test":true}'::jsonb) where tenant_id=${tenant}`);
      await check('delegated user cannot grant permissions',false,s => s`update tenant_settings set data=jsonb_set(data,'{permissions,overrides}','[]') where tenant_id=${tenant}`);
      await check('delegated user cannot edit modules',false,s => s`update tenant_settings set data=jsonb_set(data,'{modules}','{"disabled":["payroll"]}') where tenant_id=${tenant}`);
      await configure([{menu:'report_settings',role:'admin',access:'full'}],[{menu:'report_settings',userId:actor.id,access:'none'}]);
      await check('personal denial overrides role grant',false,s => s`update tenant_settings set data=jsonb_set(data,'{report,__role_test}','false') where tenant_id=${tenant}`);
      await configure([],[{menu:'report_settings',userId:actor.id,access:'full'}]);
      await check('personal report grant saves',true,s => s`update tenant_settings set data=jsonb_set(data,'{report,__role_test}','false') where tenant_id=${tenant}`);
      const insertPrompt = s => s`insert into ai_prompt_overrides(tenant_id,prompt_type,prompt_text,is_active,created_by) values(${tenant},'comment','ROLLBACK ROLE TEST',false,${actor.id})`;
      await configure([{menu:'report_settings',role:'admin',access:'full'}]);
      await check('report grant cannot insert AI prompt',false,insertPrompt);
      await configure([{menu:'ai_ment',role:'admin',access:'readonly'}]);
      await check('readonly cannot insert AI prompt',false,insertPrompt);
      await configure([{menu:'ai_ment',role:'admin',access:'full'}]);
      await check('AI grant can insert prompt',true,insertPrompt);
      await check('AI grant cannot insert into another tenant',false,s => s`insert into ai_prompt_overrides(tenant_id,prompt_type,prompt_text,is_active,created_by) values('00000000-0000-0000-0000-000000000001','comment','ROLLBACK ROLE TEST',false,${actor.id})`);
      await check('AI prompt version switches atomically',true,s=>s`select save_ai_prompt_setting('comment','ROLE TEST {{facts}}')`);
      await check('AI prompt version switches again without duplicate active rows',true,s=>s`select save_ai_prompt_setting('comment','ROLE TEST 2 {{facts}}')`);
      const [active]=await tx`select count(*)::int n from ai_prompt_overrides where tenant_id=${tenant} and prompt_type='comment' and is_active`;
      assert.equal(active.n,1);
      await configure([{menu:'ai_ment',role:'admin',access:'readonly'}]);
      await check('readonly cannot invoke atomic prompt reset',false,s=>s`select save_ai_prompt_setting('comment',null)`);
      const [unchanged]=await tx`select prompt_text from ai_prompt_overrides where tenant_id=${tenant} and prompt_type='comment' and is_active`;
      assert.equal(unchanged.prompt_text,'ROLE TEST 2 {{facts}}');
      await configure([{menu:'ai_ment',role:'admin',access:'full'}]);
      await check('authorized prompt reset succeeds',true,s=>s`select save_ai_prompt_setting('comment',null)`);
      const [superResult] = await tx`select settings_menu_access('{"overrides":[{"menu":"ai_ment","role":"admin","access":"none"}]}','ai_ment','admin',${actor.id},true) as access`;
      assert.equal(superResult.access,'full'); results.push('super admin ignores setting-role restrictions');
      await configure([]);
      const roomWrite=s=>s`insert into classrooms(tenant_id,name,capacity) values(${tenant},'ROLLBACK ROLE TEST',1)`;
      const popupWrite=s=>s`insert into notice_popups(tenant_id,title,body,is_active) values(${tenant},'ROLLBACK ROLE TEST','ROLE TEST',false)`;
      const integrationWrite=s=>s`insert into user_integrations(tenant_id,provider,sync_enabled) values(${tenant},'role_test',false)`;
      await check('classrooms direct API denies ungranted role',false,roomWrite);
      await check('popups direct API denies ungranted role',false,popupWrite);
      await check('integrations direct API denies ungranted role',false,integrationWrite);
      await configure([{menu:'operations_settings',role:'admin',access:'full'},{menu:'popup_settings',role:'admin',access:'full'},{menu:'integration_settings',role:'admin',access:'full'}]);
      await check('delegated classroom insert saves',true,roomWrite);
      await check('delegated popup insert saves',true,popupWrite);
      await check('delegated integration insert saves',true,integrationWrite);
      await configure([]);
      await check('integration status updates remain available',true,s=>s`update user_integrations set last_error='ROLLBACK ROLE TEST' where tenant_id=${tenant} and provider='role_test'`);
      await check('integration upsert status updates remain available',true,s=>s`insert into user_integrations(tenant_id,provider,last_error) values(${tenant},'role_test','ROLLBACK ROLE TEST 2') on conflict(tenant_id,provider) do update set last_error=excluded.last_error`);
      await check('integration upsert cannot bypass configuration guard',false,s=>s`insert into user_integrations(tenant_id,provider,sync_enabled) values(${tenant},'role_test',true) on conflict(tenant_id,provider) do update set sync_enabled=excluded.sync_enabled`);
      await check('revoked classroom grant cannot delete',false,s=>s`delete from classrooms where tenant_id=${tenant} and name='ROLLBACK ROLE TEST'`);
      await check('revoked popup grant cannot delete',false,s=>s`delete from notice_popups where tenant_id=${tenant} and title='ROLLBACK ROLE TEST'`);
      await check('revoked integration grant cannot delete',false,s=>s`delete from user_integrations where tenant_id=${tenant} and provider='role_test'`);
      await configure([{menu:'owner',role:'admin',access:'readonly'},{menu:'ai_ment',role:'admin',access:'none'}],[{menu:'owner',userId:actor.id,access:'full'}]);
      await tx.unsafe(migration);
      const [copied]=await tx`select data->'permissions' as permissions from tenant_settings where tenant_id=${tenant}`;
      assert.equal(copied.permissions.overrides.find(r=>r.menu==='report_settings').access,'readonly');
      assert.equal(copied.permissions.overrides.find(r=>r.menu==='ai_ment').access,'none');
      assert.equal(copied.permissions.userOverrides.find(r=>r.menu==='report_settings').access,'full');
      await tx.unsafe(migration);
      const [twice]=await tx`select data->'permissions' as permissions from tenant_settings where tenant_id=${tenant}`;
      assert.deepEqual(twice,copied); results.push('migration preserves delegation and explicit settings and is idempotent');
      throw new Error('ROLLBACK_SUCCESS');
    });
  } catch(e) { if(e.message !== 'ROLLBACK_SUCCESS') throw e; }
  const [after] = await db`select md5(data::text) hash from tenant_settings where tenant_id=${tenant}`;
  assert.deepEqual(after,before,'settings restored after transaction');
  console.log(JSON.stringify({passed:results.length,checks:results,rolledBack:true}));
} finally { await db.end(); }
