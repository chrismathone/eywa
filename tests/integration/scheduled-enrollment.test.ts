import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { expect, it } from "vitest";

config({ path: ".env.local", quiet: true });

it.skipIf(!process.env.DATABASE_URL)("예약 수정·취소는 두 반을 함께 바꾸고 오류·중복·권한 위반 때 전체 롤백한다", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const rollback = new Error("rollback_scheduled_enrollment_test");
  try {
    await expect(db.begin(async (tx) => {
      await tx.unsafe(readFileSync("supabase/migrations/20261002050926_scheduled_enrollment_atomic.sql", "utf8"));
      const tag = randomUUID();
      const [tenant] = await tx`insert into tenants (slug, name) values (${`scheduled-${tag}`}, 'Scheduled test') returning id`;
      const owner = randomUUID();
      const teacher = randomUUID();
      await tx`insert into users (id, tenant_id, email, display_name, system_role) values
        (${owner}, ${tenant.id}, ${`owner-${tag}@example.invalid`}, 'Owner', 'master'),
        (${teacher}, ${tenant.id}, ${`teacher-${tag}@example.invalid`}, 'Teacher', 'teacher')`;
      const [source] = await tx`insert into classes (tenant_id, class_name, subject) values (${tenant.id}, 'Source', 'math') returning id`;
      const [target] = await tx`insert into classes (tenant_id, class_name, subject) values (${tenant.id}, 'Target', 'math') returning id`;
      const [{ today, move, next }] = await tx`select (now() at time zone 'Asia/Seoul')::date::text as today,
        ((now() at time zone 'Asia/Seoul')::date + 2)::text as move,
        ((now() at time zone 'Asia/Seoul')::date + 4)::text as next`;
      const makePair = async (name: string) => {
        const [student] = await tx`insert into students (tenant_id, name, status) values (${tenant.id}, ${name}, 'enrolled') returning id`;
        const [old] = await tx`insert into enrollments (tenant_id, student_id, class_id, start_date, end_date, is_transferred, withdrawal_reason, on_hold)
          values (${tenant.id}, ${student.id}, ${source.id}, ${today}::date - 10, ${move}, true, ${'반 이동'}, true) returning id`;
        const [incoming] = await tx`insert into enrollments (tenant_id, student_id, class_id, start_date, is_transferred_in, on_hold)
          values (${tenant.id}, ${student.id}, ${target.id}, ${move}, true, true) returning id`;
        return { old: old.id as string, incoming: incoming.id as string, student: student.id as string };
      };
      const good = await makePair("Good");
      const conflict = await makePair("Conflict");
      const wrong = await makePair("Wrong pair");
      const protectedPair = await makePair("Protected");
      // 이전 반을 복구할 때 기간 중복으로 실패하는 사례: 새 반 삭제까지 함께 롤백되어야 한다.
      await tx`insert into enrollments (tenant_id, student_id, class_id, start_date)
        values (${tenant.id}, ${conflict.student}, ${source.id}, ${next})`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner })}, true)`;
      await tx.unsafe("set local role authenticated");
      const call = async (id: string, pair: string | null, action: string, date: string | null = null) => {
        const [res] = await tx`select public.change_scheduled_enrollment(${id}, ${pair}, ${action}, ${date}, null) as result`;
        return res.result;
      };
      expect(await call(good.incoming, good.old, "reschedule", next)).toMatchObject({ ok: true, nextDate: next });
      const changed = await tx`select id, start_date::text, end_date::text from enrollments where id in (${good.old}, ${good.incoming})`;
      expect(changed.find((r) => r.id === good.old)?.end_date).toBe(next);
      expect(changed.find((r) => r.id === good.incoming)?.start_date).toBe(next);
      expect(await call(good.incoming, good.old, "reschedule", today)).toMatchObject({ ok: false, error: "scheduled_invalid_date" });
      expect(await call(wrong.incoming, null, "cancel")).toMatchObject({ ok: false, error: "scheduled_pair_changed" });
      expect(await call(wrong.incoming, good.old, "cancel")).toMatchObject({ ok: false, error: "scheduled_pair_changed" });
      expect(await call(conflict.incoming, conflict.old, "cancel")).toMatchObject({ ok: false });
      const kept = await tx`select id, end_date::text, is_transferred from enrollments where id in (${conflict.old}, ${conflict.incoming})`;
      expect(kept).toHaveLength(2);
      expect(kept.find((r) => r.id === conflict.old)).toMatchObject({ end_date: move, is_transferred: true });
      expect(await call(good.incoming, good.old, "cancel")).toMatchObject({ ok: true });
      const reopened = await tx`select id, end_date, is_transferred, withdrawal_reason, on_hold from enrollments where id in (${good.old}, ${good.incoming})`;
      expect(reopened).toEqual([expect.objectContaining({ id: good.old, end_date: null, is_transferred: false, withdrawal_reason: null, on_hold: true })]);
      expect(await call(good.incoming, good.old, "cancel")).toMatchObject({ ok: false, error: "scheduled_missing" });
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: teacher })}, true)`;
      expect(await call(protectedPair.incoming, protectedPair.old, "cancel")).toMatchObject({ ok: false });
      await tx.unsafe("reset role");
      const intact = await tx`select id from enrollments where id in (${protectedPair.old}, ${protectedPair.incoming})`;
      expect(intact).toHaveLength(2);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await db.end(); }
}, 60_000);
