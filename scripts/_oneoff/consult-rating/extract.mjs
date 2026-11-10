// 상담 평점 — 침산 상담 전건 추출(운영 DB 읽기 전용). 결과는 저장소 밖 ~/eywa-data/consult-rating/ 로만.
// node --env-file=.env.local scripts/_oneoff/consult-rating/extract.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeReadOnly, openReadOnly, tenantIdOf } from "../ai-credit-mvp/lib/db-readonly.mjs";
const OUT = join(homedir(), "eywa-data", "consult-rating");
mkdirSync(OUT, { recursive: true });
const sql = await openReadOnly();
try {
  const cs = await tenantIdOf(sql);
  const rows = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = await sql`
      select c.id, c.consulted_at::text consulted_at, c.created_at::text created_at, c.updated_at::text updated_at, c.summary,
             c.follow_up_action, c.follow_up_date::text follow_up_date, c.follow_up_done, c.category, c.subject, c.audience,
             c.counselor_id, u.display_name counselor, c.student_id, s.name student, s.grade, s.school, s.status student_status,
             c.processing_status, (c.transcription is not null) has_transcript, c.transcription, c.ai_summary, c.makeedu_id is not null from_makeedu,
             c.class_id, k.class_name
      from student_consultations c
      join students s on s.id = c.student_id and s.tenant_id = c.tenant_id
      left join users u on u.id = c.counselor_id
      left join classes k on k.id = c.class_id
      where c.tenant_id = ${cs} and not coalesce(s.is_test,false) and c.id > ${after}
      order by c.id limit 1000`;
    rows.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].id;
  }
  writeFileSync(join(OUT, "cs-all.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log("추출", rows.length, "건 →", join(OUT, "cs-all.jsonl"));
} finally { await closeReadOnly(sql); }
