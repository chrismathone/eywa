import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

// Never use DATABASE_URL: these destructive fault probes run only in the owned fixture.
const connection = process.env.MCS_RESET_TEST_DATABASE_URL;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rollback = new Error("rollback fixture verification");
describe.skipIf(!connection)("MCS 목표 초기화 RPC 실제 트랜잭션", () => {
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/makeup_browser") throw new Error("Owned loopback fixture required");
    db = postgres(connection!, { max: 1, onnotice: () => {} });
    expect((await db`select current_database() as name`)[0].name).toBe("makeup_browser");
  });
  afterAll(async () => { await db?.end({ timeout: 5 }); });
  async function run(work: (sql: postgres.TransactionSql) => Promise<void>) {
    try {
      await db.begin(async sql => {
        await sql`insert into public.math_learning_goals(tenant_id,class_id,student_id,study_grade,start_block,end_block,start_date,end_date)
          select tenant_id,class_id,student_id,study_grade,start_block,end_block,start_date,end_date
          from public.math_learning_track_goals where student_id=${uid(9901)} and class_id=${uid(51)} and track='regular' and start_date='2026-10-01'
          on conflict(tenant_id,class_id,student_id) do nothing`;
        await work(sql); throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }
  async function reset(sql: postgres.TransactionSql, track = "regular") {
    return (await sql`select public.reset_mcs_learning_goals(${uid(11)},${uid(51)},ARRAY[${uid(9901)}]::uuid[],${track},'2026-10-01',true) as removed`)[0].removed;
  }
  async function counts(sql: postgres.TransactionSql) {
    return (await sql`select
      (select count(*)::int from public.math_learning_track_goals where student_id=${uid(9901)} and class_id=${uid(51)} and track='regular' and start_date='2026-10-01') as standard,
      (select count(*)::int from public.math_learning_goals where student_id=${uid(9901)} and class_id=${uid(51)}) as legacy`)[0];
  }
  it("일반 로그인·비로그인 역할에는 실행 권한이 없고 함수는 invoker이다", async () => {
    const [row] = await db`select has_function_privilege('anon','public.reset_mcs_learning_goals(uuid,uuid,uuid[],text,date,boolean)','execute') as anon,
      has_function_privilege('authenticated','public.reset_mcs_learning_goals(uuid,uuid,uuid[],text,date,boolean)','execute') as authenticated,
      has_function_privilege('service_role','public.reset_mcs_learning_goals(uuid,uuid,uuid[],text,date,boolean)','execute') as service,
      (select prosecdef from pg_proc where oid='public.reset_mcs_learning_goals(uuid,uuid,uuid[],text,date,boolean)'::regprocedure) as definer`;
    expect(row).toEqual({ anon: false, authenticated: false, service: true, definer: false });
  });
  it("정규 초기화는 두 표를 함께 지우고 다른 학생은 보존한다", async () => run(async sql => {
    expect(await counts(sql)).toEqual({ standard: 1, legacy: 1 });
    const [{ n: other }] = await sql`select count(*)::int as n from public.math_learning_track_goals where student_id=${uid(9902)}`;
    await sql`set local role service_role`;
    expect(await reset(sql)).toBe(2);
    expect(await counts(sql)).toEqual({ standard: 0, legacy: 0 });
    expect((await sql`select count(*)::int as n from public.math_learning_track_goals where student_id=${uid(9902)}`)[0].n).toBe(other);
  }));
  it.each(["math_learning_track_goals", "math_learning_goals"])("%s 삭제 실패면 두 표 모두 원래 상태를 유지한다", async table => run(async sql => {
    await sql.unsafe(`create function pg_temp.mcs_reset_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic failure' using errcode='XX000'; end;$$`);
    await sql.unsafe(`create trigger audit_reset_failure before delete on public.${table} for each row execute function pg_temp.mcs_reset_failure()`);
    await sql`set local role service_role`;
    await expect(sql.savepoint(async save => reset(save))).rejects.toMatchObject({ code: "XX000" });
    expect(await counts(sql)).toEqual({ standard: 1, legacy: 1 });
  }));
  it("복습 심화 초기화는 정규 표준·옛 목표를 보존한다", async () => run(async sql => {
    await sql`insert into public.math_learning_track_goals(tenant_id,class_id,student_id,track,block_count,study_grade,start_block,end_block,start_date,end_date)
      select tenant_id,class_id,student_id,'supplement',4,study_grade,start_block,start_block,'2026-10-01','2026-10-31'
      from public.math_learning_track_goals where student_id=${uid(9901)} and class_id=${uid(51)} and track='regular' and start_date='2026-10-01'
      on conflict(tenant_id,class_id,student_id,track,start_date) do nothing`;
    await sql`set local role service_role`;
    expect(await reset(sql, "supplement")).toBe(1);
    expect(await counts(sql)).toEqual({ standard: 1, legacy: 1 });
  }));
  it("다른 시작월의 계획은 보존한다", async () => run(async sql => {
    await sql`insert into public.math_learning_track_goals(tenant_id,class_id,student_id,track,block_count,study_grade,start_block,end_block,start_date,end_date)
      select tenant_id,class_id,student_id,track,block_count,study_grade,start_block,end_block,'2026-11-01','2027-01-31'
      from public.math_learning_track_goals where student_id=${uid(9901)} and class_id=${uid(51)} and track='regular' and start_date='2026-10-01'
      on conflict(tenant_id,class_id,student_id,track,start_date) do nothing`;
    await sql`set local role service_role`; expect(await reset(sql)).toBe(2);
    expect((await sql`select count(*)::int as n from public.math_learning_track_goals where student_id=${uid(9901)} and start_date='2026-11-01'`)[0].n).toBe(1);
  }));
  it.each(["math_learning_track_goals", "math_learning_goals"])("호환 환경에서 %s가 없어도 남아 있는 목표만 초기화한다", async table => run(async sql => {
    await sql.unsafe(`alter table public.${table} rename to mcs_audit_goal_backup`);
    await sql`set local role service_role`;
    expect(await reset(sql)).toBe(1);
  }));
  it("지점과 반이 일치하지 않으면 삭제 전에 거절한다", async () => run(async sql => {
    await sql`set local role service_role`;
    await expect(sql.savepoint(async save => save`select public.reset_mcs_learning_goals(${uid(12)},${uid(51)},ARRAY[${uid(9901)}]::uuid[],'regular','2026-10-01',true)`)).rejects.toMatchObject({ code: "22023" });
    expect(await counts(sql)).toEqual({ standard: 1, legacy: 1 });
  }));
});
