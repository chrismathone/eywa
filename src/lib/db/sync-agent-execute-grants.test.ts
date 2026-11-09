/**
 * **연동 역할(`eywa_sync_agent`) 실행권 가드** — 원장 2026-11-09 *"제안 바로 적용"*.
 *
 * 사고(2026-11-06 17:37~19:17): s2_0031이 **이미 있던** public 보안 정의자 함수 11개의 PUBLIC 실행권을 동적으로(`format('revoke execute on
 * function %s from public')`) 거뒀다 → 연동 PC 역할이 RLS 정책의 겉함수(`auth_tenant_id()` 속 `operator_view_tenant()`)를 못 불러 42501 →
 * ClassNote 발송·학부모 글 감지·메이크에듀 요청 집기가 멈췄다(고침 s2_0032 = 그 11개를 연동 역할에 명시로 · 함정 #155).
 *
 * 규칙: 시즌2 SQL이 **이미 있던 함수**(이 파일보다 앞선 SQL에 정의된 것 — 이 파일에서 다시 만들어도 이미 있던 것으로 본다)의 실행권을 PUBLIC에서
 * 거두면(함수 이름이 `%s`인 동적 문 · `all functions/routines in schema` · `alter default privileges … on functions/routines` 포함) 같은 파일에서
 * ① 이름으로 거둔 함수마다 `eywa_sync_agent`에 실행권을 다시 주거나(동적·스키마 전체는 연동 역할에 주는 문장 하나) ② 확인 줄
 * `-- 연동 역할 실행권 확인: <근거>`(연동 질의·정책이 그 함수를 지나지 않는다는 근거)를 남긴다. 판정은 주석을 뺀 본문으로(확인 줄만 원문).
 * 그 파일에서 처음 만든 함수의 기본 실행권 정리(`create function f …; revoke execute on function f(…) from public`)는 평범한 패턴이라 대상이 아니다.
 * 🔴 적용 뒤에는 연동 PC 워커 신호·42501을 확인한다 — 이 가드는 커밋 때 잊지 않게 하는 문지기일 뿐이다(손으로 돌리는 `scripts/_oneoff/*.sql`은 보지 않는다).
 */
import { describe, expect, it } from "vitest";
import { migrationFiles, readMigration, season2Names } from "./migrations-corpus.mjs";

const REVOKE_FN =
  /revoke\s+(?:all(?:\s+privileges)?|execute)\s+on\s+(all\s+(?:functions|routines)\s+in\s+schema|functions|routines|function|routine)\b([^;]*?)\bfrom\b([^;]*)/gi;
const CREATE_FN = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
const MARK = /^\s*--\s*연동 역할 실행권 확인:\s*\S/m;
/** 이미 고친 파일 → 고친 파일(운영 적용 끝 — 고친 파일이 연동 역할에 다시 준다). */
const FIXED_BY: Record<string, string> = { "s2_0031_academy_assistant.sql": "s2_0032_sync_agent_helper_grants.sql" };
/** 확인을 마친 옛 파일(적용 끝 — 파일을 고치지 않고 근거를 여기에). */
const CHECKED: Record<string, string> = {
  "s2_0004_video_upload_check_any_retry.sql":
    "staff_tasks_private = 트리거(전부 보안 정의자)·보안 정의자 함수 안에서만 부른다(트리거 함수 실행권은 발화 때 검사하지 않는다) · RLS 정책·연동 질의 목록에 없음(2026-11-09 확인) · 10월 적용 뒤 연동 PC 정상",
  "s2_0029_intake_care_and_sheet_evidence.sql": "save_student_care = s2_0028에서 만들 때 이미 PUBLIC 회수 · 다시 거둬도 변화 없음 · 연동 질의·정책 없음(2026-11-09 확인)",
  "s2_0033_money_carry_chain.sql": "save_session_term_money_carryover = 0278a에서 이미 PUBLIC·anon 회수 · 연동 질의·정책 없음(2026-11-09 확인)",
};

/** 주석(`-- …` 줄 끝 · `/* … *\/`)을 뺀 본문 — 주석 속 revoke·grant에 속지 않게. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** 대상 글에서 함수 이름들(괄호 바깥 · 스키마 떼고 소문자) — 인자 형식 `numeric(10,2)`는 이름이 아니다. */
function targetNames(target: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let segment = "";
  const flush = () => {
    const m = /^\s*(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?\s*$/i.exec(segment);
    if (m) names.push(m[1].toLowerCase());
    segment = "";
  };
  for (const ch of target) {
    if (ch === "(") {
      if (depth === 0) flush();
      depth++;
    } else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch !== ",") segment += ch;
    else if (depth === 0 && ch === ",") segment = "";
  }
  return names;
}

export const createdNames = (sql: string): string[] => [...stripSqlComments(sql).matchAll(CREATE_FN)].map((m) => m[1].toLowerCase());

/** 이 파일보다 앞선 SQL(시즌1 구역 → 시즌2)에 정의된 함수 이름들. */
function definedBefore(name: string): Set<string> {
  const out = new Set<string>();
  for (const f of migrationFiles()) {
    if (f.name === name) break;
    for (const n of createdNames(f.sql)) out.add(n);
  }
  return out;
}

/**
 * 연동 역할 확인이 필요한 거두기 — `{ broad }`(동적·스키마 전체·기본 권한 — 연동 역할에 주는 문장 하나 또는 확인 줄로 풀린다) ·
 * `{ name }`(이미 있던 함수를 이름으로 — 그 이름으로 연동 역할에 다시 주거나 확인 줄).
 */
export function riskyRevokes(sql: string, existing: ReadonlySet<string> = new Set()): ({ broad: string } | { name: string })[] {
  const body = stripSqlComments(sql);
  const fresh = new Set(createdNames(sql).filter((n) => !existing.has(n)));
  const out: ({ broad: string } | { name: string })[] = [];
  for (const m of body.matchAll(REVOKE_FN)) {
    if (!/\bpublic\b/i.test(m[3])) continue;
    const kind = m[1].trim().toLowerCase();
    const dynamic = /%(?:\d+\$)?[sIL]/.test(m[2]) || /'\s*\|\|/.test(m[2]);
    const names = /^(function|routine)$/.test(kind) && !dynamic ? targetNames(m[2]) : [];
    if (!names.length) {
      out.push({ broad: m[0].replace(/\s+/g, " ").trim().slice(0, 120) });
      continue;
    }
    for (const n of names) if (!fresh.has(n)) out.push({ name: n });
  }
  return out;
}

/**
 * 연동 역할에 그 함수를 다시 주는가 — 주석 뺀 본문에서. `name === null`(넓게 거둔 것 — 동적·스키마 전체)은 **넓게 다시 준 것**(동적 문 · 스키마 전체)으로만
 * 풀린다 — 새 함수 하나에 준 grant로는 안 풀린다(재리뷰 2026-11-09).
 */
function grantsSync(body: string, name: string | null): boolean {
  const grants = [...body.matchAll(/grant\s+(?:all(?:\s+privileges)?|execute)\s+on\s+(?:function|routine|all\s+(?:functions|routines)\s+in\s+schema)\b([^;]*?)\bto\b([^;]*)/gi)]
    .filter((g) => /\beywa_sync_agent\b/i.test(g[2]));
  const broad = (g: RegExpMatchArray) => /%(?:\d+\$)?[sIL]/.test(g[1]) || /'\s*\|\|/.test(g[1]) || /\ball\s+(?:functions|routines)\s+in\s+schema/i.test(g[0]);
  if (name === null) return grants.some(broad);
  return grants.some((g) => targetNames(g[1]).includes(name) || broad(g));
}

/** 그 파일이 아직 확인되지 않은 거두기 — 사람이 읽을 이유. */
export function unresolvedRevokes(sql: string, existing: ReadonlySet<string> = new Set()): string[] {
  if (MARK.test(sql)) return [];
  const body = stripSqlComments(sql);
  return riskyRevokes(sql, existing)
    .filter((r) => ("broad" in r ? !grantsSync(body, null) : !grantsSync(body, r.name)))
    .map((r) => ("broad" in r ? r.broad : `이미 있던 함수 ${r.name}`));
}

describe("연동 역할 실행권 가드 — 이미 있던 함수의 PUBLIC 실행권을 거두면 연동 PC가 막힌다(2026-11-06 사고)", () => {
  it("🔴 시즌2 SQL: 이미 있던 함수의 실행권을 거두면 같은 파일에서 eywa_sync_agent에 다시 주거나 확인 줄을 남긴다", () => {
    const bad: string[] = [];
    const season2 = new Set(season2Names());
    const seen = new Set<string>(); // 적용 순서대로 한 번만 훑는다 — 이 파일보다 앞에 정의된 함수들
    for (const { name, sql } of migrationFiles()) {
      if (season2.has(name) && !CHECKED[name]) {
        const left = unresolvedRevokes(sql, seen);
        const fixer = FIXED_BY[name];
        if (left.length && !(fixer && grantsSync(stripSqlComments(readMigration(fixer)), null))) bad.push(`${name}: ${left.join(" | ")}`);
      }
      for (const n of createdNames(sql)) seen.add(n);
    }
    expect(bad, "연동 PC 역할(eywa_sync_agent)이 RLS·질의에서 그 함수를 지나는지 확인한 뒤 grant 또는 '-- 연동 역할 실행권 확인: <근거>'").toEqual([]);
  });

  it("가드가 헛돌지 않는다 — 사고 모양은 잡고 평범한 새 함수 정리는 놓아준다", () => {
    const existing = new Set(["auth_tenant_id", "operator_view_tenant"]);
    // 사고 그대로(s2_0031 — 동적 문 · 기본 권한)
    expect(unresolvedRevokes(readMigration("s2_0031_academy_assistant.sql"), definedBefore("s2_0031_academy_assistant.sql")).length).toBeGreaterThan(0);
    expect(unresolvedRevokes("do $$ begin execute format('revoke execute on function %s from public', r.fn); end $$;")).toHaveLength(1);
    expect(unresolvedRevokes("revoke execute on all functions in schema public from public;")).toHaveLength(1);
    // 넓게 거둔 것은 새 함수 하나에 준 grant로 안 풀린다(재리뷰)
    expect(unresolvedRevokes("do $$ begin execute format('revoke execute on function %s from public', r.fn); end $$;\ngrant execute on function public.new_fn() to eywa_sync_agent;")).toHaveLength(1);
    expect(unresolvedRevokes("revoke execute on all functions in schema public from public;\ngrant execute on function public.x() to eywa_sync_agent;")).toHaveLength(1);
    expect(unresolvedRevokes("revoke execute on all routines in schema public from public;")).toHaveLength(1);
    expect(unresolvedRevokes("alter default privileges in schema x revoke execute on functions from public;")).toHaveLength(1);
    expect(unresolvedRevokes("alter default privileges in schema x revoke execute on routines from public;")).toHaveLength(1);
    // 이미 있던 함수를 이름으로 · 다시 만들고 거두기(#155 남은 구멍)
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from public;", existing)).toEqual(["이미 있던 함수 auth_tenant_id"]);
    expect(
      unresolvedRevokes("drop function public.operator_view_tenant();\ncreate function public.operator_view_tenant() returns uuid language sql as $$ select null::uuid $$;\nrevoke execute on function public.operator_view_tenant() from public, anon;\ngrant execute on function public.operator_view_tenant() to authenticated, service_role;", existing),
    ).toEqual(["이미 있던 함수 operator_view_tenant"]);
    expect(unresolvedRevokes("REVOKE EXECUTE ON ROUTINE public.auth_tenant_id() FROM PUBLIC;", existing)).toEqual(["이미 있던 함수 auth_tenant_id"]);
    // 그 이름으로 연동 역할에 다시 주면 풀린다 · 무관한 grant·주석 속 grant로는 안 풀린다
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from public;\ngrant execute on function public.auth_tenant_id() to authenticated, eywa_sync_agent;", existing)).toEqual([]);
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from public;\ngrant all on table public.foo to eywa_sync_agent;", existing)).toHaveLength(1);
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from public;\n-- grant execute on function public.auth_tenant_id() to eywa_sync_agent;", existing)).toHaveLength(1);
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from public;\n  -- 연동 역할 실행권 확인: 정책·연동 질의가 안 지난다", existing)).toEqual([]);
    // 평범한 새 함수 정리 · 인자 형식 · PUBLIC 아닌 역할 · 주석 속 revoke — 대상 아님
    expect(unresolvedRevokes("create or replace function public.f(a numeric(10,2)) returns int language sql as $$ select 1 $$;\nrevoke execute on function public.f(numeric(10,2)) from public, anon;\ngrant execute on function public.f(numeric(10,2)) to authenticated;", existing)).toEqual([]);
    expect(unresolvedRevokes("revoke execute on function public.auth_tenant_id() from anon;", existing)).toEqual([]);
    expect(unresolvedRevokes("-- revoke execute on function public.auth_tenant_id() from public;", existing)).toEqual([]);
    // 고친 파일이 정말 연동 역할에 준다
    expect(grantsSync(stripSqlComments(readMigration("s2_0032_sync_agent_helper_grants.sql")), null)).toBe(true);
  });
});
