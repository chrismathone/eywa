// scripts/_edutrix_retire/full-import-reports.cjs — Edutrix reports → aywa lesson_reports **풀 이력** 이전.
//
// Edutrix 완전 종료(2026-07-10 결정) 대비 운영 반영: 기존 이관(최근 12건/학생 cap·얇은 필드)을
// UUID 매핑(0094a) 기반 풀 이력·리치 필드로 승격. 삭제 없음(progress_entries FK 보호) — 2-pass:
//   Pass1 UPDATE: 기존 source='edutrix_import' 행(edutrix_report_id 매치)에 리치 필드 보강 + 내용 refresh
//                 (Edutrix가 원본 — cron이 "수정 전파 안 됨" 한계도 여기서 해소)
//   Pass2 INSERT: aywa에 없는 원본 행 전부(매핑 학생만 — 미매핑 189건은 edutrix_archive가 보존)
// 필드 매핑: textbook_name→textbook · study_attitude→attitude · notice(AI 학부모 멘트)→notes ·
//   homework_today→homework_today(0096a) · makeup_class→makeup(truthy) · classnote_sent_at→
//   classnote_sent_at + status='success'(발송 사실 이관 — 원장 화면 "미발송" 오인 해소).
//   lateness·graph_eval 등 나머지는 아카이브(edutrix_archive) 보존(운영 컬럼 없음).
// subject는 관례대로 NULL 유지(발송 게이트가 NULL 거부 = P0-2, 조회는 math에 NULL 포함 설계).
//
// 실행: node --env-file=.env.local scripts/_edutrix_retire/full-import-reports.cjs        # dry-run
//       node --env-file=.env.local scripts/_edutrix_retire/full-import-reports.cjs --apply
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");
const CHUNK = 500;

// Edutrix class_name 첫 토큰 = 담당 강사 (기존 이관·cron과 동일 규칙 유지)
function extractTeacher(className) {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex = { 김정은: "김은정" };
  return ex[first] || first || null;
}

async function fetchAllPaged(q, page = 1000) {
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await q(from, from + page - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return rows;
}

(async () => {
  const { EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY, DATABASE_URL } = process.env;
  if (!EDUTRIX_SUPABASE_URL || !EDUTRIX_SUPABASE_ANON_KEY || !DATABASE_URL) {
    throw new Error("EDUTRIX_SUPABASE_URL / EDUTRIX_SUPABASE_ANON_KEY / DATABASE_URL 필요 (--env-file=.env.local)");
  }
  const edu = createClient(EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY);
  const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

  console.log(`[full-import] mode=${APPLY ? "APPLY" : "dry-run"}`);

  // ① 원본 전량 + aywa 매핑
  const [eduReports, students, existing] = await Promise.all([
    fetchAllPaged((a, b) =>
      edu
        .from("reports")
        .select(
          "id, date, student_id, progress, exam_info, assignment_score, textbook_name, study_attitude, notice, homework_today, makeup_class, classnote_sent_at, classes(name)",
        )
        .order("date", { ascending: true })
        .range(a, b),
    ),
    sql`select id, edutrix_student_id from students where tenant_id = ${TENANT} and edutrix_student_id is not null`,
    sql`select id, edutrix_report_id from lesson_reports where tenant_id = ${TENANT} and source = 'edutrix_import' and edutrix_report_id is not null`,
  ]);
  const stuByEdu = new Map(students.map((s) => [s.edutrix_student_id, s.id]));
  const existingByRep = new Map(existing.map((r) => [r.edutrix_report_id, r.id]));
  console.log(`원본 ${eduReports.length} · 매핑 학생 ${stuByEdu.size} · 기존 이관 ${existingByRep.size}`);

  const toRow = (rep) => ({
    edutrix_report_id: rep.id,
    student_id: stuByEdu.get(rep.student_id) ?? null,
    report_date: rep.date,
    progress: rep.progress || null,
    exam_info: rep.exam_info || null,
    homework_score: rep.assignment_score || null,
    teacher_name: extractTeacher(rep.classes?.name ?? null),
    textbook: rep.textbook_name || null,
    attitude: rep.study_attitude || null,
    notes: rep.notice || null,
    homework_today: rep.homework_today || null, // 오늘 과제(0096a)
    makeup: !!rep.makeup_class,
    classnote_sent_at: rep.classnote_sent_at || null,
  });

  const updates = [];
  const inserts = [];
  let unmapped = 0;
  for (const rep of eduReports) {
    const row = toRow(rep);
    if (!row.student_id) {
      unmapped++;
      continue; // 미매핑 → 아카이브(archive-edutrix.cjs)가 원본 보존
    }
    if (existingByRep.has(rep.id)) updates.push(row);
    else inserts.push(row);
  }
  const sentCount = [...updates, ...inserts].filter((r) => r.classnote_sent_at).length;
  console.log(`계획: UPDATE ${updates.length} · INSERT ${inserts.length} · 미매핑 skip ${unmapped} · 발송사실 이관 ${sentCount}`);
  console.log(`샘플 INSERT:`, JSON.stringify(inserts[0] ?? null).slice(0, 300));

  if (!APPLY) {
    console.log("[dry-run] 쓰기 없음 — --apply로 실행");
    await sql.end();
    return;
  }

  // ② 벌크 동안만 활동로그 트리거 끔(시스템 이관이 ~2만 행 noise를 쏟는 것 방지 — import-lesson-reports 선례)
  await sql`alter table lesson_reports disable trigger tg_log_activity_id`;
  await sql`alter table lesson_reports disable trigger tg_log_activity_u`;
  try {
    // Pass1 — temp table **청크 순환**(스테이징→UPDATE→truncate). 단일 대형 UPDATE는 풀 이력(1.6만 행)
    // 규모에서 statement timeout에 걸림(2026-07-10 실측) — 청크당 짧은 문장으로 분할.
    await sql`create temp table _edutrix_imp (
      edutrix_report_id text primary key, progress text, exam_info text, homework_score text,
      teacher_name text, textbook text, attitude text, notes text, homework_today text,
      makeup boolean, classnote_sent_at timestamptz
    )`;
    let updatedTotal = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const c = updates.slice(i, i + CHUNK).map(({ student_id: _sid, report_date: _rd, ...rest }) => rest);
      await sql`truncate _edutrix_imp`;
      await sql`insert into _edutrix_imp ${sql(c)}`;
      const updated = await sql`
        update lesson_reports lr set
          progress = v.progress, exam_info = v.exam_info, homework_score = v.homework_score,
          teacher_name = v.teacher_name, textbook = v.textbook, attitude = v.attitude,
          notes = v.notes, homework_today = v.homework_today, makeup = v.makeup,
          classnote_sent_at = coalesce(v.classnote_sent_at, lr.classnote_sent_at),
          classnote_status = case when v.classnote_sent_at is not null then 'success' else lr.classnote_status end
        from _edutrix_imp v
        where lr.tenant_id = ${TENANT} and lr.source = 'edutrix_import' and lr.edutrix_report_id = v.edutrix_report_id
        returning lr.id`;
      updatedTotal += updated.length;
      process.stdout.write(`\rPass1 UPDATE ${Math.min(i + CHUNK, updates.length)}/${updates.length} (적용 ${updatedTotal})`);
    }
    console.log(`\nPass1 UPDATE 적용 ${updatedTotal}행`);
    // Pass2 — INSERT (신규만; 유니크 인덱스(edutrix_report_id)가 이중 방어)
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const c = inserts.slice(i, i + CHUNK).map((r) => ({
        tenant_id: TENANT,
        student_id: r.student_id,
        report_date: r.report_date,
        progress: r.progress,
        exam_info: r.exam_info,
        homework_score: r.homework_score,
        teacher_name: r.teacher_name,
        textbook: r.textbook,
        attitude: r.attitude,
        notes: r.notes,
        homework_today: r.homework_today,
        makeup: r.makeup,
        source: "edutrix_import",
        edutrix_report_id: r.edutrix_report_id,
        classnote_sent_at: r.classnote_sent_at,
        classnote_status: r.classnote_sent_at ? "success" : null,
      }));
      await sql`insert into lesson_reports ${sql(c)} on conflict do nothing`;
      process.stdout.write(`\rPass2 INSERT ${Math.min(i + CHUNK, inserts.length)}/${inserts.length}`);
    }
    console.log();
  } finally {
    await sql`alter table lesson_reports enable trigger tg_log_activity_id`;
    await sql`alter table lesson_reports enable trigger tg_log_activity_u`;
  }

  // ③ 사후 카운트
  const [{ total }] = await sql`select count(*)::int as total from lesson_reports where tenant_id = ${TENANT} and source = 'edutrix_import'`;
  const [{ sent }] = await sql`select count(*)::int as sent from lesson_reports where tenant_id = ${TENANT} and source = 'edutrix_import' and classnote_status = 'success'`;
  console.log(`완료: edutrix_import 총 ${total}행 · 발송사실(success) ${sent}행`);
  await sql.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
