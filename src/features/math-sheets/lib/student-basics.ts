import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { addDays } from "@/lib/date-kst";

export type BasicSubject = "english" | "math";
export type BasicEnrollment = {
  subject: BasicSubject;
  startDate: string | null;
  /** 마지막 수강일(포함). 반이동 경계는 아래 함수에서 기존 수강 규칙으로 변환한다. */
  endDate: string | null;
  isTransferred: boolean;
  onHold: boolean;
  classActive: boolean;
  closedAt: string | null;
  teacherName: string | null;
  teacherAssigned: boolean;
};
export type SubjectBasics = {
  subject: BasicSubject;
  state: "active" | "paused" | "upcoming" | "none";
  startedOn: string | null;
  firstRecordedOn: string | null;
  teachers: string[];
};
export type StudentBasics = {
  asOf: string;
  status: "ready" | "unavailable";
  summary: string;
  subjects: SubjectBasics[];
};

export function unavailableStudentBasics(asOf: string): StudentBasics {
  return { asOf, status: "unavailable", summary: "수강정보 확인 필요", subjects: [] };
}

function lastDay(row: BasicEnrollment): string | null {
  const end = enrollmentLastDate(row.endDate, row.isTransferred);
  return row.closedAt && (!end || row.closedAt < end) ? row.closedAt : end;
}

/** 과목의 연속 수강 기간을 합친다. 반 이동·복수 반은 이어지고, 퇴원 후 재등록은 다시 시작한다. */
function continuousStart(rows: BasicEnrollment[], asOf: string): string | null {
  const periods = rows.flatMap(row => {
    const end = lastDay(row);
    // 종료일 없는 폐지 반으로 수강 공백을 메우지 않는다.
    if (!row.startDate || row.startDate > asOf || (!row.classActive && !end) || (end && end < row.startDate)) return [];
    return [{ start: row.startDate, end: end ?? asOf }];
  }).sort((a, b) => a.start.localeCompare(b.start));
  let current: { start: string; end: string } | undefined;
  for (const period of periods) {
    if (!current || period.start > addDays(current.end, 1)) current = { ...period };
    else if (period.end > current.end) current.end = period.end;
    if (current.end >= asOf) return current.start;
  }
  return null;
}

export function buildStudentBasics(rows: BasicEnrollment[], asOf: string, withdrawnAt: string | null = null): StudentBasics {
  const withdrawn = !!withdrawnAt && withdrawnAt < asOf;
  const subjects = (["english", "math"] as const).map((subject): SubjectBasics => {
    const history = rows.filter(row => row.subject === subject);
    const eligible = history.filter(row => row.classActive && (!row.closedAt || row.closedAt >= asOf));
    const current = withdrawn ? [] : eligible.filter(row => (!row.startDate || row.startDate <= asOf) && (!lastDay(row) || lastDay(row)! >= asOf));
    const active = current.filter(row => !row.onHold);
    const upcoming = eligible.filter(row => row.startDate && row.startDate > asOf && (!lastDay(row) || lastDay(row)! >= row.startDate));
    const state = active.length ? "active" : current.length ? "paused" : upcoming.length ? "upcoming" : "none";
    const upcomingDate = upcoming.map(row => row.startDate!).sort()[0] ?? null;
    const selected = state === "active" ? active : state === "paused" ? current : state === "upcoming" ? upcoming.filter(row => row.startDate === upcomingDate) : [];
    const startedOn = current.length
      ? current.some(row => !row.startDate) ? null : continuousStart(history, asOf)
      : state === "upcoming" ? upcomingDate : null;
    return {
      subject, state, startedOn,
      firstRecordedOn: history.flatMap(row => row.startDate && row.startDate <= asOf ? [row.startDate] : []).sort()[0] ?? null,
      teachers: [...new Set(selected.map(row => row.teacherName?.trim() || (row.teacherAssigned ? "담임 확인 필요" : "담임 미지정")))].sort((a, b) => a.localeCompare(b, "ko")),
    };
  });
  const [english] = subjects;
  const activeCount = subjects.filter(s => s.state === "active").length;
  const paused = subjects.filter(s => s.state === "paused").map(s => s.subject === "english" ? "영어" : "수학");
  const summary = paused.length
    ? `${activeCount ? `${english.state === "active" ? "영어" : "수학"} 수강 · ` : ""}${paused.join("·")} 휴원`
    : activeCount === 2 ? "영어·수학 동시수강"
    : activeCount === 1 ? english.state === "active" ? "영어만 수강" : "수학만 수강"
    : "현재 수강 없음";
  return { asOf, status: "ready", summary, subjects };
}
