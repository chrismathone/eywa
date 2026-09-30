/**
 * 재원생 상담의 빈 과목·빈 상담사 채우기 — 동기화와 **같은 판정 함수**(scripts/_makeedu/consultation-counselor.cjs).
 *
 * 기본 = 드라이런(DB 쓰기 0). `--apply`일 때만 **비어 있는 칸만** 채우고 감사로그 1행을 남긴다.
 *   node --env-file=.env.local scripts/_oneoff/backfill-consultation-subjects.mjs [--tenant=cs] [--apply]
 *
 * 판정 = 상담사 담당 과목 하나 → 상담사 담당 ∩ 그날 학생 수강 과목 하나 → (상담사 모름/담당 과목 없음) 그날 학생 수강 과목 하나.
 * 상담사가 비어 있으면 상세 본문의 등록자 줄(`2026년 09월 22일` 다음 줄)로 직원을 찾는다(동명이인·모호 = 안 붙임).
 * 하나로 안 좁혀지는 행은 비운 채 '남김'으로 보고한다(추측 금지).
 *
 * 이력: 2026-09-23 첫 판(침산 한정 수동 검토 목록 포함)은 그날 적용됐다. 2026-09-30 원장 제보("과목이 안되네") —
 * 연동 PC가 9/23 이전 워커로 돌아 그 뒤 동기화분 53건이 전부 빈 과목이라 공용 함수로 다시 썼다.
 */
import postgres from "postgres";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  makeCounselorMatcher, registrantFromSummary, loadSubjectLabels, resolveConsultationSubject, SUBJECT_REASON_LABEL,
} = require("../_makeedu/consultation-counselor.cjs");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const apply = process.argv.includes("--apply");
const slug = (process.argv.find((a) => a.startsWith("--tenant=")) || "--tenant=cs").slice("--tenant=".length);

try {
  const tenants = await sql`select id from tenants where slug = ${slug}`;
  if (tenants.length !== 1) throw new Error(`지점 '${slug}'을(를) 하나로 찾지 못함`);
  const tenantId = tenants[0].id;
  const labels = await loadSubjectLabels(sql, tenantId);
  const users = await sql`select id, display_name, english_name, subjects, status from users where tenant_id = ${tenantId} and system_role <> 'student'`;
  const matchCounselor = makeCounselorMatcher(users);
  const byId = new Map(users.map((u) => [u.id, u]));

  // 빈 과목 또는 빈 상담사 행 + 그날 수강 과목(동기화의 loadEnrolledSubjects와 같은 창 — 반이동은 반열림, [[#125]]).
  const rows = await sql`
    select c.id, c.counselor_id, c.subject, c.summary, (c.makeedu_id is not null) as synced,
      array_agg(distinct cl.subject) filter (where cl.subject is not null) as enrolled
    from student_consultations c
    left join enrollments e on e.student_id = c.student_id and e.tenant_id = c.tenant_id
      and e.start_date <= (c.consulted_at at time zone 'Asia/Seoul')::date
      and (e.end_date is null or e.end_date > (c.consulted_at at time zone 'Asia/Seoul')::date
        or (e.end_date = (c.consulted_at at time zone 'Asia/Seoul')::date and not coalesce(e.is_transferred, false)))
    left join classes cl on cl.id = e.class_id and cl.tenant_id = c.tenant_id
    where c.tenant_id = ${tenantId}
      and (nullif(btrim(c.subject), '') is null or c.counselor_id is null)
    group by c.id`;

  const updates = [];
  const dist = { subject: {}, counselorLinked: 0, subjectLeftBlank: 0, counselorLeftBlank: 0 };
  const leftExamples = [];
  for (const row of rows) {
    const needSubject = !String(row.subject || "").trim();
    const needCounselor = !row.counselor_id;
    const matched = needCounselor ? matchCounselor(registrantFromSummary(row.summary)) : null;
    const counselor = byId.get(row.counselor_id) || matched || null;
    const pick = needSubject ? resolveConsultationSubject({ counselor, enrolledSubjects: row.enrolled || [], labels }) : null;

    const patch = { id: row.id, subject: pick?.label ?? null, counselorId: matched?.id ?? null };
    if (pick) dist.subject[SUBJECT_REASON_LABEL[pick.reason]] = (dist.subject[SUBJECT_REASON_LABEL[pick.reason]] || 0) + 1;
    if (matched) dist.counselorLinked++;
    if (needSubject && !pick) {
      dist.subjectLeftBlank++;
      if (leftExamples.length < 3) {
        leftExamples.push({
          상담사: counselor?.display_name ?? registrantFromSummary(row.summary) ?? "(모름)",
          담당과목: (counselor?.subjects || []).join(",") || "-",
          그날수강: (row.enrolled || []).join(",") || "-",
        });
      }
    }
    if (needCounselor && !matched) dist.counselorLeftBlank++;
    if (patch.subject || patch.counselorId) updates.push(patch);
  }

  console.log(JSON.stringify({
    tenant: slug, mode: apply ? "apply" : "dry-run", candidates: rows.length, planned: updates.length,
    과목채움: dist.subject, 과목남김: dist.subjectLeftBlank, 상담사연결: dist.counselorLinked, 상담사남김: dist.counselorLeftBlank,
    남김예시: leftExamples,
  }, null, 2));

  if (apply && updates.length) {
    let applied = 0;
    await sql.begin(async (tx) => {
      for (const u of updates) {
        // 빈 칸만 채운다 — 그사이 누가 적은 값은 보존(coalesce).
        const res = await tx`
          update student_consultations set
            subject = case when nullif(btrim(subject), '') is null then coalesce(${u.subject}, subject) else subject end,
            counselor_id = coalesce(counselor_id, ${u.counselorId}),
            updated_at = now()
          where id = ${u.id} and tenant_id = ${tenantId}`;
        applied += res.count;
      }
      const audit = {
        action: "student_consultation_subject_backfill",
        targetType: "student_consultation",
        metadata: { count: applied, subjects: dist.subject, counselorLinked: dist.counselorLinked, left: dist.subjectLeftBlank },
      };
      await tx`
        insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenantId}, null, ${"운영 스크립트"}, ${audit.action}, ${audit.targetType}, ${`상담 ${applied}건`}, ${tx.json(audit.metadata)})`;
    });
    const remaining = await sql`
      select count(*)::int as count from student_consultations
      where tenant_id = ${tenantId} and nullif(btrim(subject), '') is null`;
    console.log(JSON.stringify({ applied, remainingBlankSubject: remaining[0].count }));
  }
} finally {
  await sql.end();
}
