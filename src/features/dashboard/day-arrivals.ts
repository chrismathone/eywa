/**
 * **오늘 처음 오는 학생 · 오늘이 마지막인 학생** — 순수 판정(서버·DB 무관, Vitest).
 *
 * 왜 필요한가(운영실 검토 2026-09-09, 세 검토자 3/3): 헤더의 재원 증감은 **이번 달**이고 추세 카드는
 * **7일**이라, 사무실이 "오늘 맞이할 아이·오늘 보낼 아이"를 알 방법이 아무 화면에도 없었다. 수강 구간에
 * 이미 있는 사실인데 아무도 '오늘'로 모아 주지 않는다.
 *
 * 🔴 **수강 단위로 세면 거짓말이 된다**(2026-09-09 실데이터로 확인):
 *    · 오늘 시작한 수강 1건의 주인공은 이미 다른 반 1개를 다니던 학생이었다 → "첫 등원"이 아니라 **반 추가**.
 *    · 9/7에 끝난 수강 4건 중 김지호는 남은 수강이 **4개** → "마지막 등원"이 아니라 반 하나를 뺀 것.
 *    · 같은 날 두 반이 함께 끝난 학생(조현준)은 행이 2개라 그대로 세면 **한 사람이 두 번** 잡힌다.
 *    그래서 판정 단위는 **학생**이고, 재료는 그 학생의 **수강 전건**이다.
 *
 * 🔴 **반이동은 첫날도 마지막날도 아니다** — `isTransferredIn`(옮겨 들어옴)·`isTransferred`(옮겨 나감)은
 *    같은 학생이 학원 안에서 자리를 바꾼 것이라, 맞이·환송할 사람이 아니다. 반이동 종료는 반열림
 *    (`end_date <= 그날`)이라 그날 이미 새 반에서 수업한다([[#125]]와 같은 규약).
 */
import { subjectGroupOf, type ProgramSubject } from "@/features/students/program";

export type DayEnrollmentRow = {
  studentId: string;
  studentName: string;
  startDate: string;
  /** null = 아직 열려 있는 수강. */
  endDate: string | null;
  /** 반이동으로 나감(그날 이미 새 반). */
  isTransferred: boolean;
  /** 반이동으로 들어옴(이미 다니던 학생). */
  isTransferredIn: boolean;
  /** 휴원 — "이어지는 수강"으로 치지 않는다(아래 주석). */
  onHold: boolean;
  /** 반 과목 키 — '새 과목 첫 수업' 판정용. 모르면(null) 새 과목으로 치지 않는다(지어내지 않는다). */
  subject?: string | null;
};

export type DayArrival = { studentId: string; name: string };

/**
 * 오늘 첫 수업의 종류(원장 2026-09-11, 운영실 KPI '오늘첫수업').
 *   · `first` = 이 학원에서의 **첫 등원**(오늘 이전에 다닌 적이 없다).
 *   · `newSubject` = 이미 다니던 학생이 **처음 듣는 과목 묶음**의 첫 수업.
 * 🔴 과목 묶음은 재원생 프로그램과 **같은 판정**(`subjectGroupOf` = programOf) — 영어(EiE·인재원 영어)·수학(수학(심화) 포함).
 *    그래서 인재원 영어 → EiE, 수학 → 수학(심화)는 새 과목이 아니다.
 * 🔴 이미 듣던(또는 들었던) 묶음에 반만 하나 더 받은 것·반이동은 어느 쪽도 아니다.
 */
export type FirstClassKind = "first" | "newSubject";
export type FirstClassStudent = {
  studentId: string;
  name: string;
  kind: FirstClassKind;
  /** first = 오늘 시작한 과목 전부 · newSubject = 새로 시작한 과목만. */
  subjects: string[];
};

export type DayArrivals = {
  /** 오늘 **첫 수업** 학생(첫 등원 + 새 과목) — `resolveFirstClasses` 결과 전체(운영실 KPI '오늘첫수업'과 같다). */
  starting: FirstClassStudent[];
  /** 오늘이 마지막 수업일인 학생(퇴원·휴원 진입 포함 — 라벨은 '마지막 수업'이지 '퇴원'이 아니다). */
  ending: DayArrival[];
};

/**
 * 오늘 **이전에** 다닌 적이 있는가 — "이미 다니던 학생"의 근거.
 *
 * 🔑 오늘까지 이어졌는지는 묻지 않는다. 어제 반이동으로 끝났든 지난달에 끝났든, 그 학생은 오늘이 첫날이
 *    아니다. 시작일이 오늘 이전이면 그 수강은 최소한 시작일 하루를 덮는다(반이동 반열림도 마찬가지).
 * ⚠️ 그래서 **오래 전에 다니다 오늘 다시 오는 학생은 '첫 수업'으로 잡히지 않는다** — 사실이 아니기 때문이다
 *    (재등록은 다른 신호이고, 여기서 지어내지 않는다).
 */
function attendedBeforeToday(row: DayEnrollmentRow, today: string): boolean {
  if (row.startDate >= today) return false;
  // 반이동으로 시작한 날 그대로 끝난 행은 하루도 안 덮는다(반열림 [start, end)).
  if (row.isTransferred && row.endDate && row.endDate <= row.startDate) return false;
  return true;
}

/**
 * 오늘 뒤로도 이어지는 수강인가.
 * ⚠️ **휴원(`onHold`)은 이어짐으로 치지 않는다** — 휴원 학생은 실제로 안 오므로, 다니던 반이 오늘 끝나고
 *    휴원 수강만 남는 경우 "오늘이 마지막 수업"은 사실이다. 그래서 항목 라벨도 '퇴원'이 아니라 **'오늘 마지막 수업'**
 *    이어야 한다(퇴원으로 적으면 복귀 예정 학생을 내보낸 것으로 읽힌다).
 */
function continuesAfterToday(row: DayEnrollmentRow, today: string): boolean {
  if (row.onHold) return false;
  if (!row.endDate) return true;
  return row.endDate > today;
}

function groupByStudent(rows: readonly DayEnrollmentRow[]): Map<string, DayEnrollmentRow[]> {
  const byStudent = new Map<string, DayEnrollmentRow[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId) ?? [];
    list.push(row);
    byStudent.set(row.studentId, list);
  }
  return byStudent;
}

function nameOf(list: readonly DayEnrollmentRow[]): string {
  return list.find((row) => row.studentName)?.studentName ?? "(학생)";
}

function uniqueSubjects(rows: readonly DayEnrollmentRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.subject?.trim() ? [row.subject.trim()] : [])))];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ko");

/**
 * 오늘 **첫 수업** 학생 — 첫 등원 + 새 과목. 운영실 '오늘첫수업' 카드·팝업·원생목록 `first=` 필터와
 * 일일 브리핑 '오늘 첫 수업'(`resolveDayArrivals`)이 **같은 결과 전체**를 쓴다 — 같은 이름의 숫자가 갈리면 안 된다(원장 규칙).
 * @param rows 후보 학생들의 **수강 전건**.
 * @param subjects 학원설정 `operations.subjects` — 과목 묶음 판정(없으면 과목 키만으로 묶는다: english·math 키만 묶음).
 */
export function resolveFirstClasses(
  rows: readonly DayEnrollmentRow[],
  today: string,
  subjects: readonly ProgramSubject[] = [],
): FirstClassStudent[] {
  const groupOf = (subject: string | null | undefined) => subjectGroupOf(subject, subjects);
  const out: FirstClassStudent[] = [];
  for (const [studentId, list] of groupByStudent(rows)) {
    // 반이동으로 들어온 수강은 첫 수업이 아니다(이미 다니던 학생이 자리만 바꿨다).
    const startsToday = list.filter((row) => row.startDate === today && !row.isTransferredIn);
    if (startsToday.length === 0) continue;
    const before = list.filter((row) => attendedBeforeToday(row, today));
    const todaySubjects = uniqueSubjects(startsToday);
    if (before.length === 0) {
      out.push({ studentId, name: nameOf(list), kind: "first", subjects: todaySubjects });
      continue;
    }
    // 🔑 '새 과목' = 오늘 이전에 **한 번도** 들은 적 없는 과목 **묶음** — 끝난 수강도 들은 것이다(돌아온 과목은 새 과목이 아니다).
    const taken = new Set(uniqueSubjects(before).map(groupOf));
    const fresh = todaySubjects.filter((subject) => {
      const group = groupOf(subject);
      return group !== null && !taken.has(group);
    });
    if (fresh.length > 0) out.push({ studentId, name: nameOf(list), kind: "newSubject", subjects: fresh });
  }
  return out.sort(byName);
}

/**
 * @param rows 후보 학생들의 **수강 전건**(오늘 시작/종료 행만 넘기면 판정이 뒤집힌다 — 위 주석).
 * @param today `YYYY-MM-DD`(KST).
 * @param subjects 학원설정 `operations.subjects` — 새 과목 묶음 판정(`resolveFirstClasses`와 같다).
 */
export function resolveDayArrivals(
  rows: readonly DayEnrollmentRow[],
  today: string,
  subjects: readonly ProgramSubject[] = [],
): DayArrivals {
  // '첫 수업' = 첫 등원 + 새 과목 — 위 `resolveFirstClasses` 결과 **전체**(카드·목록과 같은 숫자). 일부만 떼어 싣지 않는다.
  const starting = resolveFirstClasses(rows, today, subjects);
  const ending: DayArrival[] = [];
  for (const [studentId, list] of groupByStudent(rows)) {
    const endsToday = list.some((row) => row.endDate === today && !row.isTransferred);
    if (endsToday && !list.some((row) => continuesAfterToday(row, today))) {
      ending.push({ studentId, name: nameOf(list) });
    }
  }
  return { starting, ending: ending.sort(byName) };
}
