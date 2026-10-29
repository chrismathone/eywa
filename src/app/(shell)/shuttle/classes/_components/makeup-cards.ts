import { schoolGradeLabel } from "@/features/grades/unified/model";
import type { MakeupReservation } from "@/features/attendance/makeup-reservation";
import type { MakeupFrom, SheetClass } from "./rider-week-sheet";

type SlotLike = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek?: string;
  startTime?: string;
  endTime?: string;
  teacherName?: string | null;
  slotTeacherLabel?: string | null;
  blockKind?: string;
  students: { studentId: string; name: string; school: string | null; grade: string | null }[];
};

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const dowOf = (ymd: string) => DOW[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;

/**
 * 탑승 학생 시간표의 **보강 카드**(순수) — 사용자 2026-10-28 *"보강만 일단 넣어줘"*.
 * 이번 주(월~금) 보강 예약 중 **셔틀 탑승 학생 것만** 보강 날짜·시간 칸에 세운다. 같은 반·날짜·시간의 보강은 한 카드.
 * 🔑 이름·학교·학년·반 이름은 이번 주 시간표 명단에서 찾는다(새 조회 없음) — 명단에 없으면 이름 대신 '학생'.
 * 🔑 학생마다 **원래 수업**(`from` — 결석한 날 그 반의 그 요일 교시)을 함께 싣는다(사용자 2026-10-29 "보강이 있으면 얼마나 변경됐는지").
 *    그 요일에 그 반 교시가 이번 주 시간표에 없으면 시각은 모름(null) — 지어내지 않는다.
 * ⚠️ 예약(`reserved`)만 — 보강일 출결이 저장되면(`done`) 시간표 보강 줄처럼 사라진다.
 */
export function buildMakeupCards(
  reservations: readonly MakeupReservation[],
  slots: readonly SlotLike[],
  riderIds: ReadonlySet<string>,
  week: readonly { day: string; ymd: string }[],
): SheetClass[] {
  const dayOf = new Map(week.map((w) => [w.ymd, w.day]));
  const classInfo = new Map<string, { name: string; subject: string; teacher: string }>();
  const studentInfo = new Map<string, { name: string; schoolGrade: string }>();
  /** 반 × 요일 → 그날 교시 전체 구간(첫 시작 ~ 마지막 끝). */
  const span = new Map<string, { start: string; end: string }>();
  for (const s of slots) {
    if (s.blockKind) continue;
    // 선생님 = 반 담임(보강은 정규 교시가 아니라 칸 라벨이 없다) → 없으면 그 반 아무 교시의 담당.
    const prev = classInfo.get(s.classId);
    if (!prev) classInfo.set(s.classId, { name: s.className, subject: s.subject, teacher: s.teacherName ?? s.slotTeacherLabel ?? "" });
    else if (!prev.teacher) prev.teacher = s.teacherName ?? s.slotTeacherLabel ?? "";
    for (const st of s.students)
      if (!studentInfo.has(st.studentId)) studentInfo.set(st.studentId, { name: st.name, schoolGrade: schoolGradeLabel(st.school, st.grade) });
    if (s.dayOfWeek && s.startTime && s.endTime) {
      const k = `${s.classId}|${s.dayOfWeek}`;
      const st = s.startTime.slice(0, 5);
      const en = s.endTime.slice(0, 5);
      const cur = span.get(k);
      span.set(k, cur ? { start: st < cur.start ? st : cur.start, end: en > cur.end ? en : cur.end } : { start: st, end: en });
    }
  }

  const cards = new Map<string, SheetClass>();
  for (const r of reservations) {
    const day = dayOf.get(r.makeupDate);
    if (!day || !riderIds.has(r.studentId)) continue;
    const start = r.slotStart.slice(0, 5);
    const end = r.slotEnd.slice(0, 5);
    const key = `${r.classId}|${r.makeupDate}|${start}|${end}`;
    const klass = classInfo.get(r.classId);
    const card =
      cards.get(key) ??
      ({
        id: `makeup:${key}`,
        day,
        start,
        end,
        className: klass?.name ?? "수업",
        subject: klass?.subject ?? "",
        teacher: klass?.teacher ?? "",
        makeup: true,
        students: [],
      } satisfies SheetClass);
    const st = studentInfo.get(r.studentId);
    const fromDay = dowOf(r.absenceDate);
    const orig = span.get(`${r.classId}|${fromDay}`) ?? null;
    const from: MakeupFrom = { date: r.absenceDate, day: fromDay, start: orig?.start ?? null, end: orig?.end ?? null };
    if (!card.students.some((x) => x.id === r.studentId))
      card.students.push({ id: r.studentId, name: st?.name ?? "학생", schoolGrade: st?.schoolGrade ?? "", from });
    cards.set(key, card);
  }
  return [...cards.values()];
}
