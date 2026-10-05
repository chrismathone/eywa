/** 실제 마이그레이션 체인 위에 원장 SQL을 올려 보는 검증(동적) — `node tests/makeup-db/run.mjs --real-chain`
 *
 * 합성 fixture 대신 **저장소의 실제 마이그레이션 전부**를 순서대로 적용한 스키마 위에 보강 원장 파일을 두 번(적용 + 재실행) 올린다.
 * 확인하는 것:
 *   ① 원장 파일이 실제 표·타입·함수 위에서 오류 없이 적용·재실행된다(SQL 함수 본문은 만드는 순간 실제 칸으로 검증된다).
 *   ② plpgsql 본문이 참조하는 표·칸이 실제 스키마에 있다(본문은 만들 때 검증되지 않으므로 fixture 칸을 카탈로그와 대조한다).
 *   ③ 관측·가드 트리거가 실제 표에 붙었다.
 * 한계(숨기지 않는다): Supabase 플랫폼(auth·storage·realtime·확장)은 최소한만 흉내 낸 합성판이다. 그래서 원장과 무관한
 *   기존 마이그레이션 일부가 실패할 수 있다 — 파일마다 따로 적용하고 실패를 목록으로 돌려준다(원장 파일의 실패는 0이어야 한다).
 *   ④ 이어서 실행기가 **같은 시나리오·동시성 검증을 이 실제 스키마 위에서** 돌린다(실제 제약·기존 트리거가 그대로 걸린다).
 *   데이터는 여전히 합성이고 운영 DB가 아니다 — 운영 데이터 분포·실제 Supabase 플랫폼 동작(PostgREST·JWT·실제 auth)은 범위 밖이다.
 * 이 모드는 DB를 비우고 다시 만든다 — 끝난 뒤 fixture로 돌아가려면 `--reset`을 다시 실행한다.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { absorb } from './real-chain.mjs';

const PLATFORM = `
do $$ declare r text; begin
  if current_database() !~ '^makeup_[a-z0-9_]+$' then raise exception 'isolated makeup database required'; end if;
  foreach r in array array['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'authenticator', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin %s', r, case when r = 'service_role' then 'bypassrls' else '' end);
    end if;
  end loop;
end $$;
drop schema if exists makeup_private cascade; drop schema if exists mt cascade; drop schema if exists auth cascade;
drop schema if exists storage cascade; drop schema if exists extensions cascade; drop schema public cascade;
create schema public; create schema auth; create schema storage; create schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create extension if not exists pgcrypto; create extension if not exists btree_gist; create extension if not exists pg_trgm;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, encrypted_password text,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb, banned_until timestamptz,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, deleted_at timestamptz, is_anonymous boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid $f$;
create function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create function auth.role() returns text language sql stable as $f$ select current_setting('request.jwt.claim.role', true) $f$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select string_to_array(name, '/') $f$;
alter table storage.objects enable row level security;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
`;

/** 원장 트리거가 붙어야 하는 실제 표. */
const TRIGGER_TABLES = ['attendance_records', 'tenant_settings', 'class_schedules', 'classes', 'enrollments', 'students', 'users',
  'lesson_reports', 'makeup_reservations'];

export async function applyOnRealChain({ db, root, assert }) {
  const dir = path.join(root, 'supabase/migrations');
  const all = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const mine = all.filter((f) => /^03(?:4[3-9]|5\d)[a-z]_makeup_.*\.sql$/.test(f));
  const real = all.filter((f) => !mine.includes(f));
  await db.unsafe(PLATFORM);
  const skipped = [];
  // 파일마다 따로 끝낸다: 파일 안에 begin이 있어도 실패가 다음 파일로 번지지 않게(성공 = commit · 실패 = rollback).
  const settle = (verb) => db.unsafe(verb).catch(() => {});
  for (const f of real) {
    try {
      await db.unsafe(await readFile(path.join(dir, f), 'utf8'));
      await settle('commit');
    } catch (e) {
      await settle('rollback');
      skipped.push(`${f}: ${String(e.message).slice(0, 140)}`);
    }
  }
  // 원장 파일은 실패가 하나도 없어야 한다(적용 + 재실행).
  const failed = [];
  for (const round of ['apply', 'rerun']) {
    for (const f of mine) {
      try {
        await db.unsafe(await readFile(path.join(dir, f), 'utf8'));
        await settle('commit');
      } catch (e) {
        await settle('rollback');
        failed.push(`${round} ${f}: ${e.message}${e.where ? ` @ ${String(e.where).split('\n')[0]}` : ''}`);
      }
    }
  }
  assert.deepEqual(failed, [], `원장 파일이 실제 체인 위에서 실패했다:\n  ${failed.join('\n  ')}`);
  // fixture가 든 표·칸이 방금 만든 실제 스키마(카탈로그)에 전부 있는가.
  const fixture = absorb({ tables: new Map(), enums: new Map(), functions: new Set() }, await readFile(path.join(root, 'tests/makeup-db/fixture.sql'), 'utf8'));
  const cols = await db`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  const have = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  const missing = [];
  let checked = 0;
  for (const [table, set] of fixture.tables) {
    if (table.includes('.')) continue;
    for (const c of set) { checked++; if (!have.has(`${table}.${c}`)) missing.push(`public.${table}.${c}`); }
  }
  assert.deepEqual(missing, [], `fixture의 칸이 실제 체인으로 만든 스키마에 없다: ${missing.join(', ')}`);
  const trig = await db`
    select c.relname as t, count(*)::int as n from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_proc p on p.oid = g.tgfoid join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'makeup_private' and not g.tgisinternal and c.relname = any (${TRIGGER_TABLES}) group by c.relname`;
  const attached = new Map(trig.map((r) => [r.t, r.n]));
  const untouched = TRIGGER_TABLES.filter((t) => !attached.get(t));
  assert.deepEqual(untouched, [], `원장 트리거가 붙지 않은 실제 표: ${untouched.join(', ')}`);
  // 검증 도구(mt.*)와 합성 시드를 올린다 — 이어서 실행기가 같은 시나리오를 이 실제 스키마 위에서 돌린다.
  const fx = await readFile(path.join(root, 'tests/makeup-db/fixture.sql'), 'utf8');
  await db.unsafe(fx.slice(fx.indexOf('create schema mt;')));
  await db.unsafe(await readFile(path.join(root, 'tests/makeup-db/seed.sql'), 'utf8'));
  const fns = await db`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'makeup_private'`;
  return { real: real.length, mine: mine.length, skipped, columns: checked, triggers: [...attached].map(([t, n]) => `${t}:${n}`).join(' '), functions: fns[0].n };
}
