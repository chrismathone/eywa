import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

// 함수 설치·테스트용 테넌트·모든 이동은 한 트랜잭션에 넣고 마지막에 반드시 롤백한다.
it.skipIf(!process.env.DATABASE_URL)("단체 이동: 실제 RLS·부분 실패·휴원·변경 감지·중복 이동 차단", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rollback = new Error("rollback_bulk_transfer_test");
  try {
    await expect(db.begin(async (tx) => {
      await tx.unsafe(readFileSync("supabase/migrations/0281a_class_bulk_transfer.sql", "utf8"));
      await tx.unsafe(readFileSync("supabase/migrations/0281b_move_enrollments_lock_source.sql", "utf8"));
      const tag = randomUUID();
      const [tenant] = await tx`insert into tenants (slug, name) values (${`transfer-${tag}`}, 'Transfer test') returning id`;
      const [other] = await tx`insert into tenants (slug, name) values (${`other-${tag}`}, 'Other transfer test') returning id`;
      const userId = randomUUID();
      const teacherId = randomUUID();
      await tx`insert into users (id, tenant_id, email, display_name, system_role) values (${userId}, ${tenant.id}, ${`${tag}@test.invalid`}, 'Test', 'master')`;
      await tx`insert into users (id, tenant_id, email, display_name, system_role) values (${teacherId}, ${tenant.id}, ${`teacher-${tag}@test.invalid`}, 'Teacher', 'teacher')`;
      const [source] = await tx`insert into classes (tenant_id, class_name, subject) values (${tenant.id}, 'Source', 'math') returning id`;
      const [target] = await tx`insert into classes (tenant_id, class_name, subject) values (${tenant.id}, 'Target', 'math') returning id`;
      const [foreign] = await tx`insert into classes (tenant_id, class_name, subject) values (${other.id}, 'Foreign', 'math') returning id`;
      const [{ today }] = await tx`select (now() at time zone 'Asia/Seoul')::date::text as today`;
      const oldIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const [student] = await tx`insert into students (tenant_id, name, status) values (${tenant.id}, ${`Test ${i}`}, 'enrolled') returning id`;
        const [enrollment] = await tx`insert into enrollments (tenant_id, student_id, class_id, start_date, on_hold, attendance_days)
          values (${tenant.id}, ${student.id}, ${source.id}, ${today}::date - 10, ${i === 0}, array['mon']) returning id`;
        oldIds.push(enrollment.id);
        if (i === 1) await tx`insert into enrollments (tenant_id, student_id, class_id, start_date) values (${tenant.id}, ${student.id}, ${target.id}, ${today})`;
      }
      const rows = await tx`select id, jsonb_build_object('studentId', student_id, 'startDate', start_date, 'endDate', end_date,
        'onHold', on_hold, 'isTransferred', is_transferred, 'attendanceDays', attendance_days) as snapshot from enrollments where class_id = ${source.id}`;
      const moves = rows.map((r) => ({ enrollmentId: r.id, newClassId: target.id, attendanceDays: ["thu"], expected: r.snapshot }));
      const one = (id: string) => moves.find((m) => m.enrollmentId === id)!;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
      await tx.unsafe("set local role authenticated");
      const call = async (input: typeof moves) => {
        const [row] = await tx`select public.move_class_enrollments_batch(${source.id}, ${tx.json(input)}, ${today}) as results`;
        return row.results as { enrollmentId: string; newEnrollmentId?: string; ok: boolean; error?: string }[];
      };
      expect((await call([{ ...one(oldIds[2]), newClassId: foreign.id }]))[0]).toMatchObject({ ok: false, error: "transfer_target_missing" });
      expect((await call([{ ...one(oldIds[2]), expected: { ...one(oldIds[2]).expected, onHold: true } }]))[0]).toMatchObject({ ok: false, error: "transfer_source_changed" });
      const result = await call([one(oldIds[0]), one(oldIds[1])]);
      expect(result.find((r) => r.enrollmentId === oldIds[0])?.ok).toBe(true);
      expect(result.find((r) => r.enrollmentId === oldIds[1])?.ok).toBe(false);
      const [kept] = await tx`select end_date, is_transferred from enrollments where id = ${oldIds[1]}`;
      expect(kept).toMatchObject({ end_date: null, is_transferred: false });
      const [created] = await tx`select on_hold, attendance_days, start_date::text, is_transferred_in from enrollments where id = ${result.find((r) => r.ok)!.newEnrollmentId!}`;
      expect(created).toMatchObject({ on_hold: true, attendance_days: ["thu"], start_date: today, is_transferred_in: true });
      expect((await call([one(oldIds[0])]))[0]).toMatchObject({ ok: false, error: "transfer_already_moved" });
      const [legacyRetry] = await tx`select public.move_enrollments_batch(${tx.json([one(oldIds[0])])}, ${today}) as results`;
      expect(legacyRetry.results[0]).toMatchObject({ ok: false, error: expect.stringContaining("이미 반 이동") });
      const [legacySuccess] = await tx`select public.move_enrollments_batch(${tx.json([one(oldIds[2])])}, ${today}) as results`;
      expect(legacySuccess.results[0]).toMatchObject({ ok: true, newEnrollmentId: expect.any(String) });
      expect((await call([one(oldIds[2])]))[0]).toMatchObject({ ok: false, error: "transfer_already_moved" });
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: teacherId })}, true)`;
      expect((await call([one(oldIds[3])]))[0]).toMatchObject({ ok: false, error: "transfer_source_missing" });
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await db.end(); }
}, 60_000);
