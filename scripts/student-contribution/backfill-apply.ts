/** 원장 승인 후에만 실행. 승인한 드라이런 지문과 새 읽기 결과가 다르면 쓰기 전에 중단한다. */
import postgres from "postgres";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { checkedConnection, readBackfillSnapshot } from "./backfill-source";
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
async function main() {
  if (!args.includes("--apply") || !args.includes("--approve-fingerprint") || !args.includes("--owner") || !args.includes("--report"))
    throw new Error("원장 승인 뒤 --apply --report <드라이런 JSON> --approve-fingerprint <승인한 지문> --owner <원장 id>를 지정하세요");
  const owner = option("--owner"), approved = option("--approve-fingerprint");
  if (!/^[a-f0-9-]{36}$/i.test(owner ?? "") || !/^[a-f0-9]{64}$/.test(approved ?? "")) throw new Error("승인 정보를 확인하세요");
  const report = JSON.parse(readFileSync(resolve(option("--report")!), "utf8")) as Awaited<ReturnType<typeof readBackfillSnapshot>>;
  if (!report.readOnly || report.fingerprint !== approved) throw new Error("승인한 드라이런 보고서와 지문이 다릅니다");
  const db = postgres(checkedConnection(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
  const rollbackPath = resolve("work", `student-contribution-referral-rollback-${Date.now()}.json`);
  try {
    const completed = await db.begin("isolation level serializable", async (sql) => {
      await sql`set local lock_timeout = '5s'`;
      await sql`set local statement_timeout = '60s'`;
      const owners = await sql`select id,display_name from public.users where id=${owner!} and tenant_id=${report.tenantId} and system_role='master' and status='active'`;
      if (owners.length !== 1) throw new Error("이 학원의 승인 원장 계정을 확인할 수 없습니다");
      const fresh = await readBackfillSnapshot(sql);
      if (fresh.tenantId !== report.tenantId || fresh.fingerprint !== approved) throw new Error("원본이 드라이런 이후 바뀌었습니다. 새 드라이런과 승인이 필요합니다");
      const automatic = fresh.rows.filter((r) => r.state === "automatic" && r.candidateId);
      const before = [];
      for (const row of automatic) {
        const existing = await sql`select id,referrer_student_id,referrer_staff_id,referrer_name,updated_at from public.enrollment_consultations where tenant_id=${fresh.tenantId} and id=${row.consultationId} for update`;
        if (existing.length !== 1 || existing[0]!.referrer_student_id || existing[0]!.referrer_staff_id) throw new Error("이미 바뀐 소개 연결이 있습니다");
        before.push({ ...existing[0], after: { referrer_student_id: row.candidateId }, guards: row.guards, evidence: row.evidence });
      }
      const rollback = { tenantId: fresh.tenantId, owner, approvedFingerprint: approved, status: "prepared", preparedAt: new Date().toISOString(), rows: before };
      mkdirSync(resolve("work"), { recursive: true });
      writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2), { flag: "wx" });
      for (const row of automatic) {
        const changed = await sql`update public.enrollment_consultations set referrer_student_id=${row.candidateId} where tenant_id=${fresh.tenantId} and id=${row.consultationId} and referrer_student_id is null and referrer_staff_id is null returning id`;
        if (changed.length !== 1) throw new Error("소개 연결 충돌 — 전체 실행을 되돌립니다");
        await sql`insert into public.audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
          values(${fresh.tenantId},${owner!},${owners[0]!.display_name},'student_contribution_referral_backfill','student_contribution','지난 소개 연결',
          ${sql.json({ source: "backfill", consultationId: row.consultationId, studentId: row.candidateId, guards: row.guards, evidence: row.evidence, fingerprint: approved ?? "" })})`;
      }
      return { count: automatic.length, rollback };
    });
    // prepared 파일은 커밋 상태가 불확실해도 삭제하지 않는다. 감사로그와 함께 확인한다.
    writeFileSync(rollbackPath, JSON.stringify({ ...completed.rollback, status: "committed", committedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ applied: completed.count, rollbackPath, notice: "현재 달 직원 소개 평가에도 영향을 줄 수 있습니다. 원생 기여도는 다음 집계에서 반영됩니다." }));
  } finally { await db.end({ timeout: 5 }); }
}
main().catch((error) => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]")); process.exitCode = 1; });
