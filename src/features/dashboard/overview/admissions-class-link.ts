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

const schoolKey = (text: string) =>
  `${normalizeSchoolName(text)}${text.match(/\d+$/)?.[0] ?? ""}`;
const candidateSchoolKey = (row: FirstClassCandidate) => {
  const school = normalizeSchoolName(row.school ?? "");
  const kind = getGradeLevel(row.grade);
  // '칠성' + '초5'처럼 학교급을 학년에만 입력한 학생도 같은 학교·학년으로 비교한다.
  return schoolKey(
    schoolGradeLabel(
      school && !/[초중고]$/.test(school) ? `${school}${kind}` : school,
      row.grade,
    ),
  );
};
const containsWord = (text: string, word: string) =>
  !!word &&
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "iu",
  ).test(text);

/** 일정의 반 이름 또는 학생·학교·과목이 한 반으로 확정될 때만 연결한다. 모호하면 추측하지 않는다. */
export function matchFirstClass(
  event: { title: string; startDate: string; tag?: { name: string } | null },
  candidates: readonly FirstClassCandidate[],
  subjects: Record<string, string>,
): { id: string; name: string } | null {
  if (
    !/첫\s*수업/.test(`${event.title} ${event.tag?.name ?? ""}`) ||
    /취소/.test(event.title)
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
  const schoolHints = [
    ...event.title.matchAll(
      /([가-힣a-zA-Z]+(?:초등학교|중학교|고등학교|초|중|고))\s*([1-6])/g,
    ),
  ].map((m) => schoolKey(`${m[1]}${m[2]}`));
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
  const exact = unique(matches);
  if (exact) return exact;
  // 같은 학생의 여러 반 중 이 일정 날짜에 시작하는 반이 하나뿐인 경우.
  return unique(matches.filter((row) => row.startDate === event.startDate));
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
    /취소/.test(event.title)
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
