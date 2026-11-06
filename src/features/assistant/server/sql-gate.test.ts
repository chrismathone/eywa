// 학원 비서 SQL 검사(두 번째 겹) — 통과해야 할 조회와 막아야 할 시도.
import { describe, expect, it } from "vitest";
import { checkAssistantSql, wrapAssistantSql } from "./sql-gate";

const VIEWS = new Set(["students", "attendance_records", "classes", "payments", "enrollments"]);
const check = (sql: string) => checkAssistantSql(sql, VIEWS);

async function pass(sql: string) {
  const r = await check(sql);
  expect(r, sql).toMatchObject({ ok: true });
  return r;
}
async function reject(sql: string, reason?: RegExp) {
  const r = await check(sql);
  expect(r.ok, sql).toBe(false);
  if (reason && !r.ok) expect(r.reason).toMatch(reason);
}

describe("통과 — 원장 질문에 흔한 조회", () => {
  it("집계·조인·창·날짜·json·CASE", async () => {
    const r = await pass(`
      with m as (select date_trunc('month', created_at) as mon, count(*) as n from students group by 1)
      select to_char(m.mon, 'YYYY-MM') as 월, m.n, lag(m.n) over (order by m.mon) as 지난달,
             coalesce(nullif(m.n, 0), 1)::numeric, case when m.n > 10 then '많음' else '보통' end
        from m order by m.mon desc limit 12;`);
    expect(r).toMatchObject({ tables: ["students"] });
  });
  it("스키마를 붙인 assistant 보기 · 서브쿼리 · EXISTS · 날짜 계산", async () => {
    await pass(`select s.name, (select count(*) from assistant.attendance_records a where a.student_id = s.id and a.date >= current_date - interval '14 days')
                  from assistant.students s where exists (select 1 from enrollments e where e.student_id = s.id) and s.status = 'active'`);
  });
  it("EXTRACT · AT TIME ZONE · 백분위 · FILTER · jsonb 펼치기", async () => {
    await pass(`select extract(dow from p.paid_at at time zone 'Asia/Seoul') as 요일, percentile_cont(0.5) within group (order by p.amount),
                       count(*) filter (where p.amount > 0) from payments p, lateral jsonb_array_elements(p.items) it group by 1`);
  });
  it("날짜 generate_series(고정 범위 · 한 달 간격)로 빈 달 채우기", async () => {
    await pass(`select g.d::date, count(s.id) from generate_series('2026-01-01'::date, current_date, interval '1 month') g(d)
                  left join students s on date_trunc('month', s.created_at) = g.d group by 1 order by 1`);
  });
  it("끝 주석·세미콜론이 있어도 감싼 실행 SQL은 한 문장", async () => {
    const r = await pass("select count(*) from students -- 재원생\n;");
    expect(r.ok && wrapAssistantSql(r.sql, 501)).toBe("select * from (\nselect count(*) from students -- 재원생\n) as assistant_q limit 501");
  });
});

describe("거절 — 쓰기·여러 문장·설정", () => {
  it.each([
    "insert into students(name) values ('x')",
    "update students set name = 'x'",
    "delete from students",
    "select 1; select 2",
    "select 1; delete from students",
    "copy students to stdout",
    "explain select * from students",
    "show search_path",
    "set role postgres",
    "reset role",
    "begin",
    "do $$ begin perform 1; end $$",
    "call some_proc()",
    "lock table students",
    "notify x",
  ])("%s", async (sql) => reject(sql));
  it("데이터를 바꾸는 CTE", async () => reject("with d as (delete from students returning *) select * from d", /SELECT/));
  it("SELECT INTO", async () => reject("select * into t2 from students", /INTO/));
  it("FOR UPDATE", async () => reject("select * from students for update", /FOR UPDATE/));
  it("재귀 CTE", async () => reject("with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r", /재귀/));
});

describe("거절 — 지점 묶기·시스템 정보를 건드리는 함수와 표", () => {
  it.each([
    ["select set_config('assistant.nonce', 'x', true)", /set_config/],
    ["select current_setting('assistant.nonce')", /current_setting/],
    ["select pg_catalog.set_config('role', 'postgres', true)", /set_config/],
    ["select pg_sleep(10)", /pg_sleep/],
    ["select net.http_get('https://example.com')", /net\.http_get/],
    ["select dblink('x', 'select 1')", /dblink/],
    ["select pg_read_file('/etc/passwd')", /pg_read_file/],
    ["select repeat('x', 1000000000)", /repeat/],
    ["select lpad('x', 1000000000)", /lpad/],
    ["select format('%1000000000s', 'x')", /format/],
    ["select assistant_private.bound_tenant()", /assistant_private/],
  ])("%s", async (sql, reason) => reject(sql, reason));
  it.each([
    ["select query from pg_stat_activity", /시스템 표/],
    ["select * from pg_catalog.pg_stat_activity", /assistant 보기만/],
    ["select * from information_schema.tables", /assistant 보기만/],
    ["select * from public.students", /assistant 보기만/],
    ["select * from auth.users", /assistant 보기만/],
    ["select * from vault.decrypted_secrets", /assistant 보기만/],
    ["select * from assistant_private.bindings", /assistant 보기만/],
    ["select * from tenants", /없는 표/],
    ["with pg_stat_activity as (select 1) select * from pg_stat_activity", /pg_/],
    ["select * from (with x as (select 1) select * from x) a, pg_class", /시스템 표/],
  ])("%s", async (sql, reason) => reject(sql, reason));
  it("카탈로그 타입 형변환", async () => reject("select 'pg_authid'::regclass", /형변환/));
  it("스키마 붙인 연산자", async () => reject("select operator(public.+)(1, 2)", /연산자/));
  it("$1 자리표시", async () => reject("select * from students where id = $1"));
  it("TABLESAMPLE", async () => reject("select * from students tablesample system (1)"));
  it("current_user 같은 세션 값", async () => reject("select current_user", /current_date/));
});

describe("거절 — 운영 DB에 큰 부담", () => {
  it.each([
    "select count(*) from generate_series(1, 1000000000)",
    "select * from students s, generate_series(s.created_at, s.created_at + interval '100 years', interval '1 day')",
    "select * from generate_series('2000-01-01'::date, current_date, interval '1 second')",
    "select * from generate_series('2000-01-01'::date, current_date, (select interval '1 day'))",
  ])("%s", async (sql) => reject(sql, /generate_series/));
  it("너무 긴 SQL", async () => reject(`select ${"1 + ".repeat(3000)}1`, /너무 깁니다/));
  it("문법 오류는 이유를 돌려준다", async () => reject("select from where", /문법 오류/));
});
