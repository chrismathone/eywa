import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * ECS(English Class Sheet) DB 보안·계약 통합 테스트 (0157a) — `pnpm test:rls`로만 실행.
 *
 * ① deny-by-default: class_sheet_* 4테이블·ecs_* RPC는 authenticated에서 **권한 자체가 없어야** 한다
 *    (RLS 빈 정책의 0행이 아니라 permission denied — 브라우저 anon 키 REST 우회 차단, 계획 v2.2 §B).
 * ② RPC 계약: create 재번호·20행 상한, move 그룹 재배치, delete 재번호, copy(의미행 skip·placeholder
 *    재번호·스케줄 밖 unmapped·주간 goals fill-empty·월요일/7일 검증), mark_present_if_absent(비파괴 no-op).
 * ③ 동시성: 같은 슬롯 동시 create 2건이 advisory xact 락으로 직렬화되어 line_no 중복 없이 성공.
 *
 * ⚠️ DATABASE_URL은 소유자(postgres)로 붙어 grant를 우회한다 → deny 검증은 `set local role authenticated`.
 */

config({ path: ".env.local" });
const DB = process.env.DATABASE_URL;

describe.skipIf(!DB)("ECS class_sheet_* 보안·RPC 계약", () => {
  const sql = postgres(DB!, { prepare: false, max: 1 });
  const sql2 = postgres(DB!, { prepare: false, max: 1 }); // 동시성 테스트용 별도 커넥션
  const tag = randomUUID().slice(0, 8);
  const T = { tenant: "", user: randomUUID(), cls: "", student: "" };
  const FROM = "2026-07-20"; // 월요일
  const TO = "2026-07-27"; // 다음 월요일

  beforeAll(async () => {
    const [t] = await sql`insert into tenants (slug, name) values (${`ecs-${tag}`}, 'ECS Test') returning id`;
    T.tenant = t.id;
    await sql`insert into users (id, tenant_id, email, display_name) values (${T.user}, ${T.tenant}, ${`ecs-${tag}@rls.test`}, 'ECS Tester')`;
    const [c] =
      await sql`insert into classes (tenant_id, class_name, subject) values (${T.tenant}, ${`ECS-${tag}`}, 'english') returning id`;
    T.cls = c.id;
    const [s] =
      await sql`insert into students (tenant_id, name, status) values (${T.tenant}, ${`ECS-S-${tag}`}, 'enrolled') returning id`;
    T.student = s.id;
    // 대상 주 스케줄: 월 15:00 / 월 16:00만 존재(화 15:00은 unmapped 케이스)
    await sql`insert into class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
      values (${T.tenant}, ${T.cls}, 'mon', '15:00', '15:40', '2026-01-01'),
             (${T.tenant}, ${T.cls}, 'mon', '16:00', '16:40', '2026-01-01')`;
  });

  afterAll(async () => {
    if (T.tenant) {
      // recorded_by(restrict FK) 때문에 attendance부터 지우고 tenants cascade.
      await sql`delete from attendance_records where tenant_id = ${T.tenant}`;
      await sql`delete from tenants where id = ${T.tenant}`;
    }
    await sql.end();
    await sql2.end();
  });

  // ── ① deny-by-default ──────────────────────────────────────────────────────
  it("authenticated는 class_sheet_* 테이블 접근 자체가 거부된다(permission denied)", async () => {
    for (const table of [
      "class_sheet_plan_lines",
      "class_sheet_goals",
      "class_sheet_student_marks",
      "class_sheet_memos",
    ]) {
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe("set local role authenticated");
          await tx.unsafe(`select count(*) from ${table}`);
        }),
      ).rejects.toThrow(/permission denied/);
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe("set local role authenticated");
          await tx.unsafe(
            `insert into ${table} (tenant_id, class_id) values ('${T.tenant}', '${T.cls}')`,
          );
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("authenticated는 ecs_* RPC execute가 거부된다", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, '15:00', 'regular', 'vocab')`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select ecs_copy_week(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, ${TO})`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  // ── ② RPC 계약 ─────────────────────────────────────────────────────────────
  it("create: line_no 자동 1,2 부여 + skill_area 저장", async () => {
    await sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, '15:00', 'regular', 'vocab')`;
    await sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, '15:00', 'regular', 'grammar')`;
    const rows = await sql`select line_no, skill_area from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM} and slot_start = '15:00'
      order by line_no`;
    expect(rows.map((r) => [Number(r.line_no), r.skill_area])).toEqual([
      [1, "vocab"],
      [2, "grammar"],
    ]);
  });

  it("move: regular#1 → exam#1 이동 시 양쪽 그룹 재번호", async () => {
    const [line] = await sql`select id from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM}
        and slot_start = '15:00' and term_mode = 'regular' and line_no = 1`;
    await sql`select ecs_move_plan_line(${T.tenant}, ${T.user}, ${line.id}, 'exam', 1::smallint)`;
    const rows = await sql`select term_mode, line_no, skill_area from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM} and slot_start = '15:00'
      order by term_mode desc, line_no`; // regular 먼저
    expect(rows.map((r) => [r.term_mode, Number(r.line_no), r.skill_area])).toEqual([
      ["regular", 1, "grammar"], // 옛 #2가 당겨짐
      ["exam", 1, "vocab"],
    ]);
  });

  it("delete: 삭제 후 재번호", async () => {
    await sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, '15:00', 'regular', 'reading')`;
    const [first] = await sql`select id from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM}
        and slot_start = '15:00' and term_mode = 'regular' and line_no = 1`;
    await sql`select ecs_delete_plan_line(${T.tenant}, ${first.id})`;
    const rows = await sql`select line_no, skill_area from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM}
        and slot_start = '15:00' and term_mode = 'regular' order by line_no`;
    expect(rows.map((r) => [Number(r.line_no), r.skill_area])).toEqual([[1, "reading"]]);
  });

  it("동시 create 2건: 락 직렬화로 line_no 중복 없이 둘 다 성공", async () => {
    const SLOT_DATE = "2026-07-21"; // 화(스케줄 없어도 계획 행 자체는 생성 가능 — 스케줄 검증은 copy만)
    await Promise.all([
      sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${SLOT_DATE}, '15:00', 'regular', 'vocab')`,
      sql2`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${SLOT_DATE}, '15:00', 'regular', 'grammar')`,
    ]);
    const rows = await sql`select line_no from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${SLOT_DATE} and slot_start = '15:00'
      order by line_no`;
    expect(rows.map((r) => Number(r.line_no))).toEqual([1, 2]);
  });

  it("copy: 의미행만 재번호 복사 + placeholder 대상 교체 + 기존 의미행 교시 skip + 스케줄 밖 unmapped + goals fill-empty", async () => {
    // 원본(FROM 주): 월 15:00 = 의미행(위 테스트 잔존 행에 progress 채움) + placeholder 1행
    await sql`update class_sheet_plan_lines set progress = 'Ch 1'
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${FROM} and slot_start = '15:00'`;
    await sql`insert into class_sheet_plan_lines (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no)
      values (${T.tenant}, ${T.cls}, ${FROM}, '15:00', 'regular', 'writing', 9)`; // placeholder(전 필드 공백)
    // 월 16:00 = 의미행 1개 — 대상 주에 이미 의미행 존재 → skip 기대
    await sql`insert into class_sheet_plan_lines (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no, progress)
      values (${T.tenant}, ${T.cls}, ${FROM}, '16:00', 'regular', 'listening', 1, 'PL 6'),
             (${T.tenant}, ${T.cls}, ${TO}, '16:00', 'regular', 'listening', 1, '이미 작성됨')`;
    // 화 15:00 = 의미행(동시성 테스트 잔존 행) — 대상 주 화 스케줄 없음 → unmapped 기대
    await sql`update class_sheet_plan_lines set progress = 'Ch 2'
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = '2026-07-21' and slot_start = '15:00'`;
    // 대상 월 15:00 = placeholder-only → 삭제 후 교체 기대
    await sql`insert into class_sheet_plan_lines (tenant_id, class_id, plan_date, slot_start, term_mode, skill_area, line_no)
      values (${T.tenant}, ${T.cls}, ${TO}, '15:00', 'regular', 'speaking', 5)`;
    // goals: 원본 주간 2건, 대상에 (homeroom, vocab) 기존 → 보존, (assistant, reading)만 복사 기대
    await sql`insert into class_sheet_goals (tenant_id, class_id, scope, period_start, role, skill_area, textbook)
      values (${T.tenant}, ${T.cls}, 'week', ${FROM}, 'homeroom', 'vocab', '능률 VOCA'),
             (${T.tenant}, ${T.cls}, 'week', ${FROM}, 'assistant', 'reading', 'Reading Bite'),
             (${T.tenant}, ${T.cls}, 'week', ${TO}, 'homeroom', 'vocab', '기존 목표')`;

    const [res] =
      await sql`select ecs_copy_week(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, ${TO}) as r`;
    const r = res.r as { copied: number; goalsCopied: number; skippedSlots: string[]; unmapped: string[] };

    // 월 15:00: exam vocab(Ch 1) + regular grammar·reading(Ch 1) 의미행 3개만 복사(placeholder 제외), 1..N 재번호
    const target = await sql`select term_mode, line_no, skill_area, progress from class_sheet_plan_lines
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and plan_date = ${TO} and slot_start = '15:00'
      order by term_mode, line_no`;
    expect(target.every((row) => row.progress === "Ch 1")).toBe(true);
    expect(target.some((row) => row.skill_area === "speaking")).toBe(false); // placeholder 교체됨
    expect(Math.max(...target.map((row) => Number(row.line_no)))).toBeLessThanOrEqual(target.length);
    expect(r.copied).toBe(target.length);
    expect(r.skippedSlots).toEqual([`${TO} 16:00:00`]);
    expect(r.unmapped).toEqual([`2026-07-28 15:00:00`]);

    const goals = await sql`select role, skill_area, textbook from class_sheet_goals
      where tenant_id = ${T.tenant} and class_id = ${T.cls} and scope = 'week' and period_start = ${TO}
      order by role`;
    expect(goals.map((g) => [g.role, g.skill_area, g.textbook])).toEqual([
      ["assistant", "reading", "Reading Bite"],
      ["homeroom", "vocab", "기존 목표"], // 기존 보존
    ]);
    expect(r.goalsCopied).toBe(1);
  });

  it("copy: 월요일 아님/7일 차이 아님은 명시 에러", async () => {
    await expect(
      sql`select ecs_copy_week(${T.tenant}, ${T.user}, ${T.cls}, '2026-07-21', ${TO})`,
    ).rejects.toThrow(/ECS_COPY_NOT_MONDAY/);
    await expect(
      sql`select ecs_copy_week(${T.tenant}, ${T.user}, ${T.cls}, ${FROM}, '2026-08-03')`,
    ).rejects.toThrow(/ECS_COPY_NOT_NEXT_WEEK/);
  });

  it("mark_present_if_absent: 없으면 생성, 있으면 어떤 기록이든 no-op(메모 보존)", async () => {
    const D1 = "2026-07-20";
    const r1 =
      await sql`select * from ecs_mark_present_if_absent(${T.tenant}, ${T.user}, ${T.cls}, ${T.student}, ${D1})`;
    expect(r1).toHaveLength(1);
    expect(r1[0].status).toBe("present");
    // 재호출 = no-op(중복 생성 없음)
    const r2 =
      await sql`select * from ecs_mark_present_if_absent(${T.tenant}, ${T.user}, ${T.cls}, ${T.student}, ${D1})`;
    expect(r2).toHaveLength(1);
    // 기존 absent+메모가 있는 날짜는 절대 건드리지 않음
    const D2 = "2026-07-22";
    await sql`insert into attendance_records (tenant_id, class_id, student_id, session_date, status, note, recorded_by)
      values (${T.tenant}, ${T.cls}, ${T.student}, ${D2}, 'absent', '병결 — 보존돼야 함', ${T.user})`;
    const r3 =
      await sql`select * from ecs_mark_present_if_absent(${T.tenant}, ${T.user}, ${T.cls}, ${T.student}, ${D2})`;
    expect(r3).toHaveLength(1);
    expect(r3[0].status).toBe("absent");
    expect(r3[0].note).toBe("병결 — 보존돼야 함");
  });

  it("CAS: 같은 행의 서로 다른 두 필드는 순차 patch가 서로 충돌하지 않는다(필드 단위 CAS)", async () => {
    // flushSheetPatches의 SQL 계약(`<field> is not distinct from expected`) 검증 —
    // 행 버전이 아니라 필드 값 자체가 기준이라, 교재 저장 후 과제 저장이 자기충돌하지 않는다.
    const D = "2026-07-23";
    const res =
      await sql`select * from ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${D}, '15:00', 'regular', 'vocab')`;
    const id = res[0].id;
    const u1 = await sql`update class_sheet_plan_lines set textbook = '능률 VOCA'
      where id = ${id} and tenant_id = ${T.tenant} and class_id = ${T.cls}
        and textbook is not distinct from null returning id`;
    expect(u1).toHaveLength(1);
    const u2 = await sql`update class_sheet_plan_lines set homework = '받아쓰기'
      where id = ${id} and tenant_id = ${T.tenant} and class_id = ${T.cls}
        and homework is not distinct from null returning id`;
    expect(u2).toHaveLength(1); // 교재 저장이 과제 CAS 기준을 건드리지 않음
    // 타인이 바꾼 필드는 0행(=conflict 분기) — 기준값 stale
    const u3 = await sql`update class_sheet_plan_lines set textbook = '다른 값'
      where id = ${id} and tenant_id = ${T.tenant} and class_id = ${T.cls}
        and textbook is not distinct from null returning id`;
    expect(u3).toHaveLength(0);
    // 응답 유실 재전송: 서버값이 이미 newValue → already_applied 판정 근거
    const [cur] = await sql`select textbook from class_sheet_plan_lines where id = ${id}`;
    expect(cur.textbook).toBe("능률 VOCA");
  });

  it("create: 20행 상한 초과는 명시 에러", async () => {
    const SLOT_DATE = "2026-07-24"; // 금 — 빈 슬롯
    for (let i = 0; i < 20; i++) {
      await sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${SLOT_DATE}, '15:00', 'regular', 'vocab')`;
    }
    await expect(
      sql`select ecs_create_plan_line(${T.tenant}, ${T.user}, ${T.cls}, ${SLOT_DATE}, '15:00', 'regular', 'vocab')`,
    ).rejects.toThrow(/ECS_MAX_LINES/);
  });
});
