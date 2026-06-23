// import-lesson-reports.cjs — ijw Edutrix(reports) → eywa lesson_reports 이식(멱등).
// ijw 시간표 학생 hover의 "[진도]" 줄 + 학생 상세 '진도' 탭(최근 N건)을 eywa에서 재현하기 위한 데이터 이식.
// 출처: ijw .env.local의 Edutrix Supabase(reports 테이블, anon read). 매칭: 학생 '이름'(ijw 자체도 이름 키잉).
// 학생당 '최근 N건'(date desc). 실행: node --env-file=.env.local scripts/_poc_migration/import-lesson-reports.cjs
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // ijw-demo
const PER_STUDENT = 12; // 학생당 최근 보고서 수(상세 '진도' 탭용 — hover는 진도 있는 최신 1건만 사용)

function parseEnv(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
}
function extractTeacher(className) {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex = { 김정은: "김은정" };
  return ex[first] || first || null;
}

(async () => {
  const ijwEnv = parseEnv("D:/ijw-calander/.env.local");
  const edu = createClient(ijwEnv.VITE_SUPABASE_URL, ijwEnv.VITE_SUPABASE_ANON_KEY);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

  // 1) Edutrix: 학생(이름)당 최근 N건 — date desc 페이지네이션(1000행 한도 회피).
  const byNameRep = new Map(); // name -> [{date, progress, exam_info, homework, teacher}]
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await edu
      .from("reports")
      .select("date, progress, exam_info, assignment_score, students(name), classes(name)")
      .order("date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("edutrix: " + error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const name = row.students?.name;
      if (!name) continue;
      const arr = byNameRep.get(name) ?? byNameRep.set(name, []).get(name);
      if (arr.length >= PER_STUDENT) continue;
      arr.push({
        date: row.date,
        progress: row.progress || null,
        exam_info: row.exam_info || null,
        homework: row.assignment_score || null,
        teacher: extractTeacher(row.classes?.name || null),
      });
    }
    if (data.length < PAGE) break;
  }
  console.log("edutrix students with reports:", byNameRep.size);

  // 2) eywa 학생 이름 → id(들)
  const students = await sql`select id, name from students where tenant_id = ${TENANT}`;
  const byName = new Map();
  for (const s of students) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)).push(s.id);

  // 3) 멱등 재적재
  await sql`delete from lesson_reports where tenant_id = ${TENANT} and source = 'edutrix_import'`;
  const rows = [];
  let matchedNames = 0;
  for (const [name, reps] of byNameRep) {
    const ids = byName.get(name);
    if (!ids) continue;
    matchedNames++;
    for (const sid of ids) {
      for (const rep of reps) {
        rows.push({
          tenant_id: TENANT,
          student_id: sid,
          report_date: rep.date,
          progress: rep.progress,
          exam_info: rep.exam_info,
          homework_score: rep.homework,
          teacher_name: rep.teacher,
          source: "edutrix_import",
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    await sql`insert into lesson_reports ${sql(rows.slice(i, i + 500))}`;
  }
  console.log("matched names:", matchedNames, "/ edutrix", byNameRep.size, "· inserted rows:", rows.length, "· eywa students:", students.length);
  await sql.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
