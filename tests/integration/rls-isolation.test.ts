import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * RLS 테넌트 격리 회귀 테스트 (B5) — "한 정책 빠지면 전사 노출"의 자동 가드.
 *
 * 그동안 격리는 코드 인스펙션으로만 확인됐고(supabase/tests=빈 .gitkeep), 미래 마이그레이션이 정책을
 * 빠뜨려도 잡을 회귀 게이트가 없었다. 이 테스트는 throwaway 테넌트 2개를 만들고, `authenticated` 역할 +
 * JWT claim(sub=userId)로 실제 RLS를 발동시켜 **타 테넌트 행이 안 보이는지** 검증한다.
 *
 * ⚠️ DATABASE_URL은 테이블 소유자(postgres)로 붙어 RLS를 우회한다 → 반드시 `set local role authenticated`로
 * 낮춰야 정책이 실제로 발동한다(안 하면 false-green). 트랜잭션 내 `set local`로 격리·자동 복귀.
 * `pnpm test:rls`로만 실행(기본 `pnpm test`엔 미포함 → DB 없는 CI 안전). DATABASE_URL 없으면 skip.
 */

config({ path: ".env.local" });
const DB = process.env.DATABASE_URL;

describe.skipIf(!DB)("RLS 테넌트 격리 (2-테넌트)", () => {
  const sql = postgres(DB!, { prepare: false, max: 1 });
  const tag = randomUUID().slice(0, 8);
  const A = { tenant: "", user: randomUUID(), student: "", cls: "" };
  const B = { tenant: "", user: randomUUID(), student: "", cls: "" };

  beforeAll(async () => {
    const [ta] = await sql`insert into tenants (slug, name) values (${`rls-a-${tag}`}, 'RLS Test A') returning id`;
    const [tb] = await sql`insert into tenants (slug, name) values (${`rls-b-${tag}`}, 'RLS Test B') returning id`;
    A.tenant = ta.id;
    B.tenant = tb.id;
    // public.users는 auth.users FK가 없어 직접 INSERT 가능(#31). auth_tenant_id()가 sub→tenant 해석에 사용.
    await sql`insert into users (id, tenant_id, email, display_name, system_role) values (${A.user}, ${A.tenant}, ${`a-${tag}@rls.test`}, 'RLS A', 'master')`;
    await sql`insert into users (id, tenant_id, email, display_name, system_role) values (${B.user}, ${B.tenant}, ${`b-${tag}@rls.test`}, 'RLS B', 'master')`;
    const [sa] = await sql`insert into students (tenant_id, name, status) values (${A.tenant}, ${`RLS-A-${tag}`}, 'enrolled') returning id`;
    const [sb] = await sql`insert into students (tenant_id, name, status) values (${B.tenant}, ${`RLS-B-${tag}`}, 'enrolled') returning id`;
    A.student = sa.id;
    B.student = sb.id;
    const [ca] = await sql`insert into classes (tenant_id, class_name, subject) values (${A.tenant}, ${`CA-${tag}`}, 'math') returning id`;
    const [cb] = await sql`insert into classes (tenant_id, class_name, subject) values (${B.tenant}, ${`CB-${tag}`}, 'math') returning id`;
    A.cls = ca.id;
    B.cls = cb.id;
  });

  afterAll(async () => {
    // tenants 삭제가 users/students/classes로 ON DELETE CASCADE.
    if (A.tenant) await sql`delete from tenants where id = ${A.tenant}`;
    if (B.tenant) await sql`delete from tenants where id = ${B.tenant}`;
    await sql.end();
  });

  /** authenticated 역할 + JWT claim(sub)로 RLS를 발동시켜 count를 잰다(트랜잭션-로컬). */
  async function countsAsUser(
    userId: string,
    runner: (run: (q: string, ...args: string[]) => Promise<number>) => Promise<Record<string, number>>,
  ): Promise<Record<string, number>> {
    return sql.begin(async (tx) => {
      // claims는 소유자 권한으로 먼저 세팅 → 역할을 authenticated로 낮춤(이후 SELECT가 RLS 적용).
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
      await tx.unsafe("set local role authenticated");
      const run = async (q: string, ...args: string[]) => {
        const rows = await tx.unsafe(q, args);
        return Number((rows[0] as Record<string, unknown>).count);
      };
      return runner(run);
    }) as Promise<Record<string, number>>;
  }

  it("소유자 연결(service)은 RLS 우회 — 양 테넌트 학생 다 보임(시드 확인)", async () => {
    const rows = await sql`select count(*)::int as count from students where id in (${A.student}, ${B.student})`;
    expect(Number(rows[0].count)).toBe(2);
  });

  it("지점장A는 본인 테넌트 학생만, 타 테넌트는 0 (students)", async () => {
    const r = await countsAsUser(A.user, async (run) => ({
      own: await run("select count(*)::int as count from students"),
      cross: await run("select count(*)::int as count from students where id = $1", B.student),
    }));
    expect(r.own).toBe(1); // throwaway 테넌트라 본인 학생 1명만(564 데모 학생 안 보임 = RLS 작동)
    expect(r.cross).toBe(0); // 타 테넌트 학생 차단
  });

  it("지점장A는 본인 테넌트 반만, 타 테넌트는 0 (classes)", async () => {
    const r = await countsAsUser(A.user, async (run) => ({
      own: await run("select count(*)::int as count from classes"),
      cross: await run("select count(*)::int as count from classes where id = $1", B.cls),
    }));
    expect(r.own).toBe(1);
    expect(r.cross).toBe(0);
  });

  it("지점장B도 타 테넌트(A) 학생 0 (대칭 확인)", async () => {
    const r = await countsAsUser(B.user, async (run) => ({
      crossToA: await run("select count(*)::int as count from students where id = $1", A.student),
    }));
    expect(r.crossToA).toBe(0);
  });

  it("지점장A는 타 테넌트 학생·반을 추가·수정·삭제하지 못한다", async () => {
    const rollback = new Error("rollback_cross_tenant_write_probe");
    const insertErrors: unknown[] = [];
    let changedStudents = 0;
    let deletedStudents = 0;
    let changedClasses = 0;
    let deletedClasses = 0;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A.user })}, true)`;
        await tx.unsafe("set local role authenticated");
        for (const table of ["students", "classes"] as const) {
          try {
            await tx.savepoint((sp) => table === "students"
              ? sp`insert into students (tenant_id, name, status) values (${B.tenant}, 'Forbidden student', 'enrolled')`
              : sp`insert into classes (tenant_id, class_name, subject) values (${B.tenant}, 'Forbidden class', 'math')`);
          } catch (error) {
            insertErrors.push(error);
          }
        }
        changedStudents = (await tx`update students set name = 'Forbidden edit' where id = ${B.student} returning id`).length;
        deletedStudents = (await tx`delete from students where id = ${B.student} returning id`).length;
        changedClasses = (await tx`update classes set class_name = 'Forbidden edit' where id = ${B.cls} returning id`).length;
        deletedClasses = (await tx`delete from classes where id = ${B.cls} returning id`).length;
        throw rollback; // Even a broken policy cannot leave test writes in the database.
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(insertErrors).toHaveLength(2);
    expect(insertErrors.every((error) => (error as { code?: string }).code === "42501")).toBe(true);
    expect([changedStudents, deletedStudents, changedClasses, deletedClasses]).toEqual([0, 0, 0, 0]);
    const untouched = await sql`select (select name from students where id = ${B.student}) as student_name,
      (select class_name from classes where id = ${B.cls}) as class_name`;
    expect(untouched[0]).toMatchObject({ student_name: `RLS-B-${tag}`, class_name: `CB-${tag}` });
  });

  it("청구서와 수강 배정도 자기 테넌트 행만 읽는다", async () => {
    const rollback = new Error("rollback_financial_isolation_probe");
    const counts: Record<string, number> = {};
    let crossInvoiceInsertError: unknown = null;
    try {
      await sql.begin(async (tx) => {
        const [ownInvoice] = await tx`insert into invoices (tenant_id, student_id, period, amount_total, line_items)
          values (${A.tenant}, ${A.student}, '2099-01', 1000, '[]'::jsonb) returning id`;
        const [otherInvoice] = await tx`insert into invoices (tenant_id, student_id, period, amount_total, line_items)
          values (${B.tenant}, ${B.student}, '2099-01', 1000, '[]'::jsonb) returning id`;
        const [ownEnrollment] = await tx`insert into enrollments (tenant_id, student_id, class_id, start_date)
          values (${A.tenant}, ${A.student}, ${A.cls}, '2099-01-01') returning id`;
        const [otherEnrollment] = await tx`insert into enrollments (tenant_id, student_id, class_id, start_date)
          values (${B.tenant}, ${B.student}, ${B.cls}, '2099-01-01') returning id`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: A.user })}, true)`;
        await tx.unsafe("set local role authenticated");
        const [invoiceCount] = await tx`select count(*)::int as n from invoices where id in (${ownInvoice.id}, ${otherInvoice.id})`;
        const [otherInvoiceCount] = await tx`select count(*)::int as n from invoices where id = ${otherInvoice.id}`;
        const [enrollmentCount] = await tx`select count(*)::int as n from enrollments where id in (${ownEnrollment.id}, ${otherEnrollment.id})`;
        const [otherEnrollmentCount] = await tx`select count(*)::int as n from enrollments where id = ${otherEnrollment.id}`;
        Object.assign(counts, { invoices: invoiceCount.n, foreignInvoices: otherInvoiceCount.n,
          enrollments: enrollmentCount.n, foreignEnrollments: otherEnrollmentCount.n });
        try {
          await tx.savepoint((sp) => sp`insert into invoices (tenant_id, student_id, period, amount_total, line_items)
            values (${B.tenant}, ${B.student}, '2099-02', 1000, '[]'::jsonb)`);
        } catch (error) {
          crossInvoiceInsertError = error;
        }
        counts.foreignInvoiceUpdates = (await tx`update invoices set amount_total = 2000 where id = ${otherInvoice.id} returning id`).length;
        counts.foreignInvoiceDeletes = (await tx`delete from invoices where id = ${otherInvoice.id} returning id`).length;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(counts).toEqual({ invoices: 1, foreignInvoices: 0, enrollments: 1, foreignEnrollments: 0,
      foreignInvoiceUpdates: 0, foreignInvoiceDeletes: 0 });
    expect((crossInvoiceInsertError as { code?: string } | null)?.code).toBe("42501");
  });
});
