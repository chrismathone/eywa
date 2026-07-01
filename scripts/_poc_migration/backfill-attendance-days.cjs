/*
 * backfill-attendance-days.cjs — ijw 익스포트의 '분리등원'(월목 반의 월-only 학생) 요일을 eywa로 백필.
 *
 * ijw: students[].enrollments[].attendanceDays (한글 요일 sparse 배열, 빈값=전 요일 등원).
 *   같은 (학생,반)에 요일별 복수 enrollment가 있을 수 있어(예: 권영준 고등M TP4E = ['화']+['금']) → 요일 합집합.
 * eywa: enrollments.attendance_days text[] (요일 enum, 빈 배열=전 요일). schema.ts.
 *   → (학생,반)당 단일 enrollment로 정규화되어 있으므로, 합집합을 그 반 스케줄 요일과 교집합해 넣는다.
 *   합집합이 그 반 전 스케줄 요일을 덮으면(=분리등원 아님) 스킵(sparse 유지, 재스케줄에 강건).
 *
 * 매칭(자연키 — IdMap 미영속): 학생=name(중복 시 school+grade) / 반=className|||subject (highmath→subject_1).
 * 활성(end_date IS NULL) enrollment만 대상(시간표는 활성만 표시).
 *
 * 멱등(UPDATE). 기본 DRY-RUN(통계만), --apply로 반영. 재임포트 시 재실행(멱등).
 *   node --env-file=.env.local scripts/_poc_migration/backfill-attendance-days.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const TMP = "D:/tmp";
const EXPORT = path.join(TMP, fs.readdirSync(TMP).filter((x) => x.startsWith("ijw-export-") && x.endsWith(".json")).sort().pop());
const APPLY = process.argv.includes("--apply");

const DAY_MAP = { "월": "mon", "화": "tue", "수": "wed", "목": "thu", "금": "fri", "토": "sat", "일": "sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const asDocs = (c) => (Array.isArray(c) ? c : c && c.docs ? c.docs : Object.values(c));
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

(async () => {
  const j = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
  const ijwStudents = asDocs(j.collections.students).map((d) => d.data || d);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const stats = {
    ijwSplitPairs: 0, // ijw 소스의 (학생,반) 분리등원 후보(합집합 nonempty)
    studentMiss: 0, studentAmbig: 0, classMiss: [], noActiveEnrollment: 0,
    coversAllSkipped: 0, // 합집합이 전 요일 덮어 스킵
    queued: 0, samples: [],
  };
  const updates = [];

  try {
    const tenantRow = await sql`select tenant_id from classes group by tenant_id order by count(*) desc limit 1`;
    const tenantId = tenantRow[0].tenant_id;

    // eywa 반 (className|||subject → id)
    const eClasses = await sql`select id, class_name, subject from classes where tenant_id=${tenantId}`;
    const classByKey = new Map(eClasses.map((c) => [`${c.class_name}|||${c.subject}`, c.id]));

    // eywa 반별 스케줄 요일 집합
    const scheds = await sql`select class_id, day_of_week from class_schedules where tenant_id=${tenantId}`;
    const daysByClass = new Map();
    for (const s of scheds) {
      const set = daysByClass.get(s.class_id) ?? new Set();
      set.add(s.day_of_week);
      daysByClass.set(s.class_id, set);
    }

    // eywa 학생 (name → rows)
    const eStudents = await sql`select id, name, school, grade from students where tenant_id=${tenantId}`;
    const studByName = new Map();
    for (const s of eStudents) {
      const list = studByName.get(s.name) ?? [];
      list.push(s);
      studByName.set(s.name, list);
    }

    // eywa 활성 enrollment (student_id|class_id → enrollment id)
    const enr = await sql`select id, student_id, class_id from enrollments where tenant_id=${tenantId} and end_date is null`;
    const enrByPair = new Map();
    for (const e of enr) enrByPair.set(`${e.student_id}|${e.class_id}`, e.id);

    for (const s of ijwStudents) {
      if (!s.name || !Array.isArray(s.enrollments)) continue;

      // (className,subject)별 attendanceDays 합집합
      const byClass = new Map(); // key `${className}|||${subject}` → Set(한글요일)
      for (const e of s.enrollments) {
        if (!Array.isArray(e.attendanceDays) || e.attendanceDays.length === 0) continue;
        const subject = e.subject === "highmath" ? "subject_1" : (e.subject ?? "other");
        const key = `${e.className}|||${subject}`;
        const set = byClass.get(key) ?? new Set();
        for (const d of e.attendanceDays) set.add(d);
        byClass.set(key, set);
      }
      if (byClass.size === 0) continue;

      // 학생 매칭(name, 중복 시 school+grade)
      const cands = studByName.get(s.name) ?? [];
      let stu = null;
      if (cands.length === 1) stu = cands[0];
      else if (cands.length > 1) {
        stu = cands.find((x) => (x.school ?? "") === (s.school ?? "") && (x.grade ?? "") === (s.grade ?? "")) ?? null;
        if (!stu) { stats.studentAmbig++; continue; }
      }
      if (!stu) { stats.studentMiss++; continue; }

      for (const [key, koSet] of byClass) {
        stats.ijwSplitPairs++;
        const classId = classByKey.get(key);
        if (!classId) { stats.classMiss.push(key); continue; }
        const enrollmentId = enrByPair.get(`${stu.id}|${classId}`);
        if (!enrollmentId) { stats.noActiveEnrollment++; continue; }

        const schedDays = daysByClass.get(classId) ?? new Set();
        // 한글→enum, 그 반 스케줄 요일과 교집합(재스케줄/오염 방어)
        const attend = [...koSet].map((k) => DAY_MAP[k]).filter((d) => d && schedDays.has(d));
        const attendSet = new Set(attend);
        if (attendSet.size === 0) continue; // 유효 요일 없음
        if (setEq(attendSet, schedDays)) { stats.coversAllSkipped++; continue; } // 전 요일 → 분리등원 아님(빈값 유지)

        const sorted = DAY_ORDER.filter((d) => attendSet.has(d));
        stats.queued++;
        if (stats.samples.length < 8) stats.samples.push({ student: s.name, class: key.split("|||")[0], attend: sorted, sched: DAY_ORDER.filter((d) => schedDays.has(d)) });
        updates.push(() => sql`update enrollments set attendance_days=${sorted} where id=${enrollmentId}`);
      }
    }

    console.log("DRY-RUN STATS:", JSON.stringify({ ...stats, classMiss: [...new Set(stats.classMiss)].slice(0, 15), classMissCount: stats.classMiss.length }, null, 2));
    console.log("PENDING UPDATES:", updates.length, APPLY ? "→ APPLYING" : "(dry-run — pass --apply to write)");

    if (APPLY) {
      let done = 0;
      for (const u of updates) { await u(); if (++done % 50 === 0) process.stdout.write(`.${done}`); }
      console.log("\nAPPLIED", done, "updates.");
    }
  } catch (e) {
    console.log("ERR", e.message, e.stack);
  }
  await sql.end();
})();
