// Read-only audit. Run with node --env-file=.env.local --import tsx, then:
// --tenant <uuid> --month YYYY-MM --out logs/teacher-term-share-audit
// Re-run the same snapshot with --snapshot; no attendance or billing writes.
import postgres from "postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { teacherFourWeekWeights, teacherTermSessions, teacherTermWeights } from "../../src/features/attendance/teacher-term-share.ts";
import { monthRange } from "../../src/lib/date-kst.ts";

const { values } = parseArgs({ options: {
  tenant: { type: "string" }, month: { type: "string" }, out: { type: "string" }, snapshot: { type: "boolean" },
} });
if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(values.tenant ?? "")
  || !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month ?? "") || !values.out) {
  throw new Error("Required: --tenant <uuid> --month YYYY-MM --out <local directory>");
}
const { tenant, month, out } = values;
const { from, to } = monthRange(month);
await mkdir(out, { recursive: true });
const snapshotPath = join(out, "snapshot.json");
let data;
if (values.snapshot) {
  data = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (data.tenant !== tenant || data.month !== month) throw new Error("Snapshot scope does not match arguments");
} else {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    data = await sql.begin("isolation level repeatable read read only", async (db) => ({
      tenant, month, capturedAt: new Date().toISOString(),
      classes: await db`select id, class_name, subject, english_track, teacher_id, is_active from classes where tenant_id=${tenant} and subject='english'`,
      schedules: await db`select id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, lab_separate, valid_from, valid_to from class_schedules where tenant_id=${tenant} and valid_from<=${to} and (valid_to is null or valid_to>=${from})`,
      enrollments: await db`select class_id, student_id, start_date, end_date, is_transferred, attendance_days from enrollments where tenant_id=${tenant} and start_date<=${to} and (end_date is null or end_date>=${from})`,
      terms: await db`select t.id, t.class_id, t.confirmed_sessions, t.unit_price, t.amount, t.quantity_basis, t.pricing_mode, i.student_id from invoice_session_terms t join invoices i on i.id=t.invoice_id and i.tenant_id=t.tenant_id where t.tenant_id=${tenant} and i.period=${month} and i.status<>'void' and t.class_id is not null and t.confirmed_sessions is not null`,
      teachers: await db`select id, display_name from users where tenant_id=${tenant}`,
      settings: (await db`select data->'operations'->'holidays' as holidays from tenant_settings where tenant_id=${tenant}`)[0],
    }));
    await writeFile(snapshotPath, JSON.stringify(data, null, 2));
  } finally { await sql.end(); }
}
const iso = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : v?.slice(0, 10) ?? null;
const teachers = new Map(data.teachers.map((t) => [t.id, t.display_name]));
const holidays = new Set((data.settings?.holidays ?? []).map((h) => h.date));
const capturedDay = new Date(data.capturedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
const referenceDate = capturedDay < from ? from : capturedDay > to ? to : capturedDay;
const rows = [];
const coverage = [];
for (const c of data.classes.filter((c) => c.subject === "english")) {
  const terms = data.terms.filter((t) => t.class_id === c.id);
  const schedules = data.schedules.filter((s) => s.class_id === c.id).map((s) => ({
    teacherId: s.teacher_id, dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time,
    slotTeacherLabel: s.slot_teacher_label, validFrom: iso(s.valid_from), validTo: iso(s.valid_to), labSeparate: s.lab_separate,
  }));
  const enrollments = data.enrollments.filter((e) => e.class_id === c.id);
  coverage.push({ className: c.class_name, active: c.is_active, scheduleRows: schedules.length,
    enrolledStudents: new Set(enrollments.map((e) => e.student_id)).size, confirmedRows: terms.length });
  // The UI combines multiple invoices for the same student and class before allocation.
  for (const student of new Set(terms.map((t) => t.student_id))) {
    const ownTerms = terms.filter((t) => t.student_id === student);
    const term = {
      units: Math.round(ownTerms.reduce((sum, t) => sum + Number(t.confirmed_sessions), 0) * 10) / 10,
      daysBasis: ownTerms.some((t) => t.pricing_mode !== "monthly" && (t.quantity_basis ?? "days") === "days"),
    };
    const weights = c.english_track === "eie" ? teacherFourWeekWeights({
      referenceDate, schedules, className: c.class_name, homeroomTeacherId: c.teacher_id,
    }) : teacherTermWeights({ month, schedules, holidays, className: c.class_name,
      homeroomTeacherId: c.teacher_id, scopeTeacherId: c.teacher_id ?? "", englishTrack: c.english_track,
      enrollments: enrollments.filter((e) => e.student_id === student).map((e) => ({
        startDate: iso(e.start_date), endDate: iso(e.end_date), isTransferred: e.is_transferred, attendanceDays: e.attendance_days,
      })),
    });
    const owners = new Set(weights.keys());
    if (weights.homeroomTeacherId) owners.add(weights.homeroomTeacherId);
    const shares = [...owners].map((teacherId) => {
      const allocated = teacherTermSessions(term, teacherId, weights);
      return { teacherId, teacher: teachers.get(teacherId) ?? "JJ/LAB/미지정", planned: weights.get(teacherId) ?? 0,
        units: allocated.allocationPending || allocated.daysBasis ? null : allocated.units };
    });
    const pending = teacherTermSessions(term, c.teacher_id ?? "", weights).allocationPending === true;
    const priceMismatch = ownTerms.some((t) => t.unit_price === null || t.amount === null
      || Math.round(Number(t.unit_price) * (t.pricing_mode === "monthly" ? 1 : Number(t.confirmed_sessions))) !== Number(t.amount));
    rows.push({ className: c.class_name, classId: c.id, studentId: student, termIds: ownTerms.map((t) => t.id),
      registered: term.units, planned: [...weights.values()].reduce((sum, n) => sum + n, 0),
      pending, daysBasis: term.daysBasis, priceMismatch, shares,
      sumMatches: !pending && !term.daysBasis && shares.reduce((sum, s) => sum + s.units, 0) === term.units,
    });
  }
}
const summary = {
  month, englishClasses: coverage.length, classesWithConfirmations: coverage.filter((c) => c.confirmedRows).length,
  studentClassRows: rows.length, pendingRows: rows.filter((r) => r.pending).length,
  pendingClasses: new Set(rows.filter((r) => r.pending).map((r) => r.classId)).size,
  exactRows: rows.filter((r) => r.sumMatches).length, daysBasisRows: rows.filter((r) => r.daysBasis).length,
  priceMismatches: rows.filter((r) => r.priceMismatch).length,
};
await writeFile(join(out, "report.json"), JSON.stringify({ summary, coverage, rows }, null, 2));
const lines = [`# ${month} 영어 등록 시수 배분 검수`, "", `검수 시각: ${data.capturedAt ?? "snapshot"}`, "",
  `영어 ${summary.englishClasses}개 반 전체를 조회했습니다. 확정 내역이 있는 ${summary.classesWithConfirmations}개 반, 학생·반 ${rows.length}건을 대조했습니다.`,
  `교시 담당 + JJ/LAB/미지정 배분 합계 일치 ${summary.exactRows}건, 배분 확인 ${summary.pendingRows}건(${summary.pendingClasses}개 반), 확정 금액 산식 불일치 ${summary.priceMismatches}건입니다.`, "",
  "교시별 시수를 먼저 배분하고 확정 등록에서 남는 시수는 담임에게 배분합니다. 여러 담당자의 시간표 합계보다 확정 등록이 적으면 감액 배분 확인이 필요합니다. 합계 일치는 실제 수업 편성의 검증을 뜻하지 않습니다.",
  "EiE는 기준일의 주간 시간표 × 4(각 요일 4회, *LAB 제외)이며 반 공통 등록 기준입니다. 그 외 반은 수강 기간·요일과 달력월을 대조합니다. 브릿지/EiE는 40분당 1U, 인재원 일반반은 50분 교시도 60분으로 인정해 1U입니다. 이름에 브릿지가 없어도 40분 교시 편성이면 브릿지로 보되, 50분 교시의 일반반에 섞인 단축 40분 교시는 반 전체를 브릿지로 바꾸지 않습니다. 현재 담임 기준의 시간표 검수이며 담임 인수인계 이전 기간의 귀속은 운영 화면에서 추가 제한될 수 있습니다.",
  "월 정액은 월 단가와 확정액을 대조하고, 회당 과금은 단가 × 확정 시수와 확정액을 대조했습니다. 실납·이월액과 비교하는 검수는 아닙니다. 출결·시수·청구 데이터를 수정하지 않았습니다.", "",
  "| 반 | 확인 건수 | 확정 시수 / 시간표 환산 시수 | 배분 확인 |", "|---|---:|---|---:|"];
for (const c of coverage.filter((c) => c.confirmedRows).sort((a, b) => a.className.localeCompare(b.className, "ko"))) {
  const group = rows.filter((r) => r.className === c.className);
  lines.push(`| ${c.className} | ${group.length} | ${[...new Set(group.map((r) => `${r.registered} / ${r.planned}`))].join(", ")} | ${group.filter((r) => r.pending).length} |`);
}
lines.push("", "확정 내역이 없는 반(배분 수치 검수 대상 없음):", "", "| 반 | 활성 | 9월 시간표 행 | 9월 수강생 |", "|---|---|---:|---:|");
for (const c of coverage.filter((c) => !c.confirmedRows)) lines.push(`| ${c.className} | ${c.active ? "예" : "아니오"} | ${c.scheduleRows} | ${c.enrolledStudents} |`);
await writeFile(join(out, "report.md"), lines.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
