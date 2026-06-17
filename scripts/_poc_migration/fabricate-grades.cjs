// 데모 성적(student_grades) 합성 — 소스에 성적 데이터가 없어 시연용으로 생성.
// 각 enrolled 학생의 실제 수강 과목(enrollments→classes.subject)에 맞춰 최근 5개 시험을
// 결정적(deterministic) 점수로 생성. 멱등: 테넌트 기존 성적 삭제 후 재삽입.
// 사용: node scripts/_poc_migration/fabricate-grades.cjs [--apply]
const fs = require("fs");
const { randomUUID } = require("node:crypto");
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");
const T = "becaa316-e636-42e9-9d09-08b133e0b094";
let url = process.env.DATABASE_URL;
if (!url) { const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8"); url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, ""); }
const sql = postgres(url, { prepare: false, max: 3 });

const KNOWN = new Set(["math", "english", "korean", "science", "arts"]);
const normSubject = (s) => (s === "highmath" ? "math" : s); // 라벨맵에 highmath 없음 → 수학으로
const EXAMS = [
  { date: "2026-02-20", name: "2월 진단평가" },
  { date: "2026-03-21", name: "3월 모의고사" },
  { date: "2026-04-25", name: "중간고사" },
  { date: "2026-05-23", name: "5월 모의고사" },
  { date: "2026-06-13", name: "기말고사" },
];
// 결정적 RNG (student+subject 시드)
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

(async () => {
  try {
    const students = await sql`select id from students where tenant_id=${T} and status='enrolled'`;
    const sids = new Set(students.map((s) => s.id));
    // 과목: 모든 enrollment(활성 우선 아님)에서 학생→과목 집합
    const enr = await sql`select e.student_id, c.subject from enrollments e
      join classes c on c.id=e.class_id where e.tenant_id=${T} and c.subject is not null`;
    const subjOf = new Map();
    for (const e of enr) {
      if (!sids.has(e.student_id)) continue;
      const s = normSubject(e.subject);
      if (!KNOWN.has(s)) continue;
      if (!subjOf.has(e.student_id)) subjOf.set(e.student_id, new Set());
      subjOf.get(e.student_id).add(s);
    }
    const rows = [];
    for (const sid of sids) {
      const subjects = subjOf.get(sid) ? [...subjOf.get(sid)] : ["math"]; // 과목 미파악 시 수학 폴백
      for (const subject of subjects) {
        const r = rng(sid + "|" + subject);
        const base = 62 + Math.floor(r() * 28); // 62~89 기준선
        const trend = r() < 0.5 ? -1 : 1.5; // 완만한 상승/하락
        EXAMS.forEach((ex, i) => {
          let sc = Math.round(base + trend * i + (r() * 12 - 6)); // 추세 + 노이즈
          sc = Math.max(45, Math.min(100, sc));
          rows.push({ id: randomUUID(), tenant_id: T, student_id: sid, exam_name: ex.name, subject, score: sc, max_score: 100, taken_on: ex.date, notes: null, created_by: null });
        });
      }
    }
    console.log("=== fabricate-grades", APPLY ? "[APPLY]" : "[DRY-RUN]", "===");
    console.log("enrolled:", sids.size, "| students w/ derived subject:", subjOf.size, "| grade rows to insert:", rows.length);
    if (!APPLY) { console.log("[DRY-RUN] 쓰기 없음. --apply 로 적용."); return; }
    const del = await sql`delete from student_grades where tenant_id=${T}`;
    console.log("deleted existing grades:", del.count);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await sql`insert into student_grades ${sql(chunk)}`;
      console.log("  inserted", Math.min(i + 500, rows.length), "/", rows.length);
    }
    console.log("APPLIED grade rows:", rows.length);
  } catch (e) { console.error("ERR", e.message); process.exitCode = 1; }
  finally { await sql.end(); }
})();
