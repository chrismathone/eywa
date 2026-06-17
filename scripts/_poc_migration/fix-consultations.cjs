// 데모 student_consultations 데이터 결함 일회성 패치.
// 원인: run.ts 구버전이 소스 필드를 잘못 매핑 → summary 전부 "(내용 없음)", category 전부 "parent",
//       audience/subject/follow_up 전무. 소스 JSON을 다시 읽어 기존 행을 (학생+날짜) 기준으로 재조인해
//       category/subject/audience/summary/follow_up_* 컬럼만 패치한다(id·counselor_id·created_at 보존).
// 사용: node scripts/_poc_migration/fix-consultations.cjs           (dry-run, 쓰기 없음)
//       node scripts/_poc_migration/fix-consultations.cjs --apply   (실제 UPDATE)
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";

let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}
if (!url) throw new Error("DATABASE_URL not found");

const TMP = "D:/tmp";
const f = fs.readdirSync(TMP).filter((x) => x.startsWith("ijw-export-") && x.endsWith(".json")).sort().pop();
const C = JSON.parse(fs.readFileSync(path.join(TMP, f), "utf8")).collections;
const SRC = C.student_consultations || [];

const normName = (s) => (s ?? "").replace(/\s+/g, "").toLowerCase();
const normDate = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const SUBJ = { english: "영어", math: "수학", korean: "국어", science: "과학" };
const mapSubject = (s) => (s && String(s).trim() ? SUBJ[String(s).trim().toLowerCase()] ?? String(s).trim() : null);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key3 = (name, grade, school) => `${normName(name)}|${(grade ?? "").toString().trim()}|${(school ?? "").toString().trim()}`;

const sql = postgres(url, { prepare: false, max: 3 });

(async () => {
  try {
    // 1) eywa 데모 학생 → (이름,학년,학교) 키 맵 (재원 우선)
    const students = await sql`select id, name, grade, school, status from students where tenant_id=${TENANT}`;
    const stuMap = new Map(); // key3 → [id...] (non-withdrawn first)
    for (const s of students) {
      const k = key3(s.name, s.grade, s.school);
      if (!stuMap.has(k)) stuMap.set(k, []);
      if (s.status === "withdrawn") stuMap.get(k).push(s.id);
      else stuMap.get(k).unshift(s.id);
    }

    // 1b) 소스 students: Firebase id → (이름,학년,학교) 키 (eywa 학생을 시드한 바로 그 레코드)
    //     상담의 denormalized name/grade/school은 드리프트가 커서, 학생 id로 소스 학생을 거쳐 매칭한다.
    const fbToKey = new Map();
    for (const s of C.students || []) fbToKey.set(s.id, key3(s.name, s.grade, s.school));

    // 2) 소스 상담 → (학생uuid|날짜) 그룹별 패치 목록
    const patchByGroup = new Map();
    let srcMatched = 0, srcUnmatched = 0;
    for (const k of SRC) {
      const lookupKey = (k.studentId && fbToKey.has(k.studentId))
        ? fbToKey.get(k.studentId)
        : key3(k.studentName, k.grade, k.school); // studentId 없으면 상담 denorm 필드로 폴백
      const ids = stuMap.get(lookupKey);
      const date = normDate(k.date);
      if (!ids || !ids.length || !date) { srcUnmatched++; continue; }
      srcMatched++;
      const uuid = ids[0];
      const summary = k.content && String(k.content).trim() ? String(k.content).trim() : "(내용 없음)";
      const category = k.category && String(k.category).trim() ? String(k.category).trim() : "general";
      const audience = k.type && String(k.type).trim() ? String(k.type).trim() : null;
      const subject = mapSubject(k.subject);
      const followAction = k.followUpNotes && String(k.followUpNotes).trim() ? String(k.followUpNotes).trim() : null;
      const followDone = !!k.followUpDone;
      const followDate = k.followUpNeeded && !followDone ? addDays(date, 7) : null;
      const g = `${uuid}|${date}`;
      if (!patchByGroup.has(g)) patchByGroup.set(g, []);
      patchByGroup.get(g).push({ summary, category, audience, subject, followAction, followDone, followDate });
    }

    // 3) eywa 데모 상담 행 → (학생uuid|날짜) 그룹 (id 순서 안정)
    const rows = await sql`
      select id, student_id, to_char(consulted_at,'YYYY-MM-DD') cdate
      from student_consultations where tenant_id=${TENANT}
      order by student_id, consulted_at, created_at, id`;
    const rowsByGroup = new Map();
    for (const r of rows) {
      const g = `${r.student_id}|${r.cdate}`;
      if (!rowsByGroup.has(g)) rowsByGroup.set(g, []);
      rowsByGroup.get(g).push(r.id);
    }

    // 4) 그룹별 zip → 패치 계획
    const plan = []; // {id, ...patch}
    for (const [g, ids] of rowsByGroup) {
      const patches = patchByGroup.get(g) || [];
      for (let i = 0; i < ids.length; i++) {
        const p = patches[i] ?? patches[patches.length - 1];
        if (p) plan.push({ id: ids[i], ...p });
      }
    }

    // 5) 예상 결과 통계
    const projCat = {};
    let projEmpty = 0, projFollowDate = 0, projAudience = 0;
    for (const p of plan) {
      projCat[p.category] = (projCat[p.category] || 0) + 1;
      if (p.summary === "(내용 없음)") projEmpty++;
      if (p.followDate) projFollowDate++;
      if (p.audience) projAudience++;
    }
    console.log("=== fix-consultations", APPLY ? "[APPLY]" : "[DRY-RUN]", "===");
    console.log("source consults:", SRC.length, "| matched to student:", srcMatched, "| unmatched:", srcUnmatched);
    console.log("eywa rows:", rows.length, "| rows in plan (will patch):", plan.length, "| rows left unpatched:", rows.length - plan.length);
    console.log("projected category:", JSON.stringify(projCat));
    console.log("projected empty summary:", projEmpty, "| follow_up_date set:", projFollowDate, "| audience set:", projAudience);

    if (!APPLY) {
      console.log("\n[DRY-RUN] 쓰기 없음. 실제 적용은 --apply 플래그.");
      // 샘플 3건 before/after
      const sample = plan.slice(0, 3);
      for (const p of sample) {
        const [b] = await sql`select category, left(summary,40) summary, audience from student_consultations where id=${p.id}`;
        console.log("\nrow", p.id);
        console.log("  before:", JSON.stringify(b));
        console.log("  after :", JSON.stringify({ category: p.category, summary: p.summary.slice(0, 40), audience: p.audience }));
      }
      return;
    }

    // 6) 적용 (배치 UPDATE)
    let done = 0;
    for (const p of plan) {
      await sql`update student_consultations set
        category=${p.category}, subject=${p.subject}, audience=${p.audience},
        summary=${p.summary}, follow_up_action=${p.followAction},
        follow_up_done=${p.followDone}, follow_up_date=${p.followDate}, updated_at=now()
        where id=${p.id} and tenant_id=${TENANT}`;
      if (++done % 200 === 0) console.log("  patched", done, "/", plan.length);
    }
    // 잔여 스윕: 매칭 안 된 행에 남은 잘못된 category='parent'를 일반(general)으로 정리(깨진 값 제거).
    const swept = await sql`update student_consultations set category='general', updated_at=now()
      where tenant_id=${TENANT} and category='parent'`;
    console.log("APPLIED", done, "row updates. residual 'parent'→'general' swept:", swept.count);
  } catch (e) {
    console.error("ERR", e.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
