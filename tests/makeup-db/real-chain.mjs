/** 실제 마이그레이션 체인 대조(정적) — 합성 fixture가 실제 스키마에 없는 것을 지어내지 않았는지 자동으로 본다.
 *
 * 원장 SQL은 합성 fixture 위에서 검증된다. 그래서 "fixture에만 있고 실제 DB에는 없는 표·칸·enum 값·함수"가 있으면
 * 시나리오는 통과하는데 운영 적용은 실패한다. 이 대조가 그 틈을 막는다:
 *   원장 SQL ⊆ fixture   … 시나리오가 실제로 실행해 증명한다
 *   fixture ⊆ 실제 체인  … 이 파일이 모든 실제 마이그레이션(보강 원장 파일 제외)을 순서대로 읽어 증명한다
 * 읽는 것: CREATE TABLE · ALTER TABLE ADD/DROP/RENAME COLUMN · CREATE TYPE … ENUM · ALTER TYPE ADD VALUE · CREATE FUNCTION.
 * DB에 접속하지 않는다(파일만 읽는다). 실제 DB에 적용해 보는 검증은 이 실행기의 범위 밖이다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrationFiles } from '../../src/lib/db/migrations-corpus.mjs';

const strip = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const ident = (s) => s.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();
const NAME = '((?:"?public"?\\.)?"?[a-z_][a-z0-9_]*"?)';
const SKIP = new Set(['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like']);

/** 괄호 깊이를 세어 `(` 다음부터 짝이 맞는 `)` 앞까지를 돌려준다. */
function body(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  return '';
}
/** 최상위 쉼표로 나눈다(괄호·따옴표 안의 쉼표는 건너뛴다). */
function pieces(text) {
  const out = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quote = !quote;
    else if (!quote && c === '(') depth++;
    else if (!quote && c === ')') depth--;
    else if (!quote && depth === 0 && c === ',') { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((p) => p.trim()).filter(Boolean);
}

/** SQL 한 덩어리를 읽어 schema({tables: Map<name, Set<col>>, enums: Map<name, Set<value>>, functions: Set})에 반영한다. */
export function absorb(schema, raw) {
  const sql = strip(raw);
  for (const m of sql.matchAll(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}\\s*\\(`, 'gi'))) {
    const cols = schema.tables.get(ident(m[1])) ?? new Set();
    for (const piece of pieces(body(sql, m.index + m[0].length - 1))) {
      const first = ident(piece.split(/\s+/)[0]);
      if (!SKIP.has(first)) cols.add(first);
    }
    schema.tables.set(ident(m[1]), cols);
  }
  for (const m of sql.matchAll(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${NAME}\\s+([^;]+);`, 'gi'))) {
    const cols = schema.tables.get(ident(m[1])) ?? new Set();
    for (const piece of pieces(m[2])) {
      const add = piece.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)\s/i);
      const drop = piece.match(/^drop\s+column\s+(?:if\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)/i);
      const rename = piece.match(/^rename\s+(?:column\s+)?("?[a-z_][a-z0-9_]*"?)\s+to\s+("?[a-z_][a-z0-9_]*"?)/i);
      if (add && !SKIP.has(ident(add[1]))) cols.add(ident(add[1]));
      if (drop) cols.delete(ident(drop[1]));
      if (rename && ident(rename[1]) !== 'constraint') { cols.delete(ident(rename[1])); cols.add(ident(rename[2])); }
    }
    schema.tables.set(ident(m[1]), cols);
  }
  for (const m of sql.matchAll(new RegExp(`create\\s+type\\s+${NAME}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, 'gi'))) {
    schema.enums.set(ident(m[1]), new Set([...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1])));
  }
  for (const m of sql.matchAll(new RegExp(`alter\\s+type\\s+${NAME}\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?'([^']*)'`, 'gi'))) {
    const values = schema.enums.get(ident(m[1])) ?? new Set();
    values.add(m[2]);
    schema.enums.set(ident(m[1]), values);
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:"?[a-z_]+"?\.)?"?[a-z_][a-z0-9_]*"?)\s*\(/gi)) {
    schema.functions.add(m[1].replace(/"/g, '').toLowerCase());
  }
  return schema;
}
const empty = () => ({ tables: new Map(), enums: new Map(), functions: new Set() });

/** fixture가 실제 체인의 부분집합인지 대조한다. 어긋난 목록(문장 배열)을 돌려준다 — 비어 있으면 통과. */
export async function checkRealChain(root) {
  // 적용 순서(시즌1 합본 구역 → 시즌2 파일) — 원래 파일 이름으로(2026-10-27 시즌2).
  const files = migrationFiles(root).filter((f) => !/^03(?:4[3-9]|5\d)[a-z]_makeup_/.test(f.name));
  const real = empty();
  for (const f of files) absorb(real, f.sql);
  const fixture = absorb(empty(), await readFile(path.join(root, 'tests/makeup-db/fixture.sql'), 'utf8'));
  const problems = [];
  let columns = 0;
  for (const [table, cols] of fixture.tables) {
    // mt.* · auth.* 는 검증 도구·Supabase 내장이라 실제 마이그레이션에 없다(대조 대상 아님).
    if (table.includes('.')) continue;
    const have = real.tables.get(table);
    if (!have) { problems.push(`표 public.${table}: 실제 마이그레이션에 없다`); continue; }
    for (const c of cols) {
      columns++;
      if (!have.has(c)) problems.push(`칸 public.${table}.${c}: 실제 마이그레이션에 없다`);
    }
  }
  for (const [name, values] of fixture.enums) {
    const have = real.enums.get(name);
    if (!have) { problems.push(`enum public.${name}: 실제 마이그레이션에 없다`); continue; }
    for (const v of values) if (!have.has(v)) problems.push(`enum public.${name} 값 '${v}': 실제 마이그레이션에 없다`);
  }
  // fixture가 흉내 내는 public 함수(권한 helper 등)는 실제 체인에도 정의돼 있어야 한다.
  let fns = 0;
  for (const fn of fixture.functions) {
    if (!fn.startsWith('public.')) continue;
    fns++;
    if (!real.functions.has(fn) && !real.functions.has(fn.replace(/^public\./, ''))) problems.push(`함수 ${fn}: 실제 마이그레이션에 없다`);
  }
  // SQL 체인 밖에서 들어온 값(Drizzle 스키마에만 있다)은 숨기지 않고 따로 적는다. 허용 조건 = Drizzle 스키마에 실제로 있고,
  // 원장 SQL이 그 값을 enum으로 캐스팅하지 않는다(문자열 비교만 — enum에 값이 없어도 깨지지 않는다).
  const notes = [];
  const drizzle = await readFile(path.join(root, 'src/lib/db/schema.ts'), 'utf8');
  const ledger = [];
  for (const f of migrationFiles(root).filter((n) => /^03(?:4[3-9]|5\d)[a-z]_makeup_.*\.sql$/.test(n.name))) ledger.push(strip(f.sql));
  const outOfChain = [{
    problem: "enum public.system_role 값 'student': 실제 마이그레이션에 없다",
    inDrizzle: /systemRoleEnum = pgEnum\("system_role", \[[^\]]*"student"/.test(drizzle),
    castsEnum: ledger.some((sql) => /'student'::(public\.)?system_role|system_role\s*(=|<>|!=)\s*'student'/i.test(sql)),
    note: "system_role 'student'는 SQL 체인에 추가문이 없다(Drizzle 스키마에만 있다) — 원장 SQL은 이 값을 문자열(::text)로만 비교한다",
  }];
  for (const known of outOfChain) {
    const at = problems.indexOf(known.problem);
    if (at >= 0 && known.inDrizzle && !known.castsEnum) { problems.splice(at, 1); notes.push(known.note); }
  }
  const tables = [...fixture.tables.keys()].filter((t) => !t.includes('.')).length;
  return { problems, notes, summary: `${files.length} real files · ${tables} tables · ${columns} columns · ${fixture.enums.size} enums · ${fns} functions` };
}
