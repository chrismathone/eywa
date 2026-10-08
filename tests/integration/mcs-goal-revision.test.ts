import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const connection = process.env.MCS_REVISION_TEST_DATABASE_URL;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rollback = new Error("rollback owned fixture");
describe.skipIf(!connection)("남은 계획 DB 제약·저장 경계", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/makeup_browser") throw new Error("Owned fixture required");
    db = postgres(connection!, { max: 1, onnotice: () => {} });
    expect((await db`select current_database() as name`)[0].name).toBe("makeup_browser");
  });
  afterAll(async () => { await db?.end({ timeout: 5 }); });
  async function run(work: (sql: postgres.TransactionSql) => Promise<void>) {
    try { await db.begin(async sql => { await work(sql); throw rollback; }); }
    catch (error) { if (error !== rollback) throw error; }
  }
  const revision = { effectiveDate: "2026-10-08", anchor: null, lockedStops: 0, pastDays: [] };
  const update = (sql: postgres.TransactionSql, value: object | null) => sql`update public.math_learning_track_goals
    set end_date='2026-11-18', block_count=10, plan_revision=${sql.json(value)}
    where tenant_id=${uid(11)} and class_id=${uid(51)} and student_id=${uid(9901)} and track='regular' and start_date='2026-10-01' returning student_id`;
  it("일반 로그인·비로그인은 직접 갱신할 수 없고 RLS를 유지한다", async () => {
    const [row] = await db`select has_table_privilege('anon','public.math_learning_track_goals','UPDATE') as anon,
      has_table_privilege('authenticated','public.math_learning_track_goals','UPDATE') as authenticated,
      has_table_privilege('service_role','public.math_learning_track_goals','UPDATE') as service,
      (select relrowsecurity from pg_class where oid='public.math_learning_track_goals'::regclass) as rls`;
    expect(row).toEqual({ anon: false, authenticated: false, service: true, rls: true });
  });
  it("서비스 역할은 명시적인 수정 계획으로 임의 완료일과 분량을 저장한다", async () => run(async sql => {
    await sql`set local role service_role`;
    expect(await update(sql, revision)).toHaveLength(1);
    expect((await sql`select block_count, end_date::text, plan_revision from math_learning_track_goals where student_id=${uid(9901)} and track='regular'`)[0])
      .toMatchObject({ block_count: 10, end_date: "2026-11-18", plan_revision: revision });
  }));
  it("수정 표시가 없는 자동 계획은 기존 월별 분량과 기간 제약을 유지한다", async () => run(async sql => {
    await sql`set local role service_role`;
    await expect(sql.savepoint(async save => update(save, null))).rejects.toMatchObject({ code: "23514" });
  }));
  it("빈 수정 정보와 잘못된 이전 계획 자료는 DB에서도 거절한다", async () => run(async sql => {
    await sql`set local role service_role`;
    await expect(sql.savepoint(async save => update(save, {}))).rejects.toMatchObject({ code: "23514" });
    await expect(sql.savepoint(async save => update(save, { ...revision, pastDays: "invalid" }))).rejects.toBeDefined();
  }));
  it("같은 버전으로 두 번 갱신하면 두 번째는 0행이며 다른 학생·실제 보고서는 보존한다", async () => run(async sql => {
    const [{ updated_at: version }] = await sql`select updated_at::text from math_learning_track_goals where student_id=${uid(9901)} and track='regular'`;
    const other = await sql`select row_to_json(goal) as value from math_learning_track_goals goal where student_id=${uid(9902)} and track='regular'`;
    const reports = await sql`select count(*)::int as n, md5(string_agg(row_to_json(report)::text,',' order by id)) as digest from lesson_reports report`;
    await sql`set local role service_role`;
    const write = () => sql`update math_learning_track_goals set end_date='2026-11-18', block_count=10, plan_revision=${sql.json(revision)}
      where tenant_id=${uid(11)} and class_id=${uid(51)} and student_id=${uid(9901)} and track='regular' and start_date='2026-10-01' and updated_at=${version}::timestamptz returning student_id`;
    expect(await write()).toHaveLength(1); expect(await write()).toHaveLength(0);
    expect(await sql`select row_to_json(goal) as value from math_learning_track_goals goal where student_id=${uid(9902)} and track='regular'`).toEqual(other);
    expect(await sql`select count(*)::int as n, md5(string_agg(row_to_json(report)::text,',' order by id)) as digest from lesson_reports report`).toEqual(reports);
  }));
});
