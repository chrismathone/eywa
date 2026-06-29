/**
 * scripts/_makeedu/import-schedules-from-ijw.cjs — 수업 요일·시각을 ijw-calander에서 이식.
 *
 * makeedu는 요일·시각 입력이 부정확 → 정확한 스케줄은 ijw에 있다. 단 ijw 반 이름(코드 "PJ2")이 makeedu 이름
 * ("[EiE] Pre Junior 6")과 달라 이름매칭 불가(6/134). 대신 **학생 명단 겹침**으로 ijw반↔makeedu(eywa)반을 연결한다
 * (같은 학생들 = 같은 반). 학생은 이미 매칭돼 있음. 매칭된 반에 ijw schedule(요일+교시→시각)을 class_schedules로 적재.
 *
 *   node --env-file=.env.local scripts/_makeedu/import-schedules-from-ijw.cjs          # dry(매칭률·표본)
 *   node --env-file=.env.local scripts/_makeedu/import-schedules-from-ijw.cjs --apply  # class_schedules 적재
 */
const fs = require("fs");
const postgres = require("postgres");
const L = require("./lib.cjs");

const EXPORT = process.env.IJW_EXPORT || "D:/tmp/ijw-export-2026-06-16T09-19-58-534Z.json";
const APPLY = process.argv.includes("--apply");
const VALID_FROM = "2024-03-01"; // 과거 기준일(현재 주에도 유효하도록)

// ijw 교시표 (backfill-english-slots.cjs와 동일 — POC 임포트 시각과 일치).
const WD_MATH = { "1": ["14:30", "15:25"], "2": ["15:25", "16:20"], "3": ["16:20", "17:15"], "4": ["17:15", "18:10"], "5": ["18:20", "19:15"], "6": ["19:15", "20:10"], "7": ["20:10", "21:05"], "8": ["21:05", "22:00"] };
const WD_ENG = { "1": ["14:20", "15:00"], "2": ["15:00", "15:40"], "3": ["15:40", "16:20"], "4": ["16:20", "17:00"], "5": ["17:00", "17:40"], "6": ["17:40", "18:20"], "7": ["18:20", "19:15"], "8": ["19:15", "20:10"], "9": ["20:10", "21:05"], "10": ["21:05", "22:00"] };
const WEEKEND_T = { "1": ["09:00", "10:00"], "2": ["10:00", "11:00"], "3": ["11:00", "12:00"], "4": ["12:00", "13:00"], "5": ["13:00", "14:00"], "6": ["14:00", "15:00"], "7": ["15:00", "16:00"], "8": ["16:00", "17:00"] };
const LEGACY_PID = { "1-1": "1", "1-2": "2", "2-1": "3", "2-2": "4", "3-1": "5", "3-2": "6", "4-1": "7", "4-2": "8" };
const DAY_MAP = { "월": "mon", "화": "tue", "수": "wed", "목": "thu", "금": "fri", "토": "sat", "일": "sun" };

const asDocs = (c) => (Array.isArray(c) ? c : c && c.docs ? c.docs : Object.values(c));
// 스케줄 엔트리(객체 {day,periodId} 또는 "수 6"/"수-6") → {koDay, periodId}.
function parseSched(e) {
  if (e && typeof e === "object") return { koDay: e.day, periodId: String(e.periodId) };
  const s = String(e || "").trim();
  const m = s.match(/^([월화수목금토일])\s*[- ]?\s*(\S+)$/);
  return m ? { koDay: m[1], periodId: m[2] } : null;
}
function slotTime(koDay, periodId, subject) {
  const day = DAY_MAP[koDay];
  if (!day) return null;
  const pid = LEGACY_PID[String(periodId)] ?? String(periodId);
  const table = koDay === "토" || koDay === "일" ? WEEKEND_T : subject === "english" ? WD_ENG : WD_MATH;
  const t = table[pid];
  return t ? { day, start: t[0], end: t[1], period: pid } : null;
}
const subjCompat = (a, b) => a === b || ([ "math", "subject_1" ].includes(a) && [ "math", "subject_1" ].includes(b));

(async () => {
  const j = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
  const ijwClasses = asDocs(j.collections.classes).map((d) => d.data || d);
  const ijwStudents = asDocs(j.collections.students).map((d) => d.data || d);

  // ijw 반: classId → {subject, schedule:[{koDay,periodId}], roster:Set(ijwKey)}
  const ijwC = new Map();
  for (const c of ijwClasses) {
    const sched = (c.schedule || []).map(parseSched).filter(Boolean);
    ijwC.set(c.id, { subject: c.subject, className: c.className, sched, roster: new Set() });
  }
  // 로스터: 학생 enrollments → classId. ijwKey = normName|grade|school
  const ijwKey = (s) => `${L.normalizeName(s.name || s.studentName)}|${s.grade || ""}|${s.school || ""}`;
  for (const s of ijwStudents) {
    const k = ijwKey(s);
    for (const e of s.enrollments || []) {
      const cls = ijwC.get(e.classId);
      if (cls) cls.roster.add(k);
      // 반에 schedule 없으면 enrollment schedule로 보강
      if (cls && cls.sched.length === 0 && e.schedule) {
        const es = e.schedule.map(parseSched).filter(Boolean);
        if (es.length) cls.sched = es;
      }
    }
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const eStuds = await sql`select id, name, grade, school from students where tenant_id = ${tenantId}`;
    const m3 = new Map(), m2 = new Map(), m1 = new Map();
    for (const s of eStuds) {
      const n = L.normalizeName(s.name);
      m3.set(`${n}|${s.grade || ""}|${s.school || ""}`, s.id);
      m2.set(`${n}|${s.grade || ""}`, s.id);
      m1.set(n, m1.has(n) ? null : s.id);
    }
    // ijwKey → eywa student id
    const ijwToEywa = (k) => {
      const [n, g, sc] = k.split("|");
      return m3.get(`${n}|${g}|${sc}`) || m2.get(`${n}|${g}`) || m1.get(n) || null;
    };
    // ijw 반 로스터(eywa id 집합) + 스케줄
    for (const c of ijwC.values()) {
      c.eRoster = new Set([...c.roster].map(ijwToEywa).filter(Boolean));
    }

    // eywa makeedu 반 + 로스터
    const eClasses = await sql`select id, class_name, subject from classes where tenant_id = ${tenantId}`;
    const enrs = await sql`select class_id, student_id from enrollments where tenant_id = ${tenantId}`;
    const eRoster = new Map();
    for (const e of enrs) {
      if (!eRoster.has(e.class_id)) eRoster.set(e.class_id, new Set());
      eRoster.get(e.class_id).add(e.student_id);
    }

    // 매칭: eywa 반 → 최대 명단 겹침 ijw 반(과목 호환)
    const links = [];
    let noRoster = 0, noMatch = 0;
    for (const ec of eClasses) {
      const er = eRoster.get(ec.id);
      if (!er || er.size === 0) { noRoster++; continue; }
      let best = null, bestInter = 0;
      for (const ic of ijwC.values()) {
        if (!subjCompat(ec.subject, ic.subject)) continue;
        if (!ic.sched.length || ic.eRoster.size === 0) continue;
        let inter = 0;
        for (const sid of er) if (ic.eRoster.has(sid)) inter++;
        if (inter > bestInter) { bestInter = inter; best = ic; }
      }
      const minSize = best ? Math.min(er.size, best.eRoster.size) : 0;
      const ratio = best && minSize ? bestInter / minSize : 0;
      // 보수적: 작은 로스터의 60%+ 가 겹쳐야 같은 반으로 확정(잘못된 시각 방지). 단일학생 반은 inter>=1·ratio>=0.6.
      if (best && bestInter >= 1 && ratio >= 0.6) {
        links.push({ ec, ic: best, inter: bestInter, ratio: ratio.toFixed(2), eSize: er.size, iSize: best.eRoster.size });
      } else noMatch++;
    }
    console.log(`eywa 반 ${eClasses.length}: 매칭 ${links.length} / 로스터無 ${noRoster} / 매칭실패 ${noMatch}`);
    const strong = links.filter((l) => l.ratio >= 0.8).length;
    console.log(`  신뢰도: ratio>=0.8 ${strong}, 0.6~0.8 ${links.length - strong}`);
    console.log("매칭 표본(eywa ↔ ijw, 겹침/eywa명단):");
    for (const l of links.slice(0, 18)) console.log(`  · ${l.ec.class_name}  ↔  ${l.ic.className}  (${l.inter}/${l.eSize}, r=${l.ratio})`);

    // 매칭된 반의 class_schedules 행 생성
    let rows = [];
    for (const { ec, ic } of links) {
      const seen = new Set();
      for (const e of ic.sched) {
        const t = slotTime(e.koDay, e.periodId, ec.subject);
        if (!t) continue;
        const key = `${t.day}|${t.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ class_id: ec.id, day: t.day, start: t.start, end: t.end, period: t.period });
      }
    }
    console.log(`class_schedules rows: ${rows.length} (매칭반당 평균 ${(rows.length / Math.max(1, links.length)).toFixed(1)})`);
    console.log("sample link:", links[0] ? JSON.stringify({ eywa: links[0].ec.class_name, ijw: links[0].ic.className, inter: links[0].inter, sched: rows.filter(r => r.class_id === links[0].ec.id).map(r => r.day + " " + r.start) }) : "none");

    if (!APPLY) { console.log("\n[DRY] --apply 없이 종료."); return; }
    // 기존 class_schedules 비우고(멱등) 적재
    await sql`delete from class_schedules where tenant_id = ${tenantId}`;
    let ins = 0;
    for (const r of rows) {
      await sql`insert into class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, period_label)
        values (${tenantId}, ${r.class_id}, ${r.day}, ${r.start}, ${r.end}, ${VALID_FROM}, ${r.period + "교시"})`;
      ins++;
    }
    await L.recordSync(sql, tenantId, "schedules", ins);
    console.log("inserted class_schedules:", ins);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
