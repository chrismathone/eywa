/** 보강 원장 SQL 검증 실행기 — 격리된 로컬 Postgres 전용.
 *   node tests/makeup-db/run.mjs --reset            스키마를 새로 만들고 전부 실행
 *   node tests/makeup-db/run.mjs [--only <이름조각>]  시나리오만 다시 실행
 *   node tests/makeup-db/run.mjs --real-chain       실제 마이그레이션 전부로 만든 스키마 위에서 전부 실행(끝난 뒤 --reset으로 fixture 복귀)
 * 접속은 127.0.0.1의 makeup_* DB로만 한다(환경 파일·운영 주소를 읽지 않는다).
 *   MAKEUP_DB_PORT(기본 55444) · MAKEUP_DB_NAME(기본 makeup_test) · MAKEUP_DB_USER/PASSWORD(기본 로컬 전용 값)
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { checkRealChain } from './real-chain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const database = process.env.MAKEUP_DB_NAME ?? 'makeup_test';
assert.match(database, /^makeup_[a-z0-9_]+$/, 'isolated makeup_* database required');
const config = {
  host: '127.0.0.1',
  port: Number(process.env.MAKEUP_DB_PORT ?? 55444),
  database,
  user: process.env.MAKEUP_DB_USER ?? 'makeup_test',
  password: process.env.MAKEUP_DB_PASSWORD ?? 'makeup_local_only',
};
const connect = () => postgres({ ...config, max: 1, onnotice: () => {}, connect_timeout: 10 });
const read = (rel) => readFile(path.join(root, rel), 'utf8');
// --real-chain: fixture 대신 실제 마이그레이션 전부로 스키마를 만들고, 같은 시나리오를 그 위에서 돌린다.
const realChain = process.argv.includes('--real-chain');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

const db = connect();
let failed = 0;
try {
  const [{ name }] = await db`select current_database() as name`;
  assert.equal(name, database);
  const migrations = (await readdir(path.join(root, 'supabase/migrations')))
    .filter((f) => /^03(?:4[3-9]|5\d)[a-z]_makeup_.*\.sql$/.test(f))
    .sort();
  // 정적 대조 ①: 원장 SQL은 출결·보고서·청구를 쓰지 않고 0267a 산식을 다시 정의하지 않는다.
  const forbidden =
    /session_term_attendance|(insert\s+into|update|delete\s+from)\s+(public\.)?(attendance_records|lesson_reports|invoices|invoice_session_terms|onescreen_daily_sessions)\b/i;
  const NL = String.fromCharCode(10);
  for (const f of migrations) {
    const lines = (await read(`supabase/migrations/${f}`)).split(NL);
    if (lines.at(-1) === '') lines.pop();
    const body = lines.filter((l) => !l.trim().startsWith('--')).join(NL);
    assert.ok(!forbidden.test(body), `${f}: 출결·보고서·청구 표를 쓰거나 청구 산식을 건드린다`);
    assert.ok(lines.length <= 200, `${f}: 200줄 초과`);
  }
  // 정적 대조 ②: SQL의 기본 교시표가 코드 기본값(periods.ts)과 같다.
  const tsPeriods = await read('src/features/timetable/lib/periods.ts');
  const sqlPeriods = await read('supabase/migrations/0344b_makeup_settings_periods.sql');
  const pairs = (text) => [...text.matchAll(/startTime"?:\s*"(\d\d:\d\d)",\s*"?endTime"?:\s*"(\d\d:\d\d)"/g)].map((m) => `${m[1]}-${m[2]}`).join(',');
  const tsBlock = (name) => pairs(tsPeriods.slice(tsPeriods.indexOf(`const ${name}`)).split('};')[0]);
  const sqlBlock = (kind) => pairs(sqlPeriods.slice(sqlPeriods.indexOf(`when '${kind}' then`)).split("]'::jsonb")[0]);
  assert.equal(sqlBlock('weekday'), tsBlock('MATH_PERIODS'), '평일 기본 교시표 미러 불일치');
  assert.equal(sqlBlock('weekend'), tsBlock('WEEKEND_PERIODS'), '주말 기본 교시표 미러 불일치');
  assert.equal(sqlBlock('english'), tsBlock('ENGLISH_PERIODS'), '영어 기본 교시표 미러 불일치');
  console.log(`PASS static checks (${migrations.length} files: no attendance/report/billing writes, <=200 lines, period defaults mirror)`);
  // 정적 대조 ③: 기존 자동 시수의 자리 교시 이름(teacher-label.ts)이 SQL 예상 시수의 제외 목록과 같다.
  const labelTs = await read('src/features/timetable/lib/teacher-label.ts');
  const specials = [...labelTs.slice(labelTs.indexOf('const SPECIAL_BY_ALIAS')).split(']);')[0].matchAll(/\["([^"]+)",/g)].map((m) => m[1].toLowerCase()).sort();
  const unitsSql = await read('supabase/migrations/0345d_makeup_evidence_checks.sql');
  const sqlSpecials = (unitsSql.match(/not in \(('lab'[^)]*)\)/)?.[1] ?? '').split(',').map((v) => v.trim().replace(/'/g, '')).sort();
  assert.ok(specials.length > 0, '자리 교시 이름 표를 읽지 못했다');
  assert.deepEqual(sqlSpecials, specials, '자리 교시 이름 미러 불일치(teacher-label.ts SPECIAL_BY_ALIAS ↔ 0345d)');
  // 정적 대조 ④: 합성 fixture ⊆ 실제 마이그레이션 체인(표·칸·enum 값·함수).
  const chain = await checkRealChain(root);
  assert.deepEqual(chain.problems, [], `fixture가 실제 스키마와 다르다:${NL}  ${chain.problems.join(NL + '  ')}`);
  console.log(`PASS real migration chain (${chain.summary} — fixture is a subset of the real schema)`);
  for (const note of chain.notes) console.log(`NOTE real migration chain: ${note}`);
  if (realChain) {
    const { applyOnRealChain } = await import('./real-apply.mjs');
    const r = await applyOnRealChain({ db, root, assert });
    const attempted = r.real;
    const applied = attempted - r.skipped.length;
    assert.ok(applied >= 0, 'skipped count exceeds attempted migrations');
    console.log(`PASS real chain apply (${applied} real files applied, ${attempted} attempted, ${r.skipped.length} not applicable on the synthetic platform; ` +
      `${r.mine} ledger files apply + rerun with 0 failures; ${r.columns} referenced columns present; ${r.functions} private functions; triggers ${r.triggers})`);
    for (const line of r.skipped) console.log(`  SKIP ${line}`);
  }
  if (process.argv.includes('--reset') && !realChain) {
    await db.unsafe(
      'drop schema if exists makeup_private cascade; drop schema if exists mt cascade; drop schema if exists auth cascade;' +
        ' drop schema public cascade; create schema public;',
    );
    await db.unsafe(await read('tests/makeup-db/fixture.sql'));
    const seed = await read('tests/makeup-db/seed.sql');
    await db.unsafe(await read('supabase/migrations/0264a_makeup_reservations.sql'));
    const apply = async (f) => {
      try {
        await db.unsafe(await read(`supabase/migrations/${f}`));
      } catch (e) {
        throw new Error(`${f}: ${e.message} (position ${e.position ?? '?'}) ${e.where ?? ''}`);
      }
    };
    for (const f of migrations) await apply(f);
    // 다시 실행해도 안전해야 한다(이 저장소의 SQL은 손으로 재실행된다).
    for (const f of migrations) await apply(f);
    await db.unsafe(seed); // 시드 도우미는 원장 함수(makeup_private)를 쓰므로 마이그레이션 뒤에 올린다.
    console.log(`PASS apply + rerun (${migrations.length} files)`);
  }
  const scenarios = (await readdir(path.join(here, 'sql'))).filter((f) => f.endsWith('.sql')).sort();
  for (const f of scenarios) {
    if (only && !f.includes(only)) continue;
    try {
      // 시나리오 파일은 스스로 begin … rollback 한다(합성 데이터가 남지 않는다).
      const res = await db.unsafe(await read(`tests/makeup-db/sql/${f}`));
      const last = Array.isArray(res) ? res.at(-1) : res;
      console.log(`PASS ${f}${last?.[0]?.passed != null ? ` (${last[0].passed} checks)` : ''}`);
    } catch (e) {
      failed++;
      await db.unsafe('rollback').catch(() => {});
      console.log(`FAIL ${f}: ${e.message}${e.detail ? ` | ${e.detail}` : ''}${e.where ? `\n  ${String(e.where).split('\n')[0]}` : ''}`);
    }
  }
  // 두 연결이 필요한 동시성 시나리오.
  const jsDir = path.join(here, 'concurrency');
  const js = (await readdir(jsDir).catch(() => [])).filter((f) => f.endsWith('.mjs')).sort();
  for (const f of js) {
    if (only && !f.includes(only)) continue;
    try {
      const mod = await import(new URL(`./concurrency/${f}`, import.meta.url));
      const n = await mod.default({ connect, assert });
      console.log(`PASS ${f} (${n} checks)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${f}: ${e.message}`);
    }
  }
} finally {
  await db.end({ timeout: 5 });
}
if (failed) {
  console.log(`${failed} scenario file(s) failed`);
  process.exit(1);
}
