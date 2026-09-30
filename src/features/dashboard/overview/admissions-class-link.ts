import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { getGradeLevel, schoolGradeLabel } from "@/lib/format/school-grade";
import { normalizeSchoolName } from "@/features/schools/school-name";
import { baseNameOf } from "@/features/students/name-suffix";

export type FirstClassCandidate = {
  studentId: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string;
  subject: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  isTransferred: boolean;
  closedAt?: string | null;
};

export const schoolKey = (text: string) =>
  `${normalizeSchoolName(text)}${text.match(/\d+$/)?.[0] ?? ""}`;
/** 학생·상담의 학교·학년을 일정 제목 힌트('칠성초5')와 같은 모양의 키로 — 반 연결·상담 연결이 같은 판정을 쓴다. */
export function schoolGradeKey(schoolRaw: string | null, grade: string | null): string {
  const school = normalizeSchoolName(schoolRaw ?? "");
  const kind = getGradeLevel(grade);
  // '칠성' + '초5'처럼 학교급을 학년에만 입력한 학생도 같은 학교·학년으로 비교한다.
  return schoolKey(
    schoolGradeLabel(
      school && !/[초중고]$/.test(school) ? `${school}${kind}` : school,
      grade,
    ),
  );
}
const candidateSchoolKey = (row: FirstClassCandidate) => schoolGradeKey(row.school, row.grade);
/** 앞뒤가 글자·숫자가 아닌 자리에서만 일치 — '김지우'가 '김지우현'에 걸리지 않는다. */
export const containsWord = (text: string, word: string) =>
  !!word &&
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);
/** 일정 제목의 학교·학년 힌트('칠성초5'·'일중1'·'달성초 4') → `schoolKey` 모양. */
export function titleSchoolHints(title: string): string[] {
  return [
    ...title.matchAll(
      /([가-힣a-zA-Z]+(?:초등학교|중학교|고등학교|초|중|고))\s*([1-6])/g,
    ),
  ].map((m) => schoolKey(`${m[1]}${m[2]}`));
}

/**
 * 일정의 반 이름 또는 학생·학교·과목이 한 반으로 확정될 때만 연결한다. 모호하면 추측하지 않는다.
 * 학생으로 확정됐으면 그 원생의 **정식 이름**(동명이인 접미사 포함, `studentName`)도 함께 돌려준다 — 운영실 일정 카드가
 * 제목의 '김근우'를 '김근우A'로 바로잡아 보여 준다(원장 2026-09-13). 반 이름으로만 확정된 경우엔 학생이 여럿일 수 있어 없다.
 */
export function matchFirstClass(
  event: { title: string; startDate: string; tag?: { name: string } | null },
  candidates: readonly FirstClassCandidate[],
  subjects: Record<string, string>,
): { id: string; name: string; studentName?: string } | null {
  if (
    !/첫\s*수업/.test(`${event.title} ${event.tag?.name ?? ""}`) ||
    isCancelledEventTitle(event.title)
  )
    return null;
  const active = candidates.filter(
    (row) =>
      isEnrollmentActiveOn(row, event.startDate) &&
      (!row.closedAt || row.closedAt >= event.startDate),
  );
  const unique = (rows: readonly FirstClassCandidate[]) => {
    const classes = new Map(
      rows.map((row) => [
        row.classId,
        { id: row.classId, name: row.className },
      ]),
    );
    return classes.size === 1 ? [...classes.values()][0] : null;
  };
  const explicit = active.filter((row) =>
    containsWord(event.title, row.className),
  );
  if (explicit.length) return unique(explicit);
  const mentionedSubjects = Object.entries(subjects)
    .filter(([, label]) => event.title.includes(label))
    .map(([key]) => key);
  const schoolHints = titleSchoolHints(event.title);
  const matches = active.filter(
    (row) =>
      (containsWord(event.title, row.studentName) ||
        (mentionedSubjects.length === 1 &&
          schoolHints.length === 1 &&
          containsWord(event.title, baseNameOf(row.studentName)))) &&
      (!mentionedSubjects.length || mentionedSubjects.includes(row.subject)) &&
      (!schoolHints.length || schoolHints.includes(candidateSchoolKey(row))),
  );
  if (new Set(matches.map((row) => row.studentId)).size !== 1) return null;
  // 정식 이름은 제목에 그 이름이 그대로 있거나, 그 학생의 수강이 **이 일정 날짜에 시작**할 때만 준다 — 접미사 뗀 이름으로 잡힌 반이
  // 이미 다니던 반이면 같은 이름의 원래 원생(수강 입력 전)의 첫 수업일 수 있다(재리뷰 2026-09-13). 반 링크는 종전 규칙 그대로.
  const studentName =
    matches.some((row) => containsWord(event.title, row.studentName)) ||
    matches.some((row) => row.startDate === event.startDate)
      ? matches[0].studentName
      : undefined;
  const exact = unique(matches);
  if (exact) return { ...exact, studentName };
  // 같은 학생의 여러 반 중 이 일정 날짜에 시작하는 반이 하나뿐인 경우.
  const sameDay = unique(matches.filter((row) => row.startDate === event.startDate));
  return sameDay ? { ...sameDay, studentName } : null;
}

export type FirstClassSchedule = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  teacherName: string | null;
  validFrom: string;
  validTo: string | null;
  closedAt: string | null;
};

/** 아직 학생 배정 전인 일정은 과목·학년·해당 요일의 시간·담당 강사까지 모두 맞는 반 하나만 연결한다. */
export function matchFirstClassSchedule(
  event: {
    title: string;
    startDate: string;
    startTime: string | null;
    tag?: { name: string } | null;
  },
  slots: readonly FirstClassSchedule[],
  subjects: Record<string, string>,
): { id: string; name: string } | null {
  if (
    !/첫\s*수업/.test(`${event.title} ${event.tag?.name ?? ""}`) ||
    isCancelledEventTitle(event.title)
  )
    return null;
  const subjectKeys = Object.entries(subjects)
    .filter(([, label]) => event.title.includes(label))
    .map(([key]) => key);
  const grade = event.title.match(/(초|중|고)(?:등학교|학교)?\s*([1-6])/);
  const teachers = [
    ...event.title.matchAll(
      /([가-힣a-zA-Z]{2,})\s*(?:T|선생님)(?=$|[^a-zA-Z])/gi,
    ),
  ].map((m) => m[1].toLowerCase());
  if (subjectKeys.length !== 1 || !grade || !teachers.length) return null;
  const statedTime = event.title.match(/\b(\d{1,2}):([0-5]\d)\b/);
  let time = event.startTime?.slice(0, 5);
  if (statedTime) {
    let hour = Number(statedTime[1]);
    // 일정 제목의 4:20은 캘린더가 오후 일정일 때만 16:20으로 해석한다.
    if (hour < 12 && Number(event.startTime?.slice(0, 2)) >= 12) hour += 12;
    time = `${String(hour).padStart(2, "0")}:${statedTime[2]}`;
  }
  if (!time) return null;
  const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${event.startDate}T00:00:00Z`).getUTCDay()
  ];
  const gradeKey = `${grade[1]}${grade[2]}`;
  const matches = slots.filter(
    (slot) =>
      slot.subject === subjectKeys[0] &&
      slot.dayOfWeek === day &&
      slot.startTime.slice(0, 5) === time &&
      slot.validFrom <= event.startDate &&
      (!slot.validTo || slot.validTo >= event.startDate) &&
      (!slot.closedAt || slot.closedAt >= event.startDate) &&
      containsWord(slot.className, gradeKey) &&
      teachers.some((teacher) =>
        slot.teacherName?.toLowerCase().replace(/\s/g, "").endsWith(teacher),
      ),
  );
  const classes = new Map(
    matches.map((slot) => [
      slot.classId,
      { id: slot.classId, name: slot.className },
    ]),
  );
  return classes.size === 1 ? [...classes.values()][0] : null;
}
