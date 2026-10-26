// ① 퇴원 사유 복원 되돌리기 — apply.mjs가 남긴 백업으로(🔴 2026-10-26 MVP 세션은 실행하지 않는다).
//   미리보기: node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/withdrawals/revert.mjs --backup <백업.json>
//   되돌리기: … --backup <백업.json> --apply
// 🔴 적용 뒤 그대로인 행만 되돌린다 — 학생의 퇴원 정보와 수강 줄의 사유·세부·메모가 **적용 직후 값과 모두 같을 때만**
//    (그 사이 직원이 고쳤으면 건드리지 않고 알린다). 감사로그에 '되돌림'을 남긴다.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { closeReadOnly, openReadOnly } from "../lib/db-readonly.mjs";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const file = arg("backup");
if (!file) throw new Error("--backup <백업.json> 필요");
const backup = JSON.parse(readFileSync(file, "utf8"));
// jsonb는 키 순서를 다시 매겨 저장한다 — 키를 정렬해 비교한다.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const enrSame = (now, after) => !!now && (now.withdrawal_reason ?? null) === (after.withdrawal_reason ?? null)
  && (now.withdrawal_detail ?? null) === (after.withdrawal_detail ?? null) && (now.withdrawal_memo ?? null) === (after.withdrawal_memo ?? null);

const sql = APPLY ? postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false }) : await openReadOnly();
try {
  const run = async (tx) => {
    const cs = backup.tenantId;
    const ids = backup.changes.map((c) => c.studentId);
    const enrIds = backup.changes.flatMap((c) => c.after.enrollments.map((e) => e.id));
    const students = APPLY
      ? await tx`select id, withdrawal_metadata m from students where tenant_id=${cs} and id = any(${ids}) for update`
      : await tx`select id, withdrawal_metadata m from students where tenant_id=${cs} and id = any(${ids})`;
    const enrNow = APPLY
      ? await tx`select id, withdrawal_reason, withdrawal_detail, withdrawal_memo from enrollments where tenant_id=${cs} and id = any(${enrIds}) for update`
      : await tx`select id, withdrawal_reason, withdrawal_detail, withdrawal_memo from enrollments where tenant_id=${cs} and id = any(${enrIds})`;
    const now = new Map(students.map((s) => [s.id, s.m]));
    const E = new Map(enrNow.map((e) => [e.id, e]));
    let done = 0;
    const kept = [];
    for (const c of backup.changes) {
      if (!same(now.get(c.studentId), c.after.metadata)) { kept.push({ studentId: c.studentId, why: "적용 뒤 퇴원 정보가 바뀌어 그대로 둠" }); continue; }
      if (!c.after.enrollments.every((e) => enrSame(E.get(e.id), e))) { kept.push({ studentId: c.studentId, why: "적용 뒤 수강 종료 사유가 바뀌어 그대로 둠" }); continue; }
      if (APPLY) {
        await tx`update students set withdrawal_metadata = ${c.before.metadata === null ? null : tx.json(c.before.metadata)} where tenant_id=${cs} and id=${c.studentId}`;
        for (const e of c.before.enrollments)
          await tx`update enrollments set withdrawal_reason=${e.withdrawal_reason}, withdrawal_detail=${e.withdrawal_detail}, withdrawal_memo=${e.withdrawal_memo}
            where tenant_id=${cs} and id=${e.id}`;
        await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${cs}, null, '퇴원 사유 복원 되돌리기', 'withdrawal_reason_restore', 'student', ${c.name ?? null}, ${tx.json({ studentId: c.studentId, reverted: true })})`;
      }
      done++;
    }
    console.log(JSON.stringify({ [APPLY ? "되돌림" : "되돌릴_학생"]: done, 그대로_둠: kept }));
  };
  if (APPLY) await sql.begin(run); else await run(sql);
} finally {
  if (APPLY) await sql.end(); else await closeReadOnly(sql);
}
