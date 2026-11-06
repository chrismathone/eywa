import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TENANT_VIEW_HEADER,
  expectedTenantFromMark,
  isOperatorConsolePath,
  parseTenantViewCookie,
  parseTenantViewMark,
  tenantViewCookieValue,
  tenantViewMarkValue,
  tenantViewResyncHref,
} from "./tenant-view-shared";
import { TENANT_VIEW_READ_RPCS } from "@/lib/supabase/tenant-view-guard";

import { migrationFiles, readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) 배선 가드.
 *
 * 이 기능은 여러 층이 **같은 이름 · 같은 목록 · 같은 판정**을 봐야 성립한다 — 앱이 싣는 헤더 이름과 DB 함수가 찾는 이름,
 * 통과시키는 읽기 함수 목록과 실제 STABLE 함수, 가드 없는 클라이언트를 쓰는 자리, 사람 · 헤더 · 쓰기 차단이 읽는 판정.
 * 한쪽만 바뀌면 타입체크는 통과한 채 보기가 조용히 꺼지거나(헤더) 읽기가 막히거나(목록) 쓰기 벽이 빠진다.
 */
const ROOT = resolve(process.cwd());
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walk(join(ROOT, "src"));
const rel = (p: string) => p.slice(ROOT.length + 1).split(sep).join("/");
const noSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");
// 적용 순서(시즌1 합본 구역 → 시즌2 파일) — 원래 파일 이름으로.
const MIGRATIONS = migrationFiles(ROOT).map((m) => m.name);

describe("지점 보기 — DB 쪽 약속(0356a)", () => {
  const sql = readMigration("0356a_operator_tenant_view.sql");
  const body = noSqlComments(sql);

  it("DB 함수 셋(보기 판정 · 지점 · 역할)이 앱이 싣는 헤더를 **키 모양 그대로** 찾는다", () => {
    // 겉함수 둘은 `"이름":"` 글자 찾기, 보기 판정은 같은 모양에서 토큰을 정규식으로 뽑는다. 이름만 찾으면 다른 헤더의 값에 그 글자가
    // 들어 있는 보통 요청까지 보기 길로 들어간다.
    expect(body.split(`'"${TENANT_VIEW_HEADER}":"'`).length - 1).toBe(3);
    // 보기 판정은 그 글자(22자) 바로 뒤 36글자를 토큰으로 자르고, 다음 글자가 닫는 따옴표인지 본다.
    expect(`"${TENANT_VIEW_HEADER}":"`.length).toBe(22);
    expect(body).toContain("v_token := substr(v_headers, v_at + 22, 36);");
    expect(body).toContain("if substr(v_headers, v_at + 58, 1) is distinct from '\"'");
    expect(body).not.toContain(`'${TENANT_VIEW_HEADER}'`);
  });

  it("🔴 겉함수의 식은 `case`뿐이다 — `coalesce`를 쓰지 않는다(실행 계획이 달라진다)", () => {
    for (const fn of ["auth_tenant_id", "auth_system_role"]) {
      const def = new RegExp(`create or replace function public\\.${fn}\\(\\)[^;]*;`).exec(body)?.[0] ?? "";
      expect(def, fn).toMatch(/return case when /);
      expect(def, fn).not.toMatch(/coalesce/i);
    }
    // 살아 있는 보기가 아니면(보기 판정이 null이면) 속함수 = 종전 값으로 간다 — 헤더를 흉내 내어 실어도 null이 되지 않는다.
    expect(body).toMatch(/and public\.operator_view_tenant\(\) is not null\s+then public\.operator_view_tenant\(\)\s+else public\.auth_tenant_id_base\(\) end;/);
    expect(body).toMatch(/and public\.operator_view_tenant\(\) is not null\s+then 'master'::text\s+else public\.auth_system_role_base\(\) end;/);
  });

  it("🔴 보기 판정은 읽기 전용 트랜잭션이 아니면 null — 이 줄이 읽기 전용 보장의 전부다", () => {
    const fn = /create or replace function public\.operator_view_tenant\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
    expect(fn).toMatch(/if current_setting\('transaction_read_only', true\) is distinct from 'on' then\s+return null;/);
    // 오류가 날 수 있는 변환(JSON) · 예외 블록을 쓰지 않는다. uuid로 바꾸는 것은 모양을 확인한 뒤다.
    expect(noSqlComments(fn)).not.toMatch(/::json|exception\s+when/i);
    expect(fn.indexOf("v_token !~ '^[0-9a-f]{8}-")).toBeLessThan(fn.indexOf("v_token::uuid"));
    // 싼 검사부터: 읽기 전용 → 로그인 → 토큰 모양 → 표 조회(가짜 헤더가 줄마다 표 조회까지 가지 않게).
    const order = ["transaction_read_only", "v_uid := auth.uid();", "strpos(v_headers,", "from public.operator_tenant_views"].map((t) => fn.indexOf(t));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!))).toBe(true);
    // 토큰만으로는 안 된다: 본인 것 · 안 끝남 · 만료 전 · 명단에 있음.
    for (const cond of ["v.operator_id = v_uid", "v.ended_at is null", "v.expires_at > now()", "public.super_admins"]) expect(fn).toContain(cond);
  });

  it("🔴 겉함수 둘은 펼쳐지는 모양이다 — SECURITY DEFINER · SET 절이 없고 `return` 본문", () => {
    for (const fn of ["auth_tenant_id", "auth_system_role"]) {
      const def = new RegExp(`create or replace function public\\.${fn}\\(\\)[^;]*;`).exec(body)?.[0] ?? "";
      expect(def, fn).toMatch(/language sql\s+stable\s+return /);
      expect(def, fn).not.toMatch(/security definer|\bset\s+search_path/i);
      expect(def, fn).toContain("public.operator_view_tenant()");
      expect(def, fn).toContain(`public.${fn}_base()`);
    }
  });

  it("🔴 속함수 둘은 종전 본문 그대로다(SECURITY DEFINER · search_path 고정)", () => {
    const base = (fn: string) => new RegExp(`create or replace function public\\.${fn}\\(\\)([\\s\\S]*?)as \\$\\$([\\s\\S]*?)\\$\\$`).exec(body);
    const t = base("auth_tenant_id_base");
    const r = base("auth_system_role_base");
    expect(t?.[2].trim()).toBe("select tenant_id from public.users where id = auth.uid()");
    expect(r?.[2].trim()).toBe("select system_role::text from public.users where id = auth.uid()");
    for (const m of [t, r]) expect(m?.[1]).toMatch(/security definer\s+set search_path = public, auth/);
  });

  it("계획기가 보는 비용은 종전(100)과 같다 — 지점: 1+1+1+보기 1+보기 1+속함수 95 · 역할: 1+1+1+보기 1+속함수 96", () => {
    const cost = (fn: string) => Number(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\bcost (\\d+)`).exec(body)?.[1]);
    const calls = (fn: string) => (new RegExp(`create or replace function public\\.${fn}\\(\\)[^;]*;`).exec(body)?.[0] ?? "").split("public.operator_view_tenant()").length - 1;
    // 글자 찾기 · 설정 읽기 · 비교는 PostgreSQL 기본 비용 1씩.
    expect(3 + calls("auth_tenant_id") * cost("operator_view_tenant") + cost("auth_tenant_id_base")).toBe(100);
    expect(3 + calls("auth_system_role") * cost("operator_view_tenant") + cost("auth_system_role_base")).toBe(100);
    expect([calls("auth_tenant_id"), calls("auth_system_role")]).toEqual([2, 1]);
  });

  it("속함수 · 보기 함수는 누구나 실행한다 — 겉함수에 새 역할의 권한을 주는 마이그레이션이 속함수를 빠뜨릴 일이 없게", () => {
    for (const fn of ["operator_view_tenant", "auth_tenant_id_base", "auth_system_role_base"]) {
      expect(body).toContain(`grant execute on function public.${fn}() to public;`);
    }
    expect(body).not.toMatch(/revoke[^;]*on function/i);
  });

  it("보기 표는 정책 없이 잠겨 있고 다른 표를 참조하지 않는다(기존 표에 잠금 · 트리거를 걸지 않는다)", () => {
    expect(body).toContain("alter table public.operator_tenant_views enable row level security");
    expect(body).toContain("revoke all on public.operator_tenant_views from public, anon, authenticated");
    expect(body).not.toMatch(/create policy[^;]*operator_tenant_views/i);
    const table = /create table if not exists public\.operator_tenant_views \(([\s\S]*?)\n\);/.exec(body)?.[1] ?? "";
    expect(table).not.toMatch(/references/i);
    expect(table).toMatch(/check \(expires_at > created_at and expires_at <= created_at \+ interval '12 hours'\)/);
  });

  it("되돌리기가 두 단계로 적혀 있다 — 겉함수를 먼저 종전 본문으로(커밋), 실행 중이던 문장이 끝난 뒤에 지운다", () => {
    const rollback = sql.split("되돌릴 때")[1] ?? "";
    const [phase1 = "", phase2 = ""] = rollback.split("[2단계]");
    // 1단계는 겉함수 둘을 종전 본문으로 되돌릴 뿐 아무것도 지우지 않는다 — 한 번에 지우면 실행 중이던 문장이 "함수가 없다"로 실패한다.
    expect(phase1).toContain("[1단계]");
    expect(phase1).toContain("create or replace function public.auth_tenant_id()");
    expect(phase1).toContain("create or replace function public.auth_system_role()");
    expect(phase1).not.toMatch(/drop (function|table)/);
    expect(phase1.split("commit;").length - 1).toBe(1);
    // 2단계에서 나머지를 지운다.
    const at = (s: string) => phase2.indexOf(s);
    expect(at("drop function public.auth_tenant_id_base()")).toBeGreaterThan(0);
    expect(at("drop table public.operator_tenant_views")).toBeGreaterThan(at("drop function public.operator_view_tenant()"));
  });
});

describe("지점 보기 — 뒤에 오는 마이그레이션이 약속을 깨지 않는다", () => {
  const later = MIGRATIONS.filter((n) => n > "0356a_operator_tenant_view.sql").map((n) => [n, noSqlComments(readMigration(n, ROOT))] as const);

  it("🔴 겉함수를 옛 모양으로 되돌리는 마이그레이션이 없다(되돌리면 보기가 조용히 사라진다)", () => {
    for (const [name, sql] of later) {
      for (const fn of ["auth_tenant_id", "auth_system_role"]) {
        for (const m of sql.matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fn}\\s*\\(\\s*\\)[^;]*;`, "gi"))) {
          expect(m[0], `${name} · ${fn}`).toContain("operator_view_tenant()");
        }
      }
    }
  });

  it("🔴 어떤 마이그레이션도 `transaction_read_only`를 손으로 켜지 않는다(켜면 쓰기 요청에서 보는 지점으로 바뀔 수 있다)", () => {
    for (const n of MIGRATIONS) {
      const sql = noSqlComments(readMigration(n, ROOT));
      expect(sql, n).not.toMatch(/set_config\(\s*'(default_)?transaction_read_only'/i);
      expect(sql, n).not.toMatch(/set\s+(local\s+|session\s+)?(default_)?transaction_read_only/i);
      expect(sql, n).not.toMatch(/set\s+transaction\s+read\s+only/i);
    }
  });
});

describe("지점 보기 — 통과시키는 읽기 함수 목록 = 실제 STABLE 함수", () => {
  // 마이그레이션에서 함수의 **마지막 정의**와 그 휘발성을 찾는다(속성은 본문 앞이나 뒤 어느 쪽에도 올 수 있다).
  const volatility = new Map<string, "stable" | "volatile">();
  const FN = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+(\$[a-z_]*\$)([\s\S]*?)\4([^;]*);/gi;
  for (const f of MIGRATIONS) {
    const sql = readMigration(f, ROOT);
    for (const m of sql.matchAll(FN)) {
      const attrs = `${m[3]} ${m[6]}`.toLowerCase();
      volatility.set(m[1]!.toLowerCase(), /\b(stable|immutable)\b/.test(attrs) ? "stable" : "volatile");
    }
  }
  // 이름을 글자로 적어 부르는 것(`.rpc("x"` · `readRpc("x"`)과, 변수로 부르는 자리의 후보 이름을 모은다.
  const called = new Set<string>();
  for (const f of SRC_FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_0-9]+)["'`]/g)) called.add(m[1]!);
    for (const m of src.matchAll(/\breadRpc\(\s*["'`]([a-z_0-9]+)["'`]/g)) called.add(m[1]!);
  }
  /**
   * 지점을 `auth_tenant_id()`가 아니라 로그인한 사람의 `users` 행에서 직접 정하는 함수들 — 보기 중에 부르면 본인 지점 기록이
   * 섞인다. 읽기 목록에 **넣지 않고**, 그 화면은 보기에서 닫는다(perm-matrix.ts `TENANT_VIEW_CLOSED_MENUS`).
   */
  const OWN_TENANT_RPC = /^makeup_/;

  it("앱이 부르는 함수를 충분히 찾았다(스캔이 빈손이면 아래 검사가 헛돈다)", () => {
    expect(called.size).toBeGreaterThan(40);
    expect(volatility.size).toBeGreaterThan(100);
    expect(called.has("makeup_list_cases")).toBe(true); // readRpc("…") 꼴도 잡는다
  });

  it("🔴 앱이 부르는 STABLE 함수는 전부 목록에 있다(빠지면 보기 화면에서만 그 조회가 막힌다)", () => {
    const missing = [...called].filter((fn) => volatility.get(fn) === "stable" && !OWN_TENANT_RPC.test(fn) && !TENANT_VIEW_READ_RPCS.has(fn)).sort();
    expect(missing).toEqual([]);
  });

  it("🔴 목록의 함수는 전부 STABLE이다(값을 바꾸는 함수가 섞이면 보기 중 쓰기가 통과한다)", () => {
    const notStable = [...TENANT_VIEW_READ_RPCS].filter((fn) => volatility.get(fn) !== "stable").sort();
    expect(notStable).toEqual([]);
  });

  it("🔴 본인 지점 기준으로 도는 함수(보강관리)는 목록에 없고, 그 메뉴는 보기에서 닫혀 있다", () => {
    expect([...TENANT_VIEW_READ_RPCS].filter((fn) => OWN_TENANT_RPC.test(fn))).toEqual([]);
    expect(read("src/lib/auth/perm-matrix.ts")).toMatch(/TENANT_VIEW_CLOSED_MENUS: readonly MenuKey\[\] = \[[^\]]*"makeups"[^\]]*\]/);
  });
});

describe("지점 보기 — 판정은 한 곳, 가드 없는 클라이언트는 보기 자체를 다루는 곳만", () => {
  it("createRawAdminClient 사용처가 잠긴 목록과 같다", () => {
    const users = SRC_FILES.filter((f) => rel(f) !== "src/lib/supabase/admin.ts" && readFileSync(f, "utf8").includes("createRawAdminClient")).map(rel).sort();
    expect(users).toEqual([
      "src/features/super-admin/server/audit.ts", // 보기 중 기록 대상 동작 → 운영 감사 로그 한 줄
      "src/features/super-admin/server/tenant-view-actions.ts", // 열기 전 지점 확인
      "src/lib/auth/tenant-view-session.ts", // 열기 · 닫기
      "src/lib/auth/tenant-view.ts", // 판정
    ]);
  });

  it("🔴 Supabase 클라이언트를 만드는 곳이 잠긴 목록과 같다 — 새로 생기면 쓰기 차단을 어떻게 지나는지 정하고 여기에 더한다", () => {
    const makers = SRC_FILES.filter((f) => {
      const src = readFileSync(f, "utf8");
      // 라이브러리에서 만드는 함수를 **값으로** 들여오는 파일만 센다(`import type`과 우리 모듈의 별칭은 아니다).
      return /^import \{[^}]*\}\s+from "@supabase\/ssr"/m.test(src) || /^import \{[^}]*\bcreateClient\b[^}]*\}\s+from "@supabase\/supabase-js"/m.test(src);
    }).map(rel).sort();
    expect(makers).toEqual([
      "src/features/demo-roster/demo-staff.ts", // 데모 재원 구성 — replaceDemoRoster의 문 뒤에서만 돈다
      "src/lib/supabase/admin.ts", // 가드 있는 판 + 가드 없는 판(보기 자체를 다루는 곳 전용)
      "src/lib/supabase/client.ts", // 브라우저 — 표를 쓰지 않는다
      "src/lib/supabase/proxy.ts", // 로그인 세션 갱신뿐
      "src/lib/supabase/server.ts", // 세션 클라이언트 — 가드 + 헤더
    ]);
  });

  it("🔴 Supabase 주소를 클라이언트 없이 직접 부르는 곳은 보기 확인 한 곳뿐이다(읽기 요청)", () => {
    const direct = SRC_FILES.filter((f) => /fetch\(\s*`\$\{SUPABASE_URL\}|fetch\(\s*SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL[^\n]*\/(rest|auth|storage|functions)\/v1/.test(readFileSync(f, "utf8"))).map(rel);
    expect(direct).toEqual(["src/lib/auth/tenant-view.ts"]);
    const ask = /export async function dbHonorsTenantView[\s\S]*?\n}\n/.exec(read("src/lib/auth/tenant-view.ts"))?.[0] ?? "";
    expect(ask).toContain('fetch(`${SUPABASE_URL}/rest/v1/rpc/auth_tenant_id`, {');
    expect(ask).toContain('method: "GET",');
  });

  it("🔴 응답 뒤에 도는 일(`after`)은 서버 액션 · 라우트 쪽 파일에서만 건다 — 화면을 그리다 걸면 그 안에서는 보기 판정이 서지 않는다", () => {
    // 화면(서버 컴포넌트)을 그리는 도중에 건 `after()` 콜백에서는 쿠키를 읽을 수 없어 판정이 늘 '아님'이 된다 —
    // 그 콜백의 쓰기 · 바깥 호출이 보기 중에도 나간다. 지금은 전부 서버 액션 · 라우트 핸들러 쪽 모듈이다.
    const users = SRC_FILES.filter((f) => /import \{[^}]*\bafter\b[^}]*\} from "next\/server"/.test(readFileSync(f, "utf8"))).map(rel);
    expect(users.length).toBeGreaterThan(10);
    for (const f of users) {
      const ok = /^src\/app\/.*\/route\.ts$/.test(f) || /^src\/features\/.*\/server\/[^/]+\.ts$/.test(f);
      expect(ok, f).toBe(true);
    }
  });

  it("🔴 사람 · 헤더 · 쓰기 차단 · 권한 캡이 전부 같은 판정(tenantViewState)을 읽는다", () => {
    expect(read("src/lib/auth/current-user.ts")).toContain("const tv = await tenantViewState();");
    const server = read("src/lib/supabase/server.ts");
    expect(server).toContain("const tv = await tenantViewState();");
    expect(server).toContain("[TENANT_VIEW_HEADER]: tv.view.token");
    // 보기 쿠키가 남아 있는데 보기가 아닌 요청(끝났다 · 확인하지 못했다)은 헤더 없이 쓰기만 막는다.
    expect(server).toMatch(/tv\.state !== "none"\s*\? \{ global: \{ fetch: guardTenantViewFetch\(\(\) => true\) \} \}/);
    const admin = read("src/lib/supabase/admin.ts");
    expect(/export function createAdminClient\(\)[\s\S]*?\n}/.exec(admin)?.[0] ?? "").toContain("guardTenantViewFetch(isViewingTenant)");
    expect(admin).toContain("return await isTenantViewWriteBlocked();");
    // 가드 없는 판은 가드를 달지 않는다(달면 보기 기록을 닫지 못한다).
    expect(/export function createRawAdminClient\(\)[\s\S]*?\n}/.exec(admin)?.[0] ?? "x guardTenantViewFetch").not.toContain("guardTenantViewFetch");
  });

  it("판정 모듈은 요청마다 하나뿐인 쿠키 저장소에 결과를 매단다(서버 액션 · 라우트에서도 한 번만 계산)", () => {
    const tv = read("src/lib/auth/tenant-view.ts");
    expect(tv).toContain("const memo = new WeakMap<object, Promise<TenantViewState>>();");
    expect(tv).not.toMatch(/from "react"/); // React cache()에 기대지 않는다
    // 주인 확인이 DB 조회보다 먼저다(다른 계정 · 비로그인 요청은 조회 0).
    expect(tv.indexOf("session.userId !== ownerId")).toBeLessThan(tv.indexOf('.from("operator_tenant_views")'));
    expect(tv.indexOf("session.userId !== ownerId")).toBeGreaterThan(0);
    // 🔴 '보는 중'이라고 답하기 전에 DB가 실제로 그 지점으로 답하는지 묻는다 — 분명히 아니면 끝난 보기다.
    expect(tv).toContain("(await dbHonorsTenantView(session.accessToken, cookie.token, tenant.data.id as string)) === false) return ended;");
  });

  it("🔴 내 보기 쿠키가 남아 있는데 보기가 아니면 평소 요청(`none`)이 아니라 끝난 보기(`ended`)다", () => {
    // 그 브라우저에는 '읽기 전용 보기' 띠를 단 탭이 남아 있을 수 있다. `none`으로 받으면 띠 아래에서 본인 지점에 저장이 된다.
    const resolve = /async function resolveState[\s\S]*?\n}\n/.exec(read("src/lib/auth/tenant-view.ts"))?.[0] ?? "";
    // 기록을 찾은 뒤에 `none`으로 답하는 곳은 둘뿐이다: 표가 없다(SQL 적용 전) · **그런 기록이 없다/주인이 다르다**(우리가 내 준 쿠키가 아니다).
    const afterLookup = resolve.slice(resolve.indexOf('.from("operator_tenant_views")'));
    expect(afterLookup.split("NONE").length - 1).toBe(2);
    expect(afterLookup).toContain("return isMissingRelation(error) ? NONE : UNKNOWN;");
    expect(afterLookup).toContain("if (!row || row.operator_id !== cookie.operatorId) return NONE;");
    // 그 줄이 '끝난 보기' 판정들보다 앞이다 — 근거(실제 기록)가 있어야 끝난 보기다.
    expect(afterLookup.indexOf("if (!row || row.operator_id !== cookie.operatorId) return NONE;")).toBeLessThan(afterLookup.indexOf("return ended;"));
    expect(afterLookup).toContain('const ended: TenantViewState = { state: "ended", tenantId: row.tenant_id as string };');
    expect(afterLookup.split("return ended;").length - 1).toBe(4);
    // 표식 쿠키만 남은 브라우저는 운영자일 때만 끝난 보기다(표식은 누구나 쓸 수 있는 쿠키다).
    const markOnly = resolve.slice(resolve.indexOf("if (!cookie) {"), resolve.indexOf('.from("operator_tenant_views")'));
    expect(markOnly).toContain('.from("super_admins").select("id").eq("id", ownerId).maybeSingle();');
    expect(markOnly).toContain("return data ? ENDED : NONE;");
    // 쓰기 차단은 `none`만 아니면 전부다.
    expect(read("src/lib/auth/tenant-view.ts")).toMatch(/export async function isTenantViewWriteBlocked\(\)[^}]*state !== "none";/);
  });

  it("🔴 끝난 보기 · 확인하지 못한 요청에는 본인으로 답하지 않는다 — 화면은 끝내기/안내로 보내고, 그 밖은 로그인하지 않은 것으로", () => {
    const me = read("src/lib/auth/current-user.ts");
    expect(me).toMatch(/if \(tv\.state === "ended" \|\| tv\.state === "unknown"\) \{\s+if \(await isTenantViewScreenRequest\(\)\) redirect\(tv\.state === "ended" \? tenantViewEndedExitHref\(tv\.tenantId\) : TENANT_VIEW_UNCONFIRMED_PATH\);\s+return null;\s+\}/);
    // 그 줄이 사람을 정하는 줄(보는 지점 · 본인 지점)보다 앞이다.
    expect(me.indexOf("isTenantViewScreenRequest())")).toBeLessThan(me.indexOf('const view = tv.state === "live" ? tv.view : null;'));
    // 권한 매트릭스의 폴백이 그 이동 신호를 삼키지 않는다(삼키면 권한만 묻고 데이터를 읽는 화면이 본인 지점으로 그려진다).
    const perm = read("src/lib/auth/perm-matrix.ts");
    // 폴백 자리 셋 = 지점 매트릭스 · 개인 예외 · 지점에서 닫힌 메뉴(`tenantClosedMenus`, 2026-10-14 탭 및 메뉴 구성) — 셋 다 이동 신호는 다시 던진다.
    expect(perm.split("unstable_rethrow(e)").length - 1).toBe(3);
    // 셸은 사람을 못 읽었을 때 로그인 화면으로 보내기 전에 끝난 보기인지 본다(서버 액션 뒤의 재렌더는 화면 요청이 아니다).
    expect(read("src/app/(shell)/layout.tsx")).toContain('if (!user) redirect((await tenantViewSignedOutRedirect()) ?? "/login");');
    // 안내 화면은 로그인한 사람도 DB도 읽지 않는다(읽으면 같은 판정을 다시 지나 되돌아온다).
    const notice = read("src/app/tenant-view/unconfirmed/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(notice).not.toMatch(/getCurrentUser|createClient|createAdminClient|tenantViewState|cookies\(|headers\(/);
    expect(notice).not.toContain("<Link");
    expect(read("src/lib/auth/tenant-view.ts")).toContain('return Boolean(h.get("x-pathname")) && !h.get("next-action");');
    // 맞추기 주소: 보는 중이 아니면(없음 · 끝남) 쿠키를 지운다. 보는 화면이었으면 운영 콘솔로 돌려보낸다.
    const sync = read("src/app/tenant-view/sync/route.ts");
    expect(sync).toMatch(/if \(state === "live"\) redirect\("\/home"\);\s+if \(state === "unknown"\) redirect\(next\);\s+const tenantId = await closeTenantView\(\);/);
    expect(sync).toContain('if (fromView) redirect(tenantId ? `/super-admin/tenants/${tenantId}` : "/super-admin/tenants");');
  });
});

describe("지점 보기 — 화면과 권한", () => {
  it("권한 매트릭스와 쓰기 게이트가 보기 중에는 읽기 전용으로 눌린다", () => {
    const perm = read("src/lib/auth/perm-matrix.ts");
    expect(perm).toContain('(await isTenantViewRequest()) ? capTenantViewReadonly(matrix, "master") : matrix');
    const canWriteBody = /export async function canWriteTenant[\s\S]*?\n}/.exec(perm)?.[0] ?? "";
    expect(canWriteBody).toContain("if (await isTenantViewWriteBlocked()) return false;");
    const levelBody = /export async function accessLevelTenant[\s\S]*?\n}/.exec(perm)?.[0] ?? "";
    expect(levelBody).toContain('(await isTenantViewWriteBlocked())) return "readonly"');
  });

  it("보기 중에는 운영 계정만 통과하는 문을 열지 않는다(그 지점 원장과 같은 화면)", () => {
    const sa = /export const isSignedInSuperAdmin[\s\S]*?\n}\);/.exec(read("src/lib/auth/super-admin.ts"))?.[0] ?? "";
    expect(sa).toContain("if (user.tenantView) return false;");
  });

  it("발송 · 강사 귀속 쓰기의 공용 문(readonlyTeacherViewError)이 지점 보기도 거절한다", () => {
    const fn = /export async function readonlyTeacherViewError[\s\S]*?\n}/.exec(read("src/lib/auth/view-as.ts"))?.[0] ?? "";
    expect(fn).toContain("await tenantViewWriteError()");
  });

  it("셸 세 갈래(창 · 강사 화면 · 전체 화면) 모두: 편집 표시를 보내지 않고, 화면 감시를 싣는다", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    expect(layout.split('trackDisabled={viewAs?.access === "readonly" || !!user.tenantView}').length - 1).toBe(3);
    expect(layout).not.toContain('trackDisabled={viewAs?.access === "readonly"}');
    expect(layout.split("{tenantViewSync}").length - 1).toBe(3);
    expect(layout.split("<TenantViewBanner tenantName={user.tenantView.tenantName} />").length - 1).toBe(2);
    // 감시는 보는 중이거나 보기를 열 수 있는 사람의 화면에만 놓인다.
    expect(layout).toContain("const tenantViewSync = user.tenantView || canOpenTenantView");
    // 🔴 그 판정은 설정 조회와 **나란히** 묻는다 — 따로 먼저 기다리면 모든 사용자의 창 첫 페인트 앞에 조회 하나가 줄을 선다(B4).
    expect(layout).toMatch(/const \[settings, showMakeupSettings, showEvaluationSettings, canOpenTenantView, laboratoryMenus\] = await Promise\.all\(\[\s+getTenantSettings\(\),\s+isLaboratoryMenuAvailable\(user\.tenantId, "makeups"\),[\s\S]*?isLaboratoryMenuAvailable\(user\.tenantId, "class_review"\),\s+user\.tenantView \? false : isSignedInSuperAdmin\(\),\s+getLaboratoryMenus\(\),\s+\]\);/);
    expect(layout).not.toContain("(await isCurrentUserSuperAdmin())\n    ? <TenantViewSync");
  });

  it("🔴 보기는 원장 화면 하나다 — 그 안에서 강사뷰 · 다른 강사 뷰로 갈아타지 않는다(닫아 둔 메뉴가 다시 열리지 않게)", () => {
    const viewAs = read("src/lib/auth/view-as.ts");
    const access = /export const otherTeacherViewAccess[\s\S]*?\n}\);/.exec(viewAs)?.[0] ?? "";
    expect(access).toContain('if (user.tenantView) return "none";');
    expect(access.indexOf('if (user.tenantView) return "none";')).toBeLessThan(access.indexOf("isSignedInSuperAdmin()"));
    // 매 요청 판정의 실체는 resolveViewAs(viewAsTeacher는 그 대상만 돌려준다 — 대상 확인 실패를 따로 들고 있어서, 2026-11-05).
    expect(viewAs).toContain("export const viewAsTeacher = cache(async (): Promise<ViewAsTeacher | null> => (await resolveViewAs()).target);");
    const target = /const resolveViewAs[\s\S]*?\n}\);/.exec(viewAs)?.[0] ?? "";
    expect(target).toContain("if (user.tenantView) return none;");
    expect(target.indexOf("if (user.tenantView) return none;")).toBeLessThan(target.indexOf("await cookies()"));
    const mode = read("src/lib/auth/view-mode.ts");
    const scope = /export const effectiveTeacherId[\s\S]*?\n}\);/.exec(mode)?.[0] ?? "";
    expect(scope).toContain("if (user.tenantView) return null;");
    expect(scope.indexOf("if (user.tenantView) return null;")).toBeLessThan(scope.indexOf("VIEW_MODE_COOKIE"));
    expect(/export const canUseTeacherView[\s\S]*?\n}\);/.exec(mode)?.[0] ?? "").toContain("if (user.tenantView) return false;");
  });

  it("보기는 단일 화면으로 열고, 저장된 창 배치를 건드리지 않는다", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    expect(layout).toContain("forceSingle: !!user.tenantView })");
    // 판(epoch)은 비운다 — 화면 방식 쿠키를 적지 않고 저장된 창 배치를 초기화하지 않는다.
    expect(read("src/lib/license/shell-mode.ts")).toContain('if (env.forceSingle) return { mode: "single", epoch: null };');
    expect(layout).toContain("{user.tenantView ? null : <WorkspaceCanvas owner={`${user.tenantId}:${user.id}`} homeHref={shellHome} />}");
  });

  it("보기를 열 때: 기록을 만들고 → DB가 받아 주는지 확인한 뒤에야 → 쿠키를 쓴다", () => {
    const action = read("src/features/super-admin/server/tenant-view-actions.ts");
    const at = (t: string) => action.indexOf(t);
    expect(at("await createTenantViewRow(")).toBeGreaterThan(0);
    expect(at("await dbHonorsTenantView(")).toBeGreaterThan(at("await createTenantViewRow("));
    expect(at("await endTenantViewRow(")).toBeGreaterThan(at("await dbHonorsTenantView("));
    expect(at("await setTenantViewCookies(")).toBeGreaterThan(at("await endTenantViewRow("));
    expect(at("await requireSuperAdmin()")).toBeLessThan(at("await createTenantViewRow("));
  });

  it("🔴 여는 데 실패하면 이 브라우저의 앞선 보기는 그대로다 — 앞선 기록은 쿠키를 쓰는 순간에만, 이 브라우저 것만 닫는다", () => {
    const session = read("src/lib/auth/tenant-view-session.ts");
    const create = /export async function createTenantViewRow[\s\S]*?\n}\n/.exec(session)?.[0] ?? "";
    // 기록을 만들 때는 아무것도 닫지 않는다(같은 사람이 다른 브라우저에서 열어 둔 보기를 끝내지 않는다).
    expect(create).toContain(".insert({ operator_id: operatorId, tenant_id: tenantId, expires_at: expiresAt })");
    expect(create).not.toContain("ended_at");
    const set = /export async function setTenantViewCookies[\s\S]*?\n}\n/.exec(session)?.[0] ?? "";
    expect(set).toContain("if (previous && previous.token !== view.token) await endTenantViewRow(previous.token, previous.operatorId);");
    expect(set.indexOf("await endTenantViewRow(")).toBeLessThan(set.indexOf("jar.set(TENANT_VIEW_COOKIE"));
    // 쿠키 둘의 수명은 같고, 보기 기록의 수명과 같다(더 짧으면 서버가 끝난 보기를 알아보지 못한다).
    expect(set).toContain("const maxAge = TENANT_VIEW_TTL_MINUTES * 60;");
    expect(set.split("maxAge }").length - 1).toBe(2);
  });

  it("🔴 들어간 기록(운영 감사 로그)을 남긴 뒤에야 쿠키를 쓴다 — 못 남기면 방금 만든 기록을 닫고 열지 않는다", () => {
    const action = read("src/features/super-admin/server/tenant-view-actions.ts");
    const at = (t: string) => action.indexOf(t);
    expect(at("const logged = await recordSuperAdminAction({")).toBeGreaterThan(at("await dbHonorsTenantView("));
    expect(at("await setTenantViewCookies(")).toBeGreaterThan(at("if (!logged) {"));
    expect(action).toMatch(/if \(!logged\) \{\s+await endTenantViewRow\(opened\.token, sa\.id\);\s+return \{ ok: false \};\s+\}/);
    // 기록 함수는 남겼는지를 돌려준다(조용히 삼키지 않는다).
    const record = /export async function recordSuperAdminAction[\s\S]*?\n}\n/.exec(read("src/features/super-admin/server/audit.ts"))?.[0] ?? "";
    expect(record).toContain("return !error;");
    expect(record).toContain("return false;");
  });

  it("🔴 저절로 끝난 줄 알고 온 끝내기 요청은 한 번 더 확인하고 닫는다 — 그사이 새로 연 보기를 끝내지 않는다", () => {
    const exit = read("src/app/tenant-view/exit/route.ts");
    const code = exit.replace(/\/\*[\s\S]*?\*\//g, "");
    // 사람이 누른 끝내기(`why` 없음)는 판정을 부르지 않고 닫는다.
    expect(code.indexOf("if (ended) {")).toBeLessThan(code.indexOf("await tenantViewState()"));
    expect(code.indexOf("await tenantViewState()")).toBeLessThan(code.indexOf("await closeTenantView()"));
    expect(code).toContain('if (tabWouldAgree) redirect("/home");');
    // 화면 감시와 같은 기준으로 견준다(표식이 없거나 끝나 가면 닫는다 — 보내 봐야 다시 온다).
    expect(code).toContain("expectedTenantFromMark(mark, tv.view.operatorId, Date.now() + 2 * TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS) === tv.view.tenantId");
    expect(read("src/components/tenant-view-sync.tsx")).toContain("Date.now() + clockOffset + TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS);");
  });

  it("🔴 여는 것은 문서 이동이다 — 서버 액션은 결과만 돌려주고, 버튼이 주소를 옮긴다", () => {
    const action = read("src/features/super-admin/server/tenant-view-actions.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(action).not.toContain("redirect(");
    expect(action).toContain("return { ok: true };");
    const button = read("src/app/(super-admin)/super-admin/tenants/[id]/_open-view-button.tsx");
    expect(button).toContain('window.location.assign(ok ? "/home" : `/super-admin/tenants/${tenantId}?view=unavailable`);');
    expect(button).not.toContain("<form");
    // 한 화면의 두 버튼이 '여는 중'을 함께 안다.
    expect(button).toContain("if (pending || opening) return;");
  });

  it("로그아웃 · 새 로그인 때 남은 보기를 닫는다", () => {
    expect(read("src/app/(auth)/login/actions.ts")).toContain("if (await hasTenantViewCookie()) await closeTenantView();");
    expect(read("src/app/home/route.ts")).toMatch(/get\("login"\) === "1" && \(await hasTenantViewCookie\(\)\)\) \{\s+await closeTenantView\(\);/);
  });

  it("일반 지점 화면에 서는 문구에 내부 역할 이름이 없다", () => {
    const texts = [read("src/components/tenant-view-banner.tsx"), read("src/components/tenant-view-sync.tsx"), read("src/lib/auth/tenant-view-shared.ts"), read("src/app/tenant-view/unconfirmed/page.tsx")].join("\n");
    const visible = texts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(visible).not.toMatch(/슈퍼관리자|슈퍼어드민|super_admin|총괄/);
  });
});

describe("지점 보기 — Supabase를 거치지 않는 일(바깥으로 나가는 호출 · DB 직접 접속)", () => {
  // 데이터 접근 층의 쓰기 차단은 Supabase로 가는 요청만 본다. 아래 진입점들은 그 밖으로 나가므로 따로 문을 지난다.
  // 함수 하나의 본문(이름부터, 줄 맨 앞에 홀로 선 닫는 중괄호까지 — 여러 줄 인자 타입의 `}):`에서 멈추지 않는다).
  const body = (file: string, fn: string) => new RegExp(`function ${fn}\\([\\s\\S]*?\\n}\\n`).exec(`${read(file)}\n`)?.[0] ?? "";

  it("🔴 바깥으로 나가는 단일 진입점은 전부 보기 중에 멈춘다", () => {
    const OUTBOUND: [string, string][] = [
      ["src/lib/ai/generate.ts", "requireAiLicense"], // 모든 AI 호출(generateJSON 두 갈래가 함께 지난다)
      ["src/lib/ai/assemblyai.ts", "submitTranscript"], // 전사 요청
      ["src/lib/messaging/solapi.ts", "sendAlimtalk"], // 알림톡
      ["src/features/ijw/server/profile-push.ts", "pushIjwProfiles"], // 외부 학습 앱에 학생 정보 보내기
      ["src/features/integrations/google-sheets.ts", "overwriteTimetableSheet"],
      ["src/features/integrations/google-sheets.ts", "applySheetFormulas"],
      ["src/features/integrations/google-sheets.ts", "updateSheetRow"],
      ["src/lib/notion/client.ts", "createComment"],
      ["src/lib/notion/client.ts", "updatePageProps"],
      ["src/lib/notion/client.ts", "createPage"],
    ];
    for (const [file, fn] of OUTBOUND) expect(body(file, fn), `${file} · ${fn}`).toContain("await assertTenantViewOutboundAllowed();");
    // 던지지 않는 진입점은 조용히 건너뛴다.
    expect(body("src/features/withdrawals/server/withdrawal-sheet.ts", "recordMathWithdrawalToSheet")).toContain("if (await tenantViewOutboundError()) return;");
  });

  it("AI 호출의 두 갈래(문장 생성 · 선택지 판정)가 모두 그 문을 지난다", () => {
    const src = read("src/lib/ai/generate.ts");
    expect(src.split("await requireAiLicense(").length - 1).toBe(2);
  });

  it("🔴 읽기 문만 지나거나 역할만 보던 진입점은 보기를 따로 거절한다", () => {
    // 노션 댓글 — 직원관리를 볼 수 있으면 남길 수 있는 액션이라 읽기 문(requireReader)을 지난다.
    expect(body("src/features/staff/notion/server/notion-actions.ts", "addTaskCommentAction")).toContain("await tenantViewWriteError()");
    // 데모 재원 구성 바꾸기 — 역할만 보고, DB에 직접 접속해 쓴다.
    const demo = body("src/features/demo-roster/server/actions.ts", "switchDemoRoster");
    expect(demo.indexOf("await tenantViewWriteError()")).toBeGreaterThan(0);
    expect(demo.indexOf("await tenantViewWriteError()")).toBeLessThan(demo.indexOf("await replaceDemoRoster("));
    expect(body("src/features/demo-roster/server/queries.ts", "getDemoRosterControl")).toContain("if (user.tenantView) return null;");
    // 슬랙 본인 연결 — 저장보다 먼저 슬랙에 조회를 내보낸다.
    const slack = body("src/features/slack/server/gate.ts", "slackSelfGate");
    expect(slack.indexOf("await tenantViewWriteError()")).toBeGreaterThan(0);
    expect(slack.indexOf("await tenantViewWriteError()")).toBeLessThan(slack.indexOf("loadConnection("));
    // 연결 앱 — 다른 앱에 로그인시키는 입구.
    expect(read("src/features/connected-apps/server/visible.ts")).toContain("if (user.tenantView) return [];");
    // 벨 — 받는 사람으로 걸러지는 표라 본인 지점 알림이 섞인다. 끝난 보기의 탭(띠가 남아 있을 수 있다)에도 비운다.
    // 받은함 단일 소스(inbox.ts)가 보기를 거르고, 목록 · 쓰기 액션은 그 받은함이 없으면 비운다(강사뷰 받은함 — 2026-11-05).
    expect(read("src/features/notifications/server/inbox.ts")).toContain("if (user.tenantView || (await isTenantViewWriteBlocked())) return null;");
    expect(body("src/features/notifications/server/queries.ts", "getMyNotifications")).toContain("const inbox = await notificationInbox();\n  if (!inbox) return { unread: 0, items: [] };");
    expect(read("src/app/api/usage/route.ts")).toContain("if (user.tenantView || (await isTenantViewWriteBlocked())) return empty(204);");
  });

  it("🔴 남의 접속 함수를 빌려 DB에 직접 쓰는 액션도 보기를 따로 거절한다(권한 문 하나에만 기대지 않는다)", () => {
    // `from "postgres"`를 직접 적지 않아 아래 목록 검사에 걸리지 않는 곳들이다(openMasterDb · agentDb를 빌려 쓴다).
    const borrowers = SRC_FILES.filter((f) => /\b(openMasterDb|agentDb)\b/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(borrowers).toEqual([
      "src/app/api/cron/apply-timetable-lab/route.ts", // cron
      "src/app/api/sync-agent/latest/route.ts", // 연동 PC(기기 토큰) — 읽기
      "src/features/sync-agent/server/actions.ts", // 관리 액션 — 전부 requireManager 뒤
      "src/features/sync-agent/server/availability.ts", // 읽기
      "src/features/sync-agent/server/control.ts", // 연동 PC(기기 토큰)
      "src/features/sync-agent/server/db.ts", // agentDb 정의
      "src/features/sync-agent/server/gateway.ts", // 연동 PC(기기 토큰)
      "src/features/sync-agent/server/lifecycle.ts", // 연동 PC(기기 토큰)
      "src/features/sync-agent/server/operation-failure.ts", // 연동 PC(기기 토큰)
      "src/features/sync-agent/server/security.ts", // requireManager(아래) · 기기 인증
      "src/features/timetable-lab/server/apply-actions.ts", // 연습본 적용 — 아래
      "src/features/timetable-lab/server/apply-context.ts", // 읽기
      "src/features/timetable-lab/server/apply-store.ts", // 적용 실행 — apply-actions와 cron만 부른다
      "src/features/timetable/server/master-sheet-actions.ts", // 미리보기(읽기) · applyMasterTransaction(위 목록의 문)을 부른다
      "src/features/timetable/server/master-sheet-store.ts", // openMasterDb 정의
      "src/features/timetable/server/scheduled-import-actions.ts", // cancelMasterDate(위 목록의 문)를 부른다
    ]);
    const manager = body("src/features/sync-agent/server/security.ts", "requireManager");
    expect(manager).toContain("if (await tenantViewWriteError()) throw new AgentError(403,");
    const actions = read("src/features/sync-agent/server/actions.ts");
    // 연동 PC 관리 액션은 전부 그 문을 먼저 지난다(내보내는 액션 수 = 문을 부르는 횟수).
    const exported = actions.match(/^export async function \w+/gm)?.length ?? 0;
    expect(exported).toBeGreaterThan(3);
    expect(actions.match(/await requireManager\(\)/g)?.length ?? 0).toBe(exported);
    const lab = read("src/features/timetable-lab/server/apply-actions.ts");
    const prepare = /async function prepare\([\s\S]*?\n}\n/.exec(lab)?.[0] ?? "";
    expect(prepare.indexOf("await tenantViewWriteError()")).toBeGreaterThan(0);
    expect(prepare.indexOf("await tenantViewWriteError()")).toBeLessThan(prepare.indexOf("openMasterDb()"));
    const cancel = /export async function cancelTimetableLabApplyJob[\s\S]*?\n}\n/.exec(lab)?.[0] ?? "";
    expect(cancel.indexOf("await tenantViewWriteError()")).toBeGreaterThan(0);
    expect(cancel.indexOf("await tenantViewWriteError()")).toBeLessThan(cancel.indexOf("openMasterDb()"));
    // 예약 넣기는 prepare를 지난다.
    expect(/export async function queueTimetableLabApply[\s\S]*?\n}\n/.exec(lab)?.[0] ?? "").toContain("await prepare(input)");
  });

  it("보기 중의 기록 대상 동작(내려받기 등)은 지점 감사 로그가 아니라 운영 감사 로그에 남는다", () => {
    const log = body("src/features/audit/server/log.ts", "logAction");
    expect(log.indexOf("if (user.tenantView) {")).toBeGreaterThan(0);
    expect(log.indexOf("await logTenantViewActivity(")).toBeLessThan(log.indexOf('.from("audit_logs")'));
    expect(body("src/features/super-admin/server/audit.ts", "logTenantViewActivity")).toContain("createRawAdminClient()");
  });

  it("🔴 DB에 직접 접속하는 모듈은 잠긴 목록과 같다 — 새로 생기면 보기 중 쓰기를 어떻게 막는지 정하고 여기에 더한다", () => {
    // 이 모듈들은 Supabase 요청을 보는 쓰기 차단(tenant-view-guard.ts)을 지나지 않는다. 쓰기는 아래 둘 중 하나로 막혀 있어야 한다:
    //   ① 저장 함수가 `assertTenantViewOutboundAllowed()`를 먼저 부른다(아래 검사)  ② 사용자 요청에서 불리지 않는다(cron · 연동 PC 전용).
    const direct = SRC_FILES.filter((f) => /from "(@\/lib\/db(\/[a-z-]+)?|postgres|pg|drizzle-orm\/postgres-js)"/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(direct).toEqual([
      "src/features/assistant/server/executor.ts", // ③ 쓰지 않는다 — 학원 비서 전용 읽기 역할(쓰기 함수 0 · 읽기 전용 거래) · 지점 보기 중엔 문(gate.ts)이 막는다(아래)
      "src/features/classes/server/class-period-names.ts", // ② cron(끝난 반 이름 정리)
      "src/features/classes/server/class-term-store.ts", // ① endClassWithName · reopenClassWithSchedules
      "src/features/demo-history/math-refresh.ts", // ② cron(데모 지점 새로 고침)
      "src/features/demo-roster/apply.ts", // ① replaceDemoRoster
      "src/features/demo-roster/dashboard-apply.ts", // ↑ 그 트랜잭션 안에서만
      "src/features/demo-roster/dashboard-rows.ts", // ↑ 그 트랜잭션 안에서만
      "src/features/demo-roster/demo-staff.ts", // ↑ 그 트랜잭션 안에서만
      "src/features/students/server/english-name-store.ts", // ① saveEnglishName
      "src/features/sync-agent/server/connection.ts", // 연동 PC 관리 — 쓰기 액션은 전부 canWriteTenant 문 뒤(보기 중 자동 거절)
      "src/features/timetable/server/master-sheet-attendance.ts", // ↓ 그 트랜잭션 안에서만
      "src/features/timetable/server/master-sheet-store.ts", // ① applyMasterTransaction · cancelMasterDate
      "src/features/timetable/server/master-sheet-test-fixture.ts", // 시험용 가짜 DB
      "src/lib/db/index.ts", // drizzle — 데모 재원 구성만 쓴다
    ]);
    const STORES: [string, string][] = [
      ["src/features/classes/server/class-term-store.ts", "endClassWithName"],
      ["src/features/classes/server/class-term-store.ts", "reopenClassWithSchedules"],
      ["src/features/students/server/english-name-store.ts", "saveEnglishName"],
      ["src/features/timetable/server/master-sheet-store.ts", "applyMasterTransaction"],
      ["src/features/timetable/server/master-sheet-store.ts", "cancelMasterDate"],
      ["src/features/demo-roster/apply.ts", "replaceDemoRoster"],
    ];
    for (const [file, fn] of STORES) expect(body(file, fn), `${file} · ${fn}`).toContain("await assertTenantViewOutboundAllowed();");
    // ③ 학원 비서 — 읽기 전용 거래로만 조회하고, 지점 보기 중에는 문이 먼저 거절한다(AI 호출도 requireAiLicense가 막는다).
    expect(read("src/features/assistant/server/executor.ts")).toContain('sql.begin("read only"');
    expect(body("src/features/assistant/server/gate.ts", "assistantViewer")).toContain("if (user.tenantView) return");
  });

  it("drizzle(`@/lib/db`)을 쓰는 곳은 데모 재원 구성뿐이다", () => {
    const users = SRC_FILES.filter((f) => /from "@\/lib\/db(\/[a-z-]+)?"/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !f.startsWith("src/lib/db/")).sort();
    for (const f of users) expect(f.startsWith("src/features/demo-roster/"), f).toBe(true);
  });
});

describe("지점 보기 — 순수 판정", () => {
  const TOKEN = "0b6e1c1e-3d0a-4c0e-9d0a-1f2e3d4c5b6a";
  const ME = "11111111-0000-4000-8000-000000000001";
  const TENANT = "bbbbbbbb-0000-4000-8000-000000000002";

  it("토큰 쿠키는 `<토큰>.<보는 사람>` 모양만 받는다", () => {
    expect(parseTenantViewCookie(tenantViewCookieValue(TOKEN, ME))).toEqual({ token: TOKEN, operatorId: ME });
    expect(parseTenantViewCookie(tenantViewCookieValue(TOKEN.toUpperCase(), ME.toUpperCase()))).toEqual({ token: TOKEN, operatorId: ME });
    for (const bad of ["", "teacher", TOKEN, `${TOKEN}.`, `.${ME}`, `${TOKEN}.${ME}.x`, `${TOKEN}.${ME}; x`, null, undefined]) {
      expect(parseTenantViewCookie(bad)).toBeNull();
    }
  });

  it("표식 쿠키: 본인 것이고 끝나기 1분 전까지만 '보고 있어야 할 지점'을 준다", () => {
    const now = 1_800_000_000_000;
    const mark = parseTenantViewMark(tenantViewMarkValue({ operatorId: ME, tenantId: TENANT, expiresAtSeconds: now / 1000 + 600 }));
    expect(mark).toEqual({ operatorId: ME, tenantId: TENANT, expiresAtSeconds: now / 1000 + 600 });
    expect(expectedTenantFromMark(mark, ME, now)).toBe(TENANT);
    expect(expectedTenantFromMark(mark, ME.toUpperCase(), now)).toBe(TENANT);
    expect(expectedTenantFromMark(mark, "22222222-0000-4000-8000-000000000002", now)).toBeNull(); // 남의 표식
    expect(expectedTenantFromMark(mark, ME, now + 541_000)).toBeNull(); // 끝나기 59초 전
    expect(expectedTenantFromMark(mark, ME, now + 539_000)).toBe(TENANT); // 끝나기 61초 전
    expect(expectedTenantFromMark(null, ME, now)).toBeNull();
    for (const bad of ["", "x", `${ME}.${TENANT}`, `${ME}.${TENANT}.soon`, `${ME}.${TENANT}.1.2`, null]) expect(parseTenantViewMark(bad)).toBeNull();
  });

  it("어긋난 탭이 갈 곳: 보기가 끝났으면 끝내기, 열렸거나 바뀌었으면 맞추기, 같으면 그대로", () => {
    expect(tenantViewResyncHref(null, null, "/students")).toBeNull();
    expect(tenantViewResyncHref(TENANT, TENANT, "/students")).toBeNull();
    // 보던 화면인데 표식이 없다 = 저절로 끝났다 → 끝내기(운영 콘솔이 안내를 띄운다).
    expect(tenantViewResyncHref(TENANT, null, "/students")).toBe(`/tenant-view/exit?why=ended&t=${TENANT}`);
    expect(tenantViewResyncHref(null, TENANT, "/students?tab=a b")).toBe("/tenant-view/sync?next=%2Fstudents%3Ftab%3Da%20b");
    // 보던 화면에서 다른 지점으로 바뀌었다 → 맞추기. 보던 화면이었다는 것을 함께 싣는다(보기가 아니었으면 운영 콘솔로 돌아간다).
    expect(tenantViewResyncHref(TENANT, ME, "/x")).toBe("/tenant-view/sync?next=%2Fx&from=view");
  });

  it("운영 콘솔 주소에서는 보기를 적용하지 않는다 — 비슷한 주소는 콘솔이 아니다", () => {
    for (const p of ["/admin", "/super-admin", "/super-admin/tenants", "/super-admin/tenants/abc/view"]) expect(isOperatorConsolePath(p)).toBe(true);
    // 🔴 `/admin/…`(감사 로그 · 데이터 정리)은 지점 화면이다 — 콘솔로 보면 그 화면의 쓰기 차단이 빠진다.
    for (const p of ["/", "/dashboard", "/admin/cleanup", "/admin/audit", "/admin/", "/super-administrator", "/owner", "/students/1", "", null, undefined]) {
      expect(isOperatorConsolePath(p)).toBe(false);
    }
  });
});
