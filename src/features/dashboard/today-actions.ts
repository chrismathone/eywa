/**
 * "오늘 조치할 것" 통합 패널 — 원시 신호(raw)를 표시 항목으로 조립하는 순수 함수.
 * 개별 위젯 난립 대신 조건부 신호(무단결석·미기록·분석실패·결재대기·휴가)를 한 패널의
 * 불릿으로 모으고, 전부 0건이면 패널이 "모든 항목 정상"을 보여준다(ijw MasterDashboard 패턴).
 * server-only 미의존(타입+순수) → Vitest로 정렬·문구·링크를 결정적으로 검증.
 */
import type { MenuKey } from "@/lib/permissions";
import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { balancedTake } from "@/lib/collections/balanced-take";
import { absentDayHref, intakeDayHref, studentsFirstClassHref } from "./overview/kpi-links";
import { ABSENT_STATUSES } from "./absent-students";
export {
  enrollmentAttendsOnDay,
  isEnrollmentActiveOn,
} from "@/features/enrollments/eligibility";

export type TodayActionAccess = "read" | "write" | "manage-staff";

export type TodayActionsRaw = {
  /**
   * 신호의 **기준일**(YYYY-MM-DD) — 브리핑은 어제 기준으로 모으므로 '오늘'과 다르다. 항목 링크가 이 날짜를 쓴다
   * (결석 → 그날 출석부 결석 학생, 첫 수업·접수 → 그날 목록).
   */
  date: string;
  /**
   * 기준일 결석 학생 — **한 교시도 안 온 학생**만(결석·공결, 운영실 KPI와 같은 `foldAbsentStudents`).
   * 일부 교시만 결석한 학생은 여기 없다(운영실 팝업·출석부에서 '일부 교시 결석'으로 따로 보인다).
   * ⚠️ "무단결석"이 아니다: 사전 통보 결석도 결석이다 — 라벨을 "무단결석"으로 되돌리지 말 것(연락 없이 빠진 수로 과장된다).
   */
  absentToday: { studentId: string; name: string; subject: string | null; preNotified: boolean }[];
  /**
   * 어제 출석 미기록 반. `subject`는 미리보기 이름을 **과목별로 고르게** 뽑는 데 쓴다 —
   * 이름순 앞 2개만 뽑으면 한 과목(한글 이름 반)만 계속 노출된다(gotcha #84). 필수 필드로 둔 건
   * 새 호출부가 빠뜨리면 그 편향이 조용히 되살아나기 때문.
   */
  unrecordedYesterday: { classId: string; className: string; subject: string }[];
  /** 어제 날짜(YYYY-MM-DD) — 일별 미처리 페이지 링크용 */
  yesterday: string;
  /**
   * **오늘 이미 끝난 교시**인데 아직 출결이 다 안 찍힌 반(운영실 검토 2026-09-09 합의 1순위).
   * 🔴 분모는 "오늘 배정된 교시"가 아니라 **끝난 교시**다([`day-recording.ts`](./day-recording.ts)) —
   *    수업 중인 반까지 세면 130반 규모의 거짓 경보가 된다.
   * ⚠️ 헤더의 `처리 중 N/M`과 **축이 다르다**(그쪽은 시작한 교시 기준 합계) — 그래서 항목 note에 기준을 적는다.
   */
  unrecordedToday: { classId: string; className: string; subject: string }[];
  /** 최근 7일 녹음 전사/AI 분석 실패 건수(테이블별) */
  failedAnalysis: { meetings: number; enrollment: number; consultations: number };
  /** makeedu 동기화 이상(자동 동기화 ON일 때만) — 없으면 null */
  makeeduIssue: { kind: "error" | "stale"; detail: string } | null;
  // 🔴 `pendingExpenses`(지출 결재 대기)는 **운영실에서 뺐다**(원장 2026-08-29 *"운영실에서
  //    수납-지출결제대기 관련건은 빼버려"*) — 필드·수집·카드를 함께 지웠다. 결재는 /billing 지출 탭
  //    그대로다. 되살릴 땐 `action-signals.ts`의 `pending-expenses` 수집부터 복구할 것
  //    (필드만 되살리면 항상 0이다). 옛 주의사항: 총건수를 세야 한다(7일분만 세어 총건수처럼
  //    보고한 적이 있다 — 2026-07-31 실측 화면 13건 / 실제 미결 171건).
  /** 교재 신청 미처리(주문 전) */
  requestedTextbooks: number;
  /** 휴가 승인 대기(아직 안 끝난 휴가만) */
  leavesPending: number;
  /** 오늘 휴가 중인 직원 */
  leavesToday: { name: string }[];
  /**
   * 오늘 **첫 수업 학생 · 오늘이 마지막인 학생**(운영실 검토 2026-09-09, 3/3 합의).
   * 🔴 판정은 수강 행이 아니라 **학생 단위**다([`day-arrivals.ts`](./day-arrivals.ts)) — 반을 하나 더 받은
   *    학생이 '첫 수업'으로, 반 하나만 뺀 학생이 '마지막 수업'으로 잡히던 실측 오류를 그 순수 함수가 막는다.
   * 🔴 `starting` = 첫 등원(`first`) + 새 과목(`newSubject`) — 운영실 KPI '오늘첫수업'·원생목록 `first=`와
   *    **같은 함수의 결과 전체**다(같은 이름의 숫자가 갈리면 안 된다 — 원장 규칙, 링크 포함).
   * ⚠️ 라벨은 '퇴원'이 아니라 **'오늘 마지막 수업'** — 휴원으로 들어가는 학생도 여기 잡힌다.
   */
  dayArrivals: {
    starting: { studentId: string; name: string; kind: "first" | "newSubject" }[];
    ending: { studentId: string; name: string }[];
  };
  /** 오늘 접수된 등록상담(QR 공개접수·데스크 입력) — 칸반을 열기 전엔 아무도 모른다. */
  newIntakeToday: { count: number; names: string[] };
  /**
   * **신규생 체크리스트 지연** — 등록 90일 안 학생 중 기한이 지난 필수 항목이 있는 사람(원장 2026-09-09
   * *"당연히 운영실에서 관리되고 있는지 관리 안되고있는지 확인해야겠지?"*).
   * 🔴 판정은 신규생 탭과 **같은 순수 함수**([`newcomers/onboarding-items.ts`]) — 두 화면이 다른 수를 말하면 안 된다.
   * ⚠️ '필요시' 항목(2개월 콜)은 안 센다 · 첫 수업일을 모르는 항목은 기한이 없어 지연이 아니다.
   */
  newcomerOverdue: { count: number; names: string[] };
  /**
   * **내일** 발효되는 시간표 예약(개명·담임 교체·배치·반이동). 없으면 null.
   * 🔴 오늘 발효분은 cron이 이미 적용했으므로 세지 않는다 — 알아야 하는 건 "내일 아침 뭐가 바뀌나"다.
   */
  scheduledTomorrow: { date: string; hasStructure: boolean; hasEnrollment: boolean } | null;
  /**
   * 오늘 수업(시작됨)이 있는데 아직 보고서 0건인 학생 — 미작성 리마인더(5단계-1).
   * `bySubject`는 **학생×과목** 건수라 합이 count(학생 수)보다 클 수 있다(두 과목 다 미작성인 학생).
   * ⚠️ 과목은 반(class.subject)에서 온다 — `lesson_reports.subject`는 채움율이 4.5%(18,229행 중 822)라
   * 그쪽으로 세면 대부분이 "과목 미상"이 된다(2026-07-31 실측).
   */
  unwrittenReportsToday: { count: number; names: string[]; bySubject: { subject: string; count: number }[] };
  /**
   * 재원인데 활성 수강(반)이 0개인 학생 = 반 배정 필요(0097a RPC).
   * ⚠️ 출처는 students 테이블이지 등록상담이 아니다 — 등록상담을 거치지 않은 학생(임포트·선등록)도 잡는 게
   * 목적이라 상담 기준으로 재정의하지 말 것(2026-07-15 실측: 상담 기준은 89건 전원이 퇴원·과거 건 = 헛경보).
   */
  unassignedEnrolled: { studentId: string; name: string }[];
  /**
   * 반 미배정 재원생 **전체 수**. 위 배열은 미리보기라 RPC에서 상한(30)이 걸린다 —
   * ⚠️ 배열 길이를 건수로 쓰지 말 것: 상한에 닿는 순간 실제가 34명이든 50명이든 화면은 영원히 "30"이었다
   * (2026-07-31 실측: 브리핑 30 / 실제 34, 4명이 매일 조용히 누락).
   */
  unassignedEnrolledTotal: number;
  /**
   * ClassNote 발송 주의(관리자 조치 대상) — failed/tooOld=워커 확정 실패(7일 창),
   * humanHold=사람 조치 보류(blocked_shared·name_conflict, 창 없음), stuck=processing 10분 초과 멈춤.
   */
  classnoteAttention: { failed: number; tooOld: number; humanHold: number; stuck: number };
  /** 조회 실패를 0건으로 위장하지 않기 위한 권한·도메인별 원천 상태. */
  sourceIssues?: TodaySignalSourceIssue[];
};

export type TodaySignalSourceIssue = {
  key: string;
  label: string;
  href: string;
  menuKey: MenuKey;
  requiredAccess: TodayActionAccess;
};

export type TodayActionItem = {
  key: string;
  severity: "danger" | "amber" | "info";
  label: string;
  /** null = 카운트 없는 상태 신호(makeedu 등) */
  count: number | null;
  /** count의 단위 — 표시·요약·AI 프롬프트가 공유하는 단일 소스("30건"이 실은 30명이던 것 교정). */
  unit: "명" | "건" | "개 반" | null;
  /**
   * 개인 미리보기(학생·직원 이름). ⚠️ **AI 프롬프트에 넣지 말 것** — 브리핑 프롬프트는 라벨+수치만 보낸다.
   * 이름이 아닌 단서(범위·내역)는 `note`에 담아 프롬프트·요약이 함께 쓴다.
   */
  detail: string | null;
  /**
   * 비개인 단서 — 숫자를 해석하는 데 필요한 범위·내역("최근 7일", "발송 실패 8", "교재 단가표 763시간째").
   * 예전엔 이게 detail에 섞여 있어 요약·프롬프트가 통째로 버렸고, 그 결과 "지출 결재 대기 13건"처럼
   * **범위가 사라진 숫자**만 남았다. 개인정보가 없으므로 프롬프트·폴백 양쪽에서 그대로 쓴다.
   */
  note: string | null;
  /**
   * 과목별 분해(원장 지시 2026-07-31 — "과목별로 분류해서 보고하는 게 더 스마트"). 라벨은 **학원설정**에서
   * 온다(`subjectLabel` 주입) — 과목 라벨 하드코딩 금지 규칙 때문에 리졸버가 없으면 **비운다**(raw 키 노출 금지).
   * 신호마다 세는 단위가 달라(학생/반/학생×과목) 합이 count와 다를 수 있다 — 각 신호 주석 참조.
   */
  bySubject: { label: string; count: number }[];
  href: string;
  /** 현재 역할이 이 조치를 열 수 있는지 브리핑에서 판정할 메뉴 권한 키. */
  menuKey: MenuKey;
  /** 카드가 약속하는 조치를 실제로 수행하는 데 필요한 접근 수준. */
  requiredAccess: TodayActionAccess;
};

/**
 * "김A·이B·박C 외 2" — 명단 요약.
 * `total`은 이미 골라낸 미리보기만 넘길 때 전체 개수를 따로 알려주기 위한 것(기본값 = names 길이).
 * 예: 과목별로 고르게 2개를 뽑아 넘기면서 "외 N"은 전체 기준으로 세야 할 때.
 */
export function nameList(names: string[], max = 3, total = names.length): string {
  const head = names.slice(0, max).join("·");
  return total > max ? `${head} 외 ${total - max}` : head;
}

const SEVERITY_RANK: Record<TodayActionItem["severity"], number> = { danger: 0, amber: 1, info: 2 };

/** 과목 키 → 학원설정 라벨. 리졸버 없으면 분해를 포기한다(영문 raw 키를 화면에 흘리지 않기 위해). */
export type SubjectLabelResolver = (key: string) => string;

/**
 * 과목별 집계 — 건수 desc, 동수는 라벨순. 과목이 없는 행(subject null/빈값)은 **버리지 않고** 묶는다:
 * 조용히 빼면 분해 합이 총계보다 작아져 "어디 갔지"가 된다.
 */
function groupBySubject(
  rows: readonly { subject: string | null }[],
  subjectLabel: SubjectLabelResolver | undefined,
): { label: string; count: number }[] {
  if (!subjectLabel || rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.subject?.trim() ? subjectLabel(row.subject.trim()) : "과목 미상";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

/** 이미 집계된 `{subject,count}`에 라벨만 입힌다(같은 라벨로 접히면 합산 — 폐지 과목 흡수 대비). */
export function labelSubjectCounts(
  rows: readonly { subject: string; count: number }[],
  subjectLabel: SubjectLabelResolver | undefined,
): { label: string; count: number }[] {
  if (!subjectLabel || rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.subject.trim() ? subjectLabel(row.subject.trim()) : "과목 미상";
    counts.set(key, (counts.get(key) ?? 0) + row.count);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

/**
 * "어제 출석 미기록 12개 반" — 라벨 + 수치 한 줄.
 * 단위는 신호가 들고 온 것(명/개 반/건)을 쓴다 — 전부 "건"으로 찍어 30명을 30건으로 보고했던 것 교정.
 * 폴백 팀 보고(briefing-team-report)가 쓴다(옛 브리핑 카드 칩 briefing-links는 2026-11-10 삭제).
 */
export function actionCountLabel(item: Pick<TodayActionItem, "label" | "count" | "unit">): string {
  return item.count != null ? `${item.label} ${item.count}${item.unit ?? "건"}` : item.label;
}

/** "영어 147 · 수학 39" — 표시·요약·프롬프트가 공유하는 한 줄 표현. */
export function subjectBreakdownText(bySubject: readonly { label: string; count: number }[]): string | null {
  if (bySubject.length === 0) return null;
  return bySubject.map((s) => `${s.label} ${s.count}`).join(" · ");
}

/** 판정에 쓰는 보고서 한 건. `reportDate` 없음 = 오늘 쓴 것(옛 호출부 호환). */
export type ObligationReport = {
  studentId: string;
  subject: string | null;
  reportDate?: string;
  /** 0136a — 이 보고서가 대신한 실제 수업일(미리 쓴 보고서·연속 수업). */
  coversDate?: string | null;
};

export type ReportObligation = { studentId: string; subject: string; classIds: string[] };

/**
 * **오늘 보고서 의무 판정 — 운영실·일일 브리핑 '미작성 보고서'와 수업보고서 '작성률' 카드의 오늘 열이 같이 쓰는 한 벌**
 * (점검 2026-09-28 *"같은 곳을 물어보고 있는데 서로 다른 대답"* — 두 화면이 과목·결석·작성 인정·미리 쓴 보고서를 각자 판정했다).
 *
 * 단위 = **학생×과목 쌍**. lesson_reports에는 반이 없어(옛 행) 같은 학생의 같은 과목 여러 반은 한 대상으로 합친다.
 *   · 결석 — 그 과목의 시작된 반이 **전부** 결석이면 대상이 아니다(다른 과목 반의 결석은 상관없다).
 *   · 작성 인정 — **그 과목** 보고서만(수학 보고서가 영어를 채우지 않는다). 과목 없는 옛 보고서는 그날 그 학생의 전 과목을 채운다.
 *   · 미리 쓴 보고서 — 다른 날 쓰고 오늘을 `covers_date`로 지정한 보고서가 있으면 오늘 의무는 이미 끝났다(대상 아님).
 * 반환 `due` = 오늘 써야 하는 쌍(작성 여부 무관), `missing` = 그중 아직 안 쓴 쌍. `classIds` = 그 쌍의 출석한 반.
 * 학생 첫 등장 순서 — 호출부가 학생 단위로 접으면 "미작성 N명", 과목으로 묶으면 "수학 39"가 된다.
 * ⚠️ 작성 예외 강사·테스트 학생·미발송 반·세는 과목은 **대상(targets)을 만들 때** 호출부가 거른다 — 두 호출부가 같은 재료를 쓴다.
 */
export function judgeTodayLessonReports(
  targets: readonly { studentId: string; classId: string; subject: string }[],
  absentClassKeys: ReadonlySet<string>,
  reports: readonly ObligationReport[],
  today?: string,
): { due: ReportObligation[]; missing: ReportObligation[] } {
  const classesByTarget = new Map<string, Set<string>>();
  const studentOrder: string[] = [];
  const seenStudents = new Set<string>();

  for (const target of targets) {
    const key = `${target.studentId}::${target.subject}`;
    const classes = classesByTarget.get(key) ?? new Set<string>();
    classes.add(target.classId);
    classesByTarget.set(key, classes);
    if (!seenStudents.has(target.studentId)) {
      seenStudents.add(target.studentId);
      studentOrder.push(target.studentId);
    }
  }

  const writtenToday = (r: ObligationReport) => !today || r.reportDate === undefined || r.reportDate === today;
  const coversToday = (r: ObligationReport) => !!today && !!r.coversDate && r.coversDate === today && !writtenToday(r);
  const hasSubject = (r: ObligationReport): r is ObligationReport & { subject: string } => !!r.subject?.trim();
  // 과목 컬럼 도입 전 레거시/cron 보고서는 subject=null일 수 있다. 이미 보고서가 존재하는 학생을
  // 미작성으로 잘못 재촉하지 않도록 null/빈 과목 보고서는 그날 해당 학생의 모든 과목을 충족한 것으로 본다.
  const legacyReportedStudents = new Set(reports.filter((r) => writtenToday(r) && !hasSubject(r)).map((r) => r.studentId));
  const reported = new Set(reports.filter((r) => writtenToday(r) && hasSubject(r)).map((r) => `${r.studentId}::${r.subject}`));
  const legacyCoveredStudents = new Set(reports.filter((r) => coversToday(r) && !hasSubject(r)).map((r) => r.studentId));
  const covered = new Set(reports.filter((r) => coversToday(r) && hasSubject(r)).map((r) => `${r.studentId}::${r.subject}`));

  const dueByStudent = new Map<string, ReportObligation[]>();
  const missingByStudent = new Map<string, ReportObligation[]>();
  for (const [targetKey, classIds] of classesByTarget) {
    const separator = targetKey.indexOf("::");
    const studentId = targetKey.slice(0, separator);
    const subject = targetKey.slice(separator + 2);
    if (legacyCoveredStudents.has(studentId) || covered.has(targetKey)) continue;
    const attended = [...classIds].filter((classId) => !absentClassKeys.has(`${studentId}::${classId}`));
    if (attended.length === 0) continue;
    const pair = { studentId, subject, classIds: attended };
    dueByStudent.set(studentId, [...(dueByStudent.get(studentId) ?? []), pair]);
    if (legacyReportedStudents.has(studentId) || reported.has(targetKey)) continue;
    missingByStudent.set(studentId, [...(missingByStudent.get(studentId) ?? []), pair]);
  }

  return {
    due: studentOrder.flatMap((id) => dueByStudent.get(id) ?? []),
    missing: studentOrder.flatMap((id) => missingByStudent.get(id) ?? []),
  };
}

/** `judgeTodayLessonReports`의 미작성 쌍만 — 운영실 신호가 쓰던 모양. */
export function findMissingLessonReportPairs(
  targets: readonly { studentId: string; classId: string; subject: string }[],
  absentClassKeys: ReadonlySet<string>,
  reports: readonly ObligationReport[],
  today?: string,
): { studentId: string; subject: string }[] {
  return judgeTodayLessonReports(targets, absentClassKeys, reports, today).missing.map(({ studentId, subject }) => ({
    studentId,
    subject,
  }));
}

/**
 * 그날 **결석한 반** 키(`학생::반`) — 정정 줄은 최신 하나만(`effectiveAttendanceRecords`), 그 반의 교시가 **전부** 결석일 때만.
 * 한 교시라도 온 반은 결석한 반이 아니다. 세 호출부(운영실 미작성 보고서 · 강사 업무 카드 · 작성률 카드)가 같은 규칙으로 결석을 뺀다.
 * 결석 = `ABSENT_STATUSES`(결석·공결 — 출석부에 둘 다 '결석'으로 서는 상태). 원장 2026-10-14 *"결석이 있으면 분모에서 빼야함"* —
 * 전에는 'absent'만 봐서 공결 학생이 보고서 분모에 남았다.
 */
const ABSENT = new Set<string>(ABSENT_STATUSES);

export function absentClassKeysOf(rows: readonly (EffectiveAttendanceRecord & { status: string })[]): Set<string> {
  const byKey = new Map<string, boolean>();
  for (const r of effectiveAttendanceRecords(rows)) {
    const key = `${r.student_id}::${r.class_id}`;
    byKey.set(key, (byKey.get(key) ?? true) && ABSENT.has(r.status));
  }
  return new Set([...byKey].filter(([, allAbsent]) => allAbsent).map(([key]) => key));
}

export function buildTodayActions(
  raw: TodayActionsRaw,
  opts: { subjectLabel?: SubjectLabelResolver } = {},
): TodayActionItem[] {
  const items: TodayActionItem[] = [];
  const { subjectLabel } = opts;

  if (raw.absentToday.length > 0) {
    // 🔴 **숫자는 깎지 않는다**(사전 통보 결석도 오늘 결석이다 — 원장 2026-08-29 규약과 같은 결).
    //    가르는 것은 **연락 대상**뿐이라 이름 미리보기가 무통보를 앞세우고, 내역은 note가 말한다.
    //    실측 2026-09-09: 최근 14일 결석 303건 중 사전 통보 78건(4분의 1)이 이미 양해된 건이었다.
    const unnotified = raw.absentToday.filter((student) => !student.preNotified);
    const preNotifiedCount = raw.absentToday.length - unnotified.length;
    const absentPreview = unnotified.length > 0 ? unnotified : raw.absentToday;
    items.push({
      key: "absent",
      severity: "danger",
      // 결석·공결로 한 교시도 안 온 학생(공결은 2026-07-10 입력 폐지 — 옛 행·정정분만 걸린다).
      // 사전 통보 결석도 결석이다 — "무단결석"으로 부르지 말 것(raw 주석 참조).
      label: "오늘 결석",
      count: raw.absentToday.length,
      unit: "명",
      detail: nameList(absentPreview.map((s) => s.name), 3, absentPreview.length),
      note: preNotifiedCount > 0 ? `연락 필요 ${unnotified.length} · 사전 통보 ${preNotifiedCount}` : null,
      // 학생은 이미 dedupe돼 있다 — 두 과목에서 결석한 학생은 두 과목 모두에 잡히지 않고 첫 기록 과목에만 든다.
      bySubject: groupBySubject(raw.absentToday, subjectLabel),
      // 그 기준일의 결석 학생 목록(브리핑이면 어제) — 운영실 KPI ↗와 같은 목적지.
      href: absentDayHref(raw.date),
      menuKey: "attendance",
      requiredAccess: "read",
    });
  }

  // ── 오늘 사람 변동 — 맞이·환송·명단 수정으로 이어지는 신호(운영실 검토 2026-09-09, 3/3 합의).
  //    헤더 재원 증감은 '이번 달', 추세 카드는 '7일'이라 "오늘 맞이할 아이"를 아무 화면도 말해 주지 않았다.
  if (raw.dayArrivals.starting.length > 0) {
    // 첫 수업 = 첫 등원 + 새 과목(운영실 KPI '오늘첫수업'과 같은 함수·같은 숫자). 새 과목이 있으면 카드와 같은 말로 갈라 적는다.
    const newSubject = raw.dayArrivals.starting.filter((s) => s.kind === "newSubject").length;
    items.push({
      key: "arrivals-start",
      severity: "amber",
      label: "오늘 첫 수업",
      count: raw.dayArrivals.starting.length,
      unit: "명",
      detail: nameList(raw.dayArrivals.starting.map((s) => s.name)),
      note: newSubject > 0 ? `첫 등원 ${raw.dayArrivals.starting.length - newSubject} · 처음 듣는 과목 ${newSubject}` : null,
      bySubject: [], // 학생 단위 판정이라 과목 축이 없다(한 학생이 여러 과목으로 시작할 수 있다).
      // 그날 첫 수업 목록(원생목록 first=) — 항목 숫자 = 카드 숫자 = 목록 인원(같은 함수).
      href: studentsFirstClassHref(raw.date),
      menuKey: "students",
      requiredAccess: "read",
    });
  }
  if (raw.dayArrivals.ending.length > 0) {
    const only = raw.dayArrivals.ending.length === 1 ? raw.dayArrivals.ending[0] : null;
    items.push({
      key: "arrivals-end",
      severity: "amber",
      // 🔴 '퇴원'이 아니다 — 휴원으로 들어가는 학생도 여기 잡힌다(day-arrivals.ts 주석).
      label: "오늘 마지막 수업",
      count: raw.dayArrivals.ending.length,
      unit: "명",
      detail: nameList(raw.dayArrivals.ending.map((s) => s.name)),
      note: null,
      bySubject: [],
      href: only ? `/students/${only.studentId}` : "/students",
      menuKey: "students",
      requiredAccess: "read",
    });
  }

  if (raw.newIntakeToday.count > 0) {
    items.push({
      key: "intake-today",
      severity: "info",
      label: "오늘 접수된 상담",
      count: raw.newIntakeToday.count,
      unit: "건",
      detail: nameList(raw.newIntakeToday.names, 3, raw.newIntakeToday.count),
      note: null,
      bySubject: [],
      // 그날 접수된 콜&상담 목록(created_at KST 하루) — 운영실 KPI '신규문의' ↗와 같은 목적지.
      href: intakeDayHref(raw.date),
      menuKey: "enrollment",
      requiredAccess: "read",
    });
  }

  // 신규생 관리 — 등록 직후 90일은 되돌리기 가장 쉬운 구간이라, 놓친 절차를 그날 알아야 한다.
  if (raw.newcomerOverdue.count > 0) {
    items.push({
      key: "newcomer-overdue",
      severity: "amber",
      label: "신규생 관리 기한 경과",
      count: raw.newcomerOverdue.count,
      unit: "명",
      detail: nameList(raw.newcomerOverdue.names, 3, raw.newcomerOverdue.count),
      note: "사전 콜·첫 수업 안내·OJT·만족도 콜 기준",
      bySubject: [],
      href: "/newcomers?list=1",
      menuKey: "newcomers",
      requiredAccess: "read",
    });
  }

  if (raw.scheduledTomorrow) {
    const scheduledParts = [
      raw.scheduledTomorrow.hasStructure ? "수업 배치" : null,
      raw.scheduledTomorrow.hasEnrollment ? "학생 반이동" : null,
    ].filter((part): part is string => part !== null);
    items.push({
      key: "scheduled-tomorrow",
      severity: "info",
      label: "내일 시간표 적용 예정",
      count: null,
      unit: null,
      detail: null,
      // 무엇이 바뀌는지(반 이름·담임)는 시간표 배지가 말한다 — 여기선 갈래만.
      note: scheduledParts.length > 0 ? scheduledParts.join(" · ") : null,
      bySubject: [],
      href: "/timetable",
      menuKey: "timetable",
      requiredAccess: "read",
    });
  }

  const analysisItems: ReadonlyArray<{
    key: string;
    count: number;
    label: string;
    href: string;
    menuKey: MenuKey;
    requiredAccess: TodayActionItem["requiredAccess"];
  }> = [
    {
      key: "failed-analysis-meetings",
      count: raw.failedAnalysis.meetings,
      label: "회의 녹음 분석 실패",
      href: "/meetings",
      menuKey: "meetings",
      requiredAccess: "write",
    },
    {
      key: "failed-analysis-enrollment",
      count: raw.failedAnalysis.enrollment,
      label: "신규 콜&상담 녹음 분석 실패",
      href: "/enrollment?view=kanban", // 일하러 가는 링크 = 칸반 고정(저장된 보기가 통계여도 카드가 보이게)
      menuKey: "enrollment",
      requiredAccess: "write",
    },
    {
      key: "failed-analysis-consultations",
      count: raw.failedAnalysis.consultations,
      label: "학생상담 녹음 분석 실패",
      href: "/consultations?list=1",
      menuKey: "consultations",
      requiredAccess: "write",
    },
  ];
  for (const analysis of analysisItems) {
    if (analysis.count === 0) continue;
    items.push({
      ...analysis,
      severity: "danger",
      unit: "건",
      detail: null,
      note: "최근 7일",
      bySubject: [],
    });
  }

  if (raw.unwrittenReportsToday.count > 0) {
    items.push({
      key: "unwritten-reports",
      severity: "amber",
      label: "오늘 미작성 보고서",
      // 보고서 장수가 아니라 **대상 학생 수**다(학생×과목을 학생 단위로 합침) — 단위는 명.
      count: raw.unwrittenReportsToday.count,
      unit: "명",
      detail: nameList(raw.unwrittenReportsToday.names),
      note: null,
      // ⚠️ 학생×과목 쌍이라 **합이 count(학생 수)보다 클 수 있다**(두 과목 다 미작성인 학생).
      bySubject: labelSubjectCounts(raw.unwrittenReportsToday.bySubject, subjectLabel),
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
      requiredAccess: "read",
    });
  }

  const cn = raw.classnoteAttention;
  const cnTotal = cn.failed + cn.tooOld + cn.humanHold + cn.stuck;
  if (cnTotal > 0) {
    // raw 상태 키(blocked_shared 등)는 화면에 내보내지 않는다 — 한글 구분만(UI raw 코드 노출 금지).
    const cnParts = [
      cn.failed > 0 ? `발송 실패 ${cn.failed}` : null,
      cn.tooOld > 0 ? `기한 초과 ${cn.tooOld}` : null,
      cn.humanHold > 0 ? `확인 필요 ${cn.humanHold}` : null,
      cn.stuck > 0 ? `멈춤 ${cn.stuck}` : null,
    ].filter((part): part is string => part !== null);
    items.push({
      key: "classnote-attention",
      severity: "amber",
      label: "리포트 발송 주의",
      count: cnTotal,
      unit: "건",
      detail: null,
      note: cnParts.join(" · "),
      // 과목 분해 없음(의도): 4개 버킷의 조회 창이 서로 달라(7일/전체) 부분 집계가 총계와 안 맞는다.
      // 게다가 lesson_reports.subject는 채움율 4.5%라 대부분 "과목 미상"이 된다.
      bySubject: [],
      href: "/lesson-reports?tab=writing",
      menuKey: "lesson_reports",
      requiredAccess: "read",
    });
  }

  const unassignedTotal = raw.unassignedEnrolledTotal;
  if (unassignedTotal > 0) {
    // 소수(대개 1~2명)라 1명이면 그 학생 창으로 바로, 여럿이면 학생목록으로(목록엔 '미수강만' 필터가 없음).
    const only = unassignedTotal === 1 ? raw.unassignedEnrolled[0] : null;
    items.push({
      key: "unassigned-enrolled",
      severity: "amber",
      label: "반 미배정 재원생",
      // ⚠️ 배열 길이가 아니라 총계 — 미리보기 배열은 RPC 상한(30)에서 잘린다(raw 주석).
      count: unassignedTotal,
      unit: "명",
      detail: nameList(raw.unassignedEnrolled.map((s) => s.name), 3, unassignedTotal),
      note: null,
      bySubject: [], // 수강이 0개인 학생이라 과목이 없다.
      href: only ? `/students/${only.studentId}` : "/students",
      menuKey: "students",
      requiredAccess: "write",
    });
  }

  if (raw.unrecordedToday.length > 0) {
    items.push({
      key: "unrecorded-today",
      severity: "amber",
      label: "오늘 출석 미기록",
      count: raw.unrecordedToday.length,
      unit: "개 반",
      detail: nameList(
        balancedTake(raw.unrecordedToday, (c) => c.subject, 2).map((c) => c.className),
        2,
        raw.unrecordedToday.length,
      ),
      // 🔑 기준을 적는다 — 헤더의 '처리 중 N/M'은 **시작한** 교시 기준이라 두 숫자가 다를 수 있다.
      note: "종료된 교시 기준",
      bySubject: groupBySubject(raw.unrecordedToday, subjectLabel),
      href: "/attendance/live",
      menuKey: "attendance",
      requiredAccess: "read",
    });
  }

  if (raw.unrecordedYesterday.length > 0) {
    items.push({
      key: "unrecorded",
      severity: "amber",
      label: "어제 출석 미기록",
      count: raw.unrecordedYesterday.length,
      unit: "개 반",
      // ⚠️ 앞 2개를 그냥 자르지 않는다(gotcha #84). 목록이 이름순인데 ICU 한국어 정렬은 한글을
      // 로마자보다 앞에 둬서, 한글 이름 반(수학)이 미리보기를 독점하고 로마자 코드 반(영어)은
      // 미기록이 아무리 많아도 이름이 절대 안 뜬다 — 영어 담당자는 자기 반이 걸렸는지 알 수 없었다.
      // 과목별로 고르게 2개를 뽑고 "외 N"은 전체 기준으로 센다.
      detail: nameList(
        balancedTake(raw.unrecordedYesterday, (c) => c.subject, 2).map((c) => c.className),
        2,
        raw.unrecordedYesterday.length,
      ),
      note: null,
      bySubject: groupBySubject(raw.unrecordedYesterday, subjectLabel),
      href: `/attendance/${raw.yesterday}`,
      menuKey: "attendance",
      requiredAccess: "read",
    });
  }

  // 🔴 '지출 결재 대기'는 **운영실에서 뺐다**(원장 2026-08-29 *"운영실에서 수납-지출결제대기
  //    관련건은 빼버려"*). 결재 자체는 /billing 지출 탭에서 그대로 한다 — 운영실이 매일 재촉할 일이
  //    아니라는 판단이다. 되살릴 땐 이 카드와 `action-signals.ts`의 `pending-expenses` 수집을 **함께**.

  if (raw.requestedTextbooks > 0) {
    items.push({
      key: "textbooks",
      severity: "amber",
      label: "교재 신청 미처리",
      count: raw.requestedTextbooks,
      unit: "건",
      detail: null,
      note: null,
      bySubject: [],
      href: "/billing?tab=textbooks&status=requested",
      menuKey: "billing",
      requiredAccess: "write",
    });
  }

  if (raw.leavesPending > 0) {
    items.push({
      key: "leaves-pending",
      severity: "amber",
      label: "휴가 승인 대기",
      count: raw.leavesPending,
      unit: "건",
      detail: null,
      note: null,
      bySubject: [],
      href: "/staff/leaves",
      menuKey: "staff",
      requiredAccess: "manage-staff",
    });
  }

  if (raw.makeeduIssue) {
    items.push({
      key: "makeedu",
      severity: "amber",
      label: "makeedu 동기화 이상",
      count: null,
      unit: null,
      detail: null,
      // 어느 도메인이 얼마나 밀렸는지가 이 신호의 전부다 — note라야 요약·프롬프트까지 함께 간다.
      note: raw.makeeduIssue.detail,
      bySubject: [],
      href: "/owner?tab=sheets&sub=makeedu",
      menuKey: "owner",
      requiredAccess: "read",
    });
  }

  if (raw.leavesToday.length > 0) {
    items.push({
      key: "leaves-today",
      severity: "info",
      label: "오늘 휴가",
      count: raw.leavesToday.length,
      unit: "명",
      detail: nameList(raw.leavesToday.map((l) => l.name)),
      note: null,
      bySubject: [],
      href: "/staff/leaves",
      menuKey: "staff",
      requiredAccess: "read",
    });
  }

  for (const issue of raw.sourceIssues ?? []) {
    items.push({
      key: `source-issue-${issue.key}`,
      severity: "amber",
      label: `${issue.label} 확인 불가`,
      count: null,
      unit: null,
      detail: null,
      note: "새로고침 후 다시 확인해 주세요",
      bySubject: [],
      href: issue.href,
      menuKey: issue.menuKey,
      requiredAccess: issue.requiredAccess,
    });
  }

  // 심각도(danger→amber→info) → 건수 desc(카운트 없는 상태 신호는 뒤로).
  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.count ?? -1) - (a.count ?? -1),
  );
}
