/*
 * backfill-english-slots.cjs — ijw 익스포트의 셀 단위 영어 시간표 데이터를 eywa로 백필.
 *
 * eywa POC 임포트가 평면화해 버린 ijw의 풍부한 데이터를 복원한다(영어 통합뷰 미니그리드용):
 *  - class_schedules.slot_teacher_label  ← ijw classes.slotTeachers["{요일}-{교시}"]  (영문닉네임·한글·"LAB")
 *  - class_schedules.slot_room_label     ← ijw classes.slotRooms["{요일}-{교시}"]      ("LAB실"·"본원302")
 *  - classes.bg_color / text_color       ← ijw classes.bgColor / textColor             (#RRGGBB)
 *  - students.english_name               ← ijw students.englishName                    ("Willy"…)
 *
 * 매칭(자연키 — IdMap 미영속):
 *  - 반: (tenant_id, class_name=className, subject) 유니크.
 *  - 슬롯: 반 + day_of_week(DAY_MAP) + start_time(교시표). 교시표는 POC 임포트(transform.ts)와 동일 상수.
 *  - 학생: name 일치(중복 시 school+grade). suffix(A/B/C)는 ijw 원본 name에 이미 있어 그대로 매칭.
 *
 * 멱등(UPDATE). 기본은 DRY-RUN(매칭 통계만), `--apply`로 실제 반영.
 *   node --env-file=.env.local scripts/_poc_migration/backfill-english-slots.cjs [--apply]
 */
const fs = require("fs");
const postgres = require("postgres");

// 최신 ijw export 자동 선택(run.ts·import-textbooks-expenses와 동일 패턴 — 하드코딩 파일명 footgun 제거).
const TMP = "D:/tmp";
const EXPORT = require("path").join(TMP, fs.readdirSync(TMP).filter((x) => x.startsWith("ijw-export-") && x.endsWith(".json")).sort().pop());
const APPLY = process.argv.includes("--apply");

// POC 임포트(transform.ts)와 동일 교시표 — 백필 start_time이 임포트한 행과 정확히 맞도록.
const WD_MATH = { "1": ["14:30","15:25"],"2":["15:25","16:20"],"3":["16:20","17:15"],"4":["17:15","18:10"],"5":["18:20","19:15"],"6":["19:15","20:10"],"7":["20:10","21:05"],"8":["21:05","22:00"] };
const WD_ENG = { "1":["14:20","15:00"],"2":["15:00","15:40"],"3":["15:40","16:20"],"4":["16:20","17:00"],"5":["17:00","17:40"],"6":["17:40","18:20"],"7":["18:20","19:15"],"8":["19:15","20:10"],"9":["20:10","21:05"],"10":["21:05","22:00"] };
const WEEKEND_T = { "1":["09:00","10:00"],"2":["10:00","11:00"],"3":["11:00","12:00"],"4":["12:00","13:00"],"5":["13:00","14:00"],"6":["14:00","15:00"],"7":["15:00","16:00"],"8":["16:00","17:00"] };
const LEGACY_PID = { "1-1":"1","1-2":"2","2-1":"3","2-2":"4","3-1":"5","3-2":"6","4-1":"7","4-2":"8" };
const DAY_MAP = { "월":"mon","화":"tue","수":"wed","목":"thu","금":"fri","토":"sat","일":"sun" };

function slotStart(koDay, periodId, subject) {
  const day = DAY_MAP[koDay];
  if (!day) return null;
  const pid = LEGACY_PID[String(periodId)] ?? String(periodId);
  const table = koDay === "토" || koDay === "일" ? WEEKEND_T : subject === "english" ? WD_ENG : WD_MATH;
  const t = table[pid];
  return t ? { day, start: t[0] } : null;
}
/** "월-2" / "월-1-1" → {koDay:"월", periodId:"2"|"1-1"} (첫 '-'로 분리). */
function parseSlotKey(key) {
  const i = String(key).indexOf("-");
  if (i < 0) return null;
  return { koDay: key.slice(0, i), periodId: key.slice(i + 1) };
}
const asDocs = (c) => (Array.isArray(c) ? c : c && c.docs ? c.docs : Object.values(c));
const hm5 = (t) => String(t).slice(0, 5);

(async () => {
  const j = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
  const ijwClasses = asDocs(j.collections.classes).map((d) => d.data || d);
  const ijwStudents = asDocs(j.collections.students).map((d) => d.data || d);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const stats = { classMatched: 0, classMissing: [], colorSet: 0, slotTeacher: 0, slotRoom: 0, slotMiss: 0, enUpdated: 0, enAmbig: 0, enMiss: 0 };
  const updates = []; // {sql, params} 형태 대신 함수 큐

  try {
    // 1) eywa 반 + 스케줄 + 학생 적재(테넌트 단일).
    const tenantRow = await sql`select tenant_id from classes group by tenant_id order by count(*) desc limit 1`;
    const tenantId = tenantRow[0].tenant_id;
    const eClasses = await sql`select id, class_name, subject from classes where tenant_id=${tenantId}`;
    const classByKey = new Map(eClasses.map((c) => [`${c.class_name}|||${c.subject}`, c.id]));
    const eScheds = await sql`select id, class_id, day_of_week, start_time from class_schedules where tenant_id=${tenantId}`;
    const schedByCell = new Map(); // `${class_id}|${day}|${start5}` → schedule_id
    for (const s of eScheds) schedByCell.set(`${s.class_id}|${s.day_of_week}|${hm5(s.start_time)}`, s.id);
    const eStudents = await sql`select id, name, school, grade from students where tenant_id=${tenantId}`;
    const studByName = new Map();
    for (const s of eStudents) {
      const list = studByName.get(s.name) ?? [];
      list.push(s);
      studByName.set(s.name, list);
    }

    // 2) 반별 백필.
    for (const c of ijwClasses) {
      const className = c.className;
      // ijw highmath → eywa subject_1 (2026-06-19 통일). 그 외는 그대로.
      const subject = c.subject === "highmath" ? "subject_1" : (c.subject ?? "other");
      if (!className) continue;
      const classId = classByKey.get(`${className}|||${subject}`);
      if (!classId) { stats.classMissing.push(`${className}/${subject}`); continue; }
      stats.classMatched++;

      // 색
      if (c.bgColor) {
        stats.colorSet++;
        updates.push(() => sql`update classes set bg_color=${c.bgColor}, text_color=${c.textColor ?? null} where id=${classId}`);
      }
      // 슬롯 강사/강의실
      const apply = (map, kind) => {
        for (const [key, val] of Object.entries(map || {})) {
          if (val == null || val === "") continue;
          const p = parseSlotKey(key);
          if (!p) { stats.slotMiss++; continue; }
          const st = slotStart(p.koDay, p.periodId, subject);
          if (!st) { stats.slotMiss++; continue; }
          const schedId = schedByCell.get(`${classId}|${st.day}|${st.start}`);
          if (!schedId) { stats.slotMiss++; continue; }
          if (kind === "teacher") { stats.slotTeacher++; updates.push(() => sql`update class_schedules set slot_teacher_label=${val} where id=${schedId}`); }
          else { stats.slotRoom++; updates.push(() => sql`update class_schedules set slot_room_label=${val} where id=${schedId}`); }
        }
      };
      apply(c.slotTeachers, "teacher");
      apply(c.slotRooms, "room");
    }

    // 3) 학생 영문이름.
    for (const s of ijwStudents) {
      const en = s.englishName;
      if (!en || !s.name) continue;
      const cands = studByName.get(s.name) ?? [];
      let target = null;
      if (cands.length === 1) target = cands[0];
      else if (cands.length > 1) {
        target = cands.find((x) => (x.school ?? "") === (s.school ?? "") && (x.grade ?? "") === (s.grade ?? "")) ?? null;
        if (!target) { stats.enAmbig++; continue; }
      }
      if (!target) { stats.enMiss++; continue; }
      stats.enUpdated++;
      updates.push(() => sql`update students set english_name=${en} where id=${target.id}`);
    }

    console.log("DRY-RUN STATS:", JSON.stringify({ ...stats, classMissing: stats.classMissing.slice(0, 15), missingCount: stats.classMissing.length }, null, 2));
    console.log("PENDING UPDATES:", updates.length, APPLY ? "→ APPLYING" : "(dry-run, no writes — pass --apply to write)");

    if (APPLY) {
      let done = 0;
      for (const u of updates) { await u(); if (++done % 100 === 0) process.stdout.write(`.${done}`); }
      console.log("\nAPPLIED", done, "updates.");
    }
  } catch (e) {
    console.log("ERR", e.message, e.stack);
  }
  await sql.end();
})();
