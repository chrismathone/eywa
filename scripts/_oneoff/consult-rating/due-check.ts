// 운영 데이터로 정기 처리의 줄 세우기 판정(pickDue)을 그대로 돌려 본다 — 읽기 전용. 스위치를 켜기 전·보류를 풀기 전 확인용.
// TSX_TSCONFIG_PATH=scripts/_oneoff/consult-rating/tsconfig.json node --env-file=.env.local --import tsx scripts/_oneoff/consult-rating/due-check.ts
import { pickDue } from "@/features/consultation-rating/due";
import { CONSULT_RUBRIC_ID } from "@/features/consultation-rating/harness/rubric";
import { closeReadOnly, openReadOnly, tenantIdOf } from "../ai-credit-mvp/lib/db-readonly.mjs";

async function main() {
  const sql = await openReadOnly();
  try {
    const t = await tenantIdOf(sql);
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    type C = { id: string; student_id: string; updated_at: Date };
    type R = { consultation_id: string; source_updated_at: Date | null };
    type Q = { consultation_id: string; stage: string; rubric: string | null; source_updated_at: Date | null };
    const cs = ((await sql`select id, student_id, updated_at from student_consultations where tenant_id = ${t}`) as unknown as C[]).map((r) => ({ id: r.id, student_id: r.student_id, updated_at: iso(r.updated_at)! }));
    const rs = ((await sql`select consultation_id, source_updated_at from student_consultation_ratings where tenant_id = ${t} and rubric = ${CONSULT_RUBRIC_ID}`) as unknown as R[]).map((r) => ({ consultation_id: r.consultation_id, source_updated_at: iso(r.source_updated_at) }));
    const qs = ((await sql`select consultation_id, stage, rubric, source_updated_at from student_consultation_rating_queue where tenant_id = ${t}`) as unknown as Q[]).map((r) => ({ ...r, source_updated_at: iso(r.source_updated_at) }));
    const tests = new Set(((await sql`select id from students where tenant_id = ${t} and is_test`) as unknown as { id: string }[]).map((r) => r.id));
    const due = pickDue(cs, rs, qs, tests, CONSULT_RUBRIC_ID);
    console.log(JSON.stringify({ 상담: cs.length, 평점: rs.length, 줄: qs.length, 지금_줄설_후보: due.length, 예: due.slice(0, 5) }));
  } finally { await closeReadOnly(sql); }
}
main().catch((e) => { console.error(e); process.exit(1); });
