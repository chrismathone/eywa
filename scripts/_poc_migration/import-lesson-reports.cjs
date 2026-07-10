// import-lesson-reports.cjs — Edutrix(reports) → eywa lesson_reports 이식(멱등).
// ⚠️ 매칭 키 = Edutrix students.id → students.edutrix_student_id (UUID). 이름 fan-out 금지(0094a).
// 선행: map-edutrix-students.cjs 로 edutrix_student_id 백필(또는 --map 동시 실행).
// 멱등: edutrix_import 삭제 후 edutrix_report_id 기준 재삽입(또는 이미 있는 report id 스킵).
// 실행: node --env-file=.env.local scripts/_poc_migration/import-lesson-reports.cjs [--map] [--dry]
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // injaewon
const PER_STUDENT = 12; // 학생당 최근 보고서 수(상세 '진도' 탭용)
const args = new Set(process.argv.slice(2));
const DO_MAP = args.has("--map");
const DRY = args.has("--dry");

function extractTeacher(className) {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex = { 김정은: "김은정" };
  return ex[first] || first || null;
}

function schoolGradeKey(school, grade) {
  return `${(school ?? "").trim()}|${(grade ?? "").trim()}`;
}

function pickEywa(edu, candidates) {
  if (candidates.length === 0) return { kind: "none", reason: "no_name_match" };
  if (candidates.length === 1) return { kind: "mapped", eywaId: candidates[0].id, reason: "unique_name" };
  const sg = schoolGradeKey(edu.school, edu.grade);
  if (sg !== "|") {
    const bySg = candidates.filter((c) => schoolGradeKey(c.school, c.grade) === sg);
    if (bySg.length === 1) return { kind: "mapped", eywaId: bySg[0].id, reason: "school_grade" };
    if (bySg.length > 1) {
      const active = bySg.filter((c) => c.status === "enrolled" || c.status === "on_hold");
      if (active.length === 1) return { kind: "mapped", eywaId: active[0].id, reason: "school_grade_enrolled" };
      return { kind: "ambiguous", reason: "school_grade_multi", ids: bySg.map((c) => c.id) };
    }
  }
  const active = candidates.filter((c) => c.status === "enrolled" || c.status === "on_hold");
  if (active.length === 1) return { kind: "mapped", eywaId: active[0].id, reason: "enrolled_only" };
  return { kind: "ambiguous", reason: "multi_name", ids: candidates.map((c) => c.id) };
}

function normName(s) {
  return String(s).replace(/\s+/g, "").toLowerCase();
}

(async () => {
  const { EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY, DATABASE_URL } = process.env;
  if (!EDUTRIX_SUPABASE_URL || !EDUTRIX_SUPABASE_ANON_KEY) {
    throw new Error("EDUTRIX_SUPABASE_URL / EDUTRIX_SUPABASE_ANON_KEY 없음");
  }
  const edu = createClient(EDUTRIX_SUPABASE_URL, EDUTRIX_SUPABASE_ANON_KEY);
  const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
  const PAGE = 1000;

  // ── 1) 선택: Edutrix 학생 → eywa edutrix_student_id 백필 ──
  if (DO_MAP) {
    const eduStudents = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await edu
        .from("students")
        .select("id, name, school, grade, class_note_submission_name")
        .range(from, from + PAGE - 1);
      if (error) throw new Error("edutrix students: " + error.message);
      if (!data?.length) break;
      eduStudents.push(...data);
      if (data.length < PAGE) break;
    }
    const eywa = await sql`
      select id, name, school, grade, status, edutrix_student_id, classnote_name
      from students where tenant_id = ${TENANT}
    `;
    const byName = new Map();
    for (const s of eywa) {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(s);
    }
    const takenEywa = new Set(eywa.filter((s) => s.edutrix_student_id).map((s) => s.id));
    const takenEdu = new Set(eywa.filter((s) => s.edutrix_student_id).map((s) => s.edutrix_student_id));

    let mapped = 0;
    let skipped = 0;
    let ambiguous = 0;
    let none = 0;
    const ambList = [];

    for (const es of eduStudents) {
      if (takenEdu.has(es.id)) {
        skipped++;
        continue;
      }
      let candidates = byName.get(es.name) || [];
      // exact 0이면 정규화 폴백(백필만)
      if (candidates.length === 0) {
        const n = normName(es.name);
        candidates = eywa.filter((s) => !s.edutrix_student_id && normName(s.name) === n);
      } else {
        candidates = candidates.filter((c) => !c.edutrix_student_id);
      }
      // 이미 다른 edutrix에 묶인 eywa 제외
      candidates = candidates.filter((c) => !takenEywa.has(c.id) || !c.edutrix_student_id);

      const pick = pickEywa(es, candidates);
      if (pick.kind === "mapped") {
        if (takenEywa.has(pick.eywaId)) {
          ambiguous++;
          ambList.push({ edu: es.name, reason: "eywa_already_mapped", eywaId: pick.eywaId });
          continue;
        }
        if (!DRY) {
          await sql`
            update students
            set edutrix_student_id = ${es.id},
                classnote_name = coalesce(nullif(classnote_name, ''), ${es.class_note_submission_name || null})
            where id = ${pick.eywaId} and tenant_id = ${TENANT} and edutrix_student_id is null
          `;
        }
        takenEywa.add(pick.eywaId);
        takenEdu.add(es.id);
        mapped++;
      } else if (pick.kind === "ambiguous") {
        ambiguous++;
        ambList.push({ edu: es.name, eduId: es.id, school: es.school, grade: es.grade, reason: pick.reason, ids: pick.ids });
      } else {
        none++;
      }
    }
    console.log("[map]", { mapped, skippedAlready: skipped, ambiguous, none, dry: DRY });
    if (ambList.length) {
      console.log("[map] ambiguous sample:", JSON.stringify(ambList.slice(0, 20), null, 0));
    }
  }

  // ── 2) UUID 맵 로드 ──
  const mappedStudents = await sql`
    select id, edutrix_student_id from students
    where tenant_id = ${TENANT} and edutrix_student_id is not null
  `;
  const byEdutrixId = new Map(mappedStudents.map((s) => [s.edutrix_student_id, s.id]));
  console.log("eywa students with edutrix_student_id:", byEdutrixId.size);
  if (byEdutrixId.size === 0) {
    if (DRY) {
      console.log("dry-run: DB 매핑 0(미기록). --map 없이 dry면 import 시뮬레이션 생략. 실적용: --map 후 본 이관.");
      await sql.end();
      return;
    }
    throw new Error("edutrix_student_id 매핑 0건 — 먼저 --map 실행 필요");
  }

  // ── 3) Edutrix reports (student_id UUID 포함) — 학생당 최근 N건 ──
  // name 키잉 제거. edutrix student uuid → eywa id.
  const byEduStudent = new Map(); // edutrixStudentId -> [{reportId, date, ...}]
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await edu
      .from("reports")
      .select("id, date, student_id, progress, exam_info, assignment_score, classes(name)")
      .order("date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("edutrix reports: " + error.message);
    if (!data?.length) break;
    for (const row of data) {
      const eduSid = row.student_id;
      if (!eduSid) continue;
      const arr = byEduStudent.get(eduSid) ?? byEduStudent.set(eduSid, []).get(eduSid);
      if (arr.length >= PER_STUDENT) continue;
      const c = row.classes;
      const cname = Array.isArray(c) ? c[0]?.name : c?.name;
      arr.push({
        reportId: row.id,
        date: row.date,
        progress: row.progress || null,
        exam_info: row.exam_info || null,
        homework: row.assignment_score || null,
        teacher: extractTeacher(cname || null),
      });
    }
    if (data.length < PAGE) break;
  }
  console.log("edutrix students with reports (capped per student):", byEduStudent.size);

  // ── 4) 행 조립 — UUID만, 1 report → 1 eywa student ──
  const rows = [];
  let matchedStudents = 0;
  let unmatchedStudents = 0;
  for (const [eduSid, reps] of byEduStudent) {
    const eywaId = byEdutrixId.get(eduSid);
    if (!eywaId) {
      unmatchedStudents++;
      continue;
    }
    matchedStudents++;
    for (const rep of reps) {
      rows.push({
        tenant_id: TENANT,
        student_id: eywaId,
        report_date: rep.date,
        progress: rep.progress,
        exam_info: rep.exam_info,
        homework_score: rep.homework,
        teacher_name: rep.teacher,
        source: "edutrix_import",
        edutrix_report_id: rep.reportId,
      });
    }
  }
  console.log({ matchedStudents, unmatchedStudents, rows: rows.length, dry: DRY });

  if (DRY) {
    await sql.end();
    console.log("dry-run — no write");
    return;
  }

  // ── 5) 멱등 재적재 (이관분만) ──
  await sql`alter table lesson_reports disable trigger tg_log_activity_id`;
  await sql`alter table lesson_reports disable trigger tg_log_activity_u`;
  try {
    await sql`delete from lesson_reports where tenant_id = ${TENANT} and source = 'edutrix_import'`;
    for (let i = 0; i < rows.length; i += 500) {
      await sql`insert into lesson_reports ${sql(rows.slice(i, i + 500))}`;
    }
  } finally {
    await sql`alter table lesson_reports enable trigger tg_log_activity_id`;
    await sql`alter table lesson_reports enable trigger tg_log_activity_u`;
  }
  console.log("inserted edutrix_import rows:", rows.length);
  await sql.end();
})().catch((e) => {
  console.error("ERR", e.message || e);
  process.exit(1);
});
