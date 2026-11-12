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

describe("권한 범위(s2_0096) — 범위 밖 보기는 '없는 표'가 아니라 권한 안내 · 칸 이름을 모은다", () => {
  const denied = new Map([["invoices", "'수납관리' 권한이 있어야 볼 수 있는 자료입니다"]]);
  it("범위 밖 보기 = 필요한 권한만 알린다(0건으로 쓰지 말라고)", async () => {
    const r = await checkAssistantSql("select count(*) from invoices", VIEWS, denied);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/'수납관리' 권한이 있어야 볼 수 있는 자료입니다/);
      expect(r.reason).toMatch(/0건·없음으로 쓰지 말 것/);
    }
  });
  it("범위 밖 보기와 이름이 같은 CTE는 막는다(이름만으로는 CTE인지 보기인지 가를 수 없다 — 다른 이름을 쓰게)", async () => {
    const r = await checkAssistantSql("with invoices as (select 1 as n) select n from invoices", VIEWS, denied);
    expect(r.ok === false && r.reason).toMatch(/CTE 이름/);
  });
  it("모르는 표는 종전대로 '없는 표'", async () => {
    const r = await checkAssistantSql("select 1 from nothing_here", VIEWS, denied);
    expect(r.ok === false && r.reason).toMatch(/없는 표입니다/);
  });
  it("조회문에 나온 칸 이름(마지막 이름 · *)을 돌려준다", async () => {
    await expect(checkAssistantSql("select s.name, s.parent_phone, count(*) from students s group by 1, 2", VIEWS)).resolves.toMatchObject({ ok: true, columns: ["name", "parent_phone"] });
    await expect(checkAssistantSql("select * from students", VIEWS)).resolves.toMatchObject({ ok: true, columns: ["*"] });
  });
});

describe("권한 범위 — CTE 이름으로 범위 밖 보기를 지나가지 못한다(적대 리뷰 2026-11-12)", () => {
  const denied = new Map([["invoices", "'수납관리' 권한이 있어야 볼 수 있는 자료입니다"]]);
  it("CTE 본문 안의 같은 이름은 실제 보기 — 범위 밖이면 막는다", async () => {
    const r = await checkAssistantSql("with invoices as (select * from invoices) select count(*) from invoices", VIEWS, denied);
    expect(r.ok === false && r.reason).toMatch(/권한이 있어야 볼 수 있는 자료입니다.*CTE 이름/);
  });
  it("스키마를 붙인 이름은 CTE가 아니다 — 범위 밖 보기면 막고, 없는 보기면 '없는 표'", async () => {
    const r1 = await checkAssistantSql("with x as (select 1) select * from assistant.invoices", VIEWS, denied);
    expect(r1.ok === false && r1.reason).toMatch(/권한이 있어야/);
    const r2 = await checkAssistantSql("with nope as (select 1) select * from assistant.nope", VIEWS, denied);
    expect(r2.ok === false && r2.reason).toMatch(/없는 표입니다/);
  });
  it("볼 수 있는 보기와 이름이 같은 CTE도 읽은 표로 센다(저장 표지가 빠지지 않게)", async () => {
    await expect(checkAssistantSql("with students as (select * from students) select count(*) from students", VIEWS, denied)).resolves.toMatchObject({ ok: true, tables: ["students"] });
  });
});

describe("칸 이름 모으기 — 행 통째 참조·간접 참조·USING도 센다(재리뷰 2026-11-12)", () => {
  const cols = async (sql: string) => {
    const r = await checkAssistantSql(sql, VIEWS);
    if (!r.ok) throw new Error(r.reason);
    return r.columns;
  };
  it("row_to_json(별칭) · json_agg(표 이름) · to_jsonb(별칭)->>'칸' = '*'", async () => {
    expect(await cols("select row_to_json(e) from enrollments e")).toContain("*");
    expect(await cols("select json_agg(enrollments) from enrollments")).toContain("*");
    expect(await cols("select to_jsonb(a)->>'note' from attendance_records a")).toContain("*");
    // 서브쿼리·CTE·함수 별칭은 '*'로 부풀리지 않는다(그 안에서 고른 칸을 이미 셌다)
    expect(await cols("select row_to_json(x) from (select id from students) x")).not.toContain("*");
    expect(await cols("with m as (select name from students) select row_to_json(m) from m")).not.toContain("*");
    expect(await cols("select d::date from generate_series('2026-01-01'::date, '2026-01-31'::date, interval '1 day') d")).not.toContain("*");
    // JOIN 별칭 · 별칭 칸 목록은 '*'
    expect(await cols("select to_jsonb(j) from (students s join enrollments e on e.student_id = s.id) as j")).toContain("*");
    expect(await cols("select c3 from students s(c1, c2, c3)")).toContain("*");
  });
  it("(별칭).칸 · join … using (칸)", async () => {
    expect(await cols("select (s).name from students s")).toEqual(expect.arrayContaining(["name", "*"]));
    expect(await cols("select count(*) from enrollments join classes using (class_id)")).toContain("class_id");
  });
  it("칸 목록이 없을 때(대비책) 별칭.함수 꼴(u.to_jsonb · s.json_agg)은 막는다", async () => {
    for (const sql of ["select s.to_jsonb from students s", "select s.json_agg from students s", "select students.row_to_json from students"]) {
      const r = await checkAssistantSql(sql, VIEWS);
      expect(r.ok === false && r.reason, sql).toMatch(/없는 칸입니다/);
    }
  });
  it("보기 칸 목록이 있으면 '별칭.이름'이 진짜 칸인지 정확히 가른다(함수 이름 목록과 상관없이)", async () => {
    const vc = new Map([["students", new Set(["id", "name", "attendance_code"])], ["enrollments", new Set(["id", "student_id", "salary_tier"])]]);
    const run = (sql: string) => checkAssistantSql(sql, VIEWS, new Map(), vc);
    await expect(run("select s.name, s.attendance_code from students s")).resolves.toMatchObject({ ok: true });
    for (const sql of ["select s.json_agg from students s", "select s.concat from students s", "select assistant.students.to_jsonb from students", "select (s).any_value from students s", "select j.json_agg from (students s join enrollments e on e.student_id = s.id) j"]) {
      const r = await run(sql);
      expect(r.ok === false && r.reason, sql).toMatch(/없는 칸입니다/);
    }
    // 별칭을 붙인 보기의 원래 이름은 별칭이 아니다 — 같은 이름의 출력 칸을 '*'로 부풀리지 않는다
    await expect(run("select s.name, count(*) as students from students s group by 1 order by students desc")).resolves.toMatchObject({ ok: true, columns: ["name", "students"] });
    // CTE·서브쿼리 별칭의 칸은 따로 셌으니 가르지 않는다
    await expect(run("with m as (select name from students) select m.name from m")).resolves.toMatchObject({ ok: true });
  });
  it("같은 별칭을 CTE·UNION·서브쿼리마다 다른 대상에 써도 정상 조회는 통과한다(재리뷰 2026-11-12 오탐)", async () => {
    const vc = new Map([
      ["students", new Set(["id", "name"])],
      ["enrollments", new Set(["id", "student_id", "class_id"])],
      ["classes", new Set(["id", "class_name"])],
      ["attendance_records", new Set(["id", "student_id", "session_date"])],
      ["payments", new Set(["id", "amount"])],
    ]);
    const ok = [
      "with a as (select s.id, s.name from students s), b as (select s.student_id from enrollments s) select a.name from a join b on b.student_id = a.id",
      "select c.class_name from classes c union all select c.amount::text from payments c",
      "select t.cnt from (select count(*) as cnt from students t) t",
      "select e.n from (select e.class_id, count(*) n from enrollments e group by 1) e",
      "select d.d from generate_series('2026-01-01'::date, '2026-01-31'::date, interval '1 day') d where exists (select 1 from attendance_records d2 where d2.session_date = d.d::date)",
      "with enrollments as (select student_id, count(*) n from enrollments group by 1) select e.n from enrollments e",
      "select s.c3 from students s(c1, c2, c3)",
      "select t.max from (select max(id) as max from students) t",
    ];
    for (const sql of ok) await expect(checkAssistantSql(sql, VIEWS, new Map(), vc), sql).resolves.toMatchObject({ ok: true });
    // 섞인 별칭이어도 행을 받는 함수 이름은 막는다
    const r = await checkAssistantSql("select t.to_jsonb from (select id from students) t", VIEWS, new Map(), vc);
    expect(r.ok === false && r.reason).toMatch(/없는 칸입니다/);
    const r2 = await checkAssistantSql("select (s.*).json_agg from students s", VIEWS, new Map(), vc);
    expect(r2.ok === false && r2.reason).toMatch(/칸처럼 부르는 꼴/);
  });
  it("s.name은 진짜 칸이라 그대로 통과", async () => {
    await expect(checkAssistantSql("select s.name from students s", VIEWS)).resolves.toMatchObject({ ok: true, columns: ["name"] });
  });
  it("보통 칸 참조는 '*'로 부풀리지 않는다", async () => {
    expect(await cols("select s.name, count(*) from students s group by 1")).toEqual(["name"]);
  });
});
