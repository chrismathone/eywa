// 장기 미결 콜&상담 정리 (원장 2026-10-23 "1044건 정리" · "기억해놓고 혹시나 되돌릴 수 있도록")
// 대상 = 침산 · '상담 완료' 칸(consulted·ai_done) · 오늘 이후 다음 상담일 없음 · 상담일이 60일 넘게 지남.
// 분류(근거가 있을 때만 '등록', 나머지 '미등록'):
//   A 등록 — 이어진 원생이 상담일 30일 전 이후로 그 과목 묶음 반 수강을 시작한 적이 있다(과목 빈칸이면 아무 반).
//   B 등록 — 원생 연결 없음 · 이름(끝 알파벳 뗌)+학교가 같은 원생이 딱 1명이고 그 원생 등록일이 상담일 −30 ~ +120일.
//   C 미등록 — 그 밖.
// 60일 안의 상담(진행 중)은 손대지 않는다 — 후속 조치 필수가 결정을 받는다.
// 🔴 2026-10-23 운영 DB에 한 번 실행함(1,028건 · A 37 · B 51 · C 940). 기록 보관용 — 다시 돌리지 말 것.
// 기본은 드라이런(읽기만). 실제로 바꾸려면 --write. 바꾸기 전 값은 BACKUP(학생 이름이 들어 있어 저장소 밖),
// 되돌리기는 revert-cleanup-stale-enrollment-consultations.cjs.
// set -a; . D:/eywa_refactoring/.env.local; set +a; node scripts/_oneoff/cleanup-stale-enrollment-consultations.cjs [--write]
const fs = require("fs");
const { createRequire } = require("module");
const req = createRequire("D:/eywa_refactoring/package.json");
const postgres = req("postgres");
const WRITE = process.argv.includes("--write");
const ACTOR = "자료 정리(장기 미결 상담 · 2026-10-23)";
const VIA = "scripts/_oneoff/cleanup-stale-enrollment-consultations.cjs";
const BACKUP = process.env.STALE_CLEANUP_BACKUP ?? "D:/tmp/enrollment-stale-cleanup-2026-10-23/backup.json";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });

(async () => {
  const [{ id: T }] = await sql`select id from tenants where slug = 'cs'`;
  const today = (await sql`select (now() at time zone 'Asia/Seoul')::date::text d`)[0].d;
  const rows = await sql`
    with s as (
      select ec.id, ec.prospect_name, ec.prospect_school, ec.subject, ec.student_id, ec.outcome::text outcome, ec.updated_at::text updated_at_txt,
        (ec.consulted_at at time zone 'Asia/Seoul')::date consulted_on,
        (ec.subject ~* '(수학|math|매쓰몽|영수|영\\+수)') want_math,
        (ec.subject ~* '(영어|english|eie|영수|영\\+수)') want_eng
      from enrollment_consultations ec
      where ec.tenant_id = ${T} and ec.outcome::text in ('consulted','ai_done')
        and (ec.follow_up_date is null or ec.follow_up_date < ${today}::date)
        and (ec.consulted_at at time zone 'Asia/Seoul')::date < ${today}::date - 60)
    select s.*,
      (s.student_id is not null and exists (
        select 1 from enrollments e join classes c on c.id = e.class_id
        where e.student_id = s.student_id and e.start_date >= s.consulted_on - 30
          and (s.subject is null or (s.want_math and c.subject = 'math') or (s.want_eng and c.subject = 'english')))) a_hit,
      (select array_agg(st.id) from students st
        where s.student_id is null and st.tenant_id = ${T}
          and regexp_replace(coalesce(st.name,''), '[A-Za-z ]+$', '') = regexp_replace(coalesce(s.prospect_name,''), '[A-Za-z ]+$', '')
          and st.school is not distinct from s.prospect_school
          and st.enrolled_at between s.consulted_on - 30 and s.consulted_on + 120) b_ids
    from s order by s.consulted_on, s.id`;

  const plan = rows.map((r) => {
    const b = (r.b_ids ?? []).length;
    const cat = r.a_hit ? "A" : b === 1 ? "B" : "C";
    return {
      id: r.id, name: r.prospect_name, school: r.prospect_school, subject: r.subject, consultedOn: r.consulted_on.toISOString().slice(0, 10),
      from: r.outcome, to: cat === "C" ? "declined" : "enrolled", category: cat, updatedAt: r.updated_at_txt,
      evidence: cat === "A" ? { studentId: r.student_id } : cat === "B" ? { matchedStudentId: r.b_ids[0] } : b > 1 ? { sameNameSchoolNear: b } : null,
    };
  });
  const by = (k) => plan.reduce((m, p) => ((m[k(p)] = (m[k(p)] ?? 0) + 1), m), {});
  console.log("대상", plan.length, "· 분류", by((p) => p.category), "· 바뀌는 상태", by((p) => `${p.from}→${p.to}`));
  console.log("연도×분류", by((p) => `${p.consultedOn.slice(0, 4)} ${p.category}`));
  console.log("B 예시", plan.filter((p) => p.category === "B").slice(0, 5).map((p) => `${p.consultedOn} ${p.name} ${p.school ?? ""}`));
  console.log("C 중 같은 이름·학교 근처 여럿(애매)", plan.filter((p) => p.evidence?.sameNameSchoolNear).length);
  if (!WRITE) { await sql.end(); return; }

  fs.writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), tenant: "cs", actor: ACTOR, rows: plan }, null, 1), "utf8");
  console.log("되돌리기용 옛 값:", BACKUP);
  let done = 0;
  await sql.begin(async (tx) => {
    for (const p of plan) {
      // 그사이 사람이 고친 상담은 건너뛴다(updated_at이 조회 때와 같을 때만).
      const res = await tx`update public.enrollment_consultations set outcome = ${p.to}
        where id = ${p.id} and tenant_id = ${T} and outcome::text = ${p.from} and updated_at::text = ${p.updatedAt}`;
      if (res.count !== 1) { console.log("건너뜀(바뀜):", p.id); continue; }
      await tx`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${T}, null, ${ACTOR}, 'enrollment_consultation_outcome', 'enrollment_consultations', ${p.name ?? "상담"},
          ${tx.json({ consultationId: p.id, from: p.from, to: p.to, via: VIA, category: p.category, evidence: p.evidence,
            reason: p.category === "A" ? "이어진 원생이 그 과목 반 수강을 시작함" : p.category === "B" ? "이름·학교가 같은 원생이 상담 뒤 등록함(1명)" : "60일 넘게 결정·다음 상담 없음 — 등록 근거 없음" })})`;
      done++;
    }
  });
  console.log("바꿈", done, "/", plan.length);
  await sql.end();
})().catch(async (e) => { console.error("실패(되돌려짐):", e.message); await sql.end(); process.exit(1); });
