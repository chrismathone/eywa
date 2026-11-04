import type { attendanceOverview } from "@/features/dashboard/overview/attendance-day";
import type { MonthChange, OverviewData } from "@/features/dashboard/overview/model";
import type { MonthStat } from "@/features/enrollment/server/stats-queries";
import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";
import type { TeacherWork } from "@/features/dashboard/overview/teacher-work";
import type { StatsBucket } from "@/features/consultations/stats-model";
import type { HomeroomTrendRow } from "@/features/consultations/stats-recent";
import type { HomeroomCell } from "@/features/consultations/homeroom-model";
import type { SubjectSetting } from "@/features/owner/settings-types";

/** 달 키(YYYY-MM)별 값. 카드의 달과 키로 맞춘다 — 배열 자리로 맞추면 시작 달이 다른 카드에서 밀린다. */
export type MonthValues = Record<string, number>;

/** 학생 id → 반·과목·담임. 그만둔 학생은 마지막 반이다. */
/** `teacherId` = 지금 담임의 사람 id(업무 요청이 학생을 그 담임에게 맡길 때 — 이름으로 사람을 찾지 않는다). */
export type RosterEntry = { classId: string; className: string; subject: string; teacher: string | null; teacherId: string | null };
export type StudentRoster = { students: Record<string, RosterEntry[]>; classTeachers: Record<string, string>; classSubjects: Record<string, string> };

/** 그 프로그램을 듣는 재원생의 구성 — 카드와 같은 집계. */
export type SplitRow = { label: string; englishOnly: number; both: number; mathOnly: number };
export type ProgramComposition = { students: number; levels: SplitRow[]; grades: SplitRow[] };

/** 이번 달 담임 본인이 상담하지 않은 학생. `prev` = 지난달 칸(지난달이 없으면 null). */
export type ConsultPending = { id: string; name: string; grade: string | null; prev: HomeroomCell | null; last: string | null };
/** 담임별 상담 — 열은 지난달 · 이번 달이다(`homeroomTrendRows`). `classNames`는 영어 반을 EiE · 인재원 영어로 가르는 재료. */
export type ConsultHomeroom = { months: string[]; rows: (HomeroomTrendRow & { classNames: string[]; pending: ConsultPending[] })[] };
/** 학생 상담 카드·상세. 주·달은 오래된 순이고 끝 칸이 진행 중이다. */
export type ConsultExtras = { weeks: StatsBucket[]; months: StatsBucket[]; bySubject: Record<string, number[]> | null; categories: { label: string; recent: number }[]; homeroom: ConsultHomeroom | null };

/** 과목 키 → 그 과목 반의 오늘·14일 출결. 운영실 카드와 같은 함수로 센다. */
export type AttendanceBySubject = Record<string, ReturnType<typeof attendanceOverview>>;

/** 반복 결석 학생의 반 한 줄 — 같은 학생이 반마다 한 줄이다. `dates` = 사전 통보 제외 결석일 · `notified` = 사전 통보 결석 수. */
export type AbsenceLine = {
  studentId: string; name: string; schoolGrade: string | null; classId: string; className: string; subject: string | null;
  teacherId: string | null; teacher: string | null; dates: string[]; notified: number;
};

/** 열린 할 일 현황 — `open`은 기한 초과(`late`)를 포함한다. 사람마다 `kinds` = 기한 지난 할 일의 종류(업무 비서 · 사람별 표가 '무엇이 몰렸는지' 말한다). */
export type LateTask = { id: string; kind: string; title: string; link: string | null; dueAt: string };
export type TaskBoard = { kinds: { kind: string; open: number; late: number }[]; people: { id: string; name: string; open: number; late: number; kinds?: { kind: string; late: number }[]; items?: LateTask[] }[] };

/** 보고서 주·달 한 칸. `sent`·`read` = 보낸 지 48시간이 지난 보고서 · 그중 48시간 안에 확인한 것. */
export type ReportCell = { key: string; reports: number; parsed: number; low: number; notSubmitted: number; zero: number; sent: number; read: number; unread: number };
/** 숙제 60% 미만 기록이 있는 학생. `parsed` = 수행률을 판정한 기록 수. */
export type HomeworkStudent = { id: string; name: string; schoolGrade: string | null; low: number; parsed: number; notSubmitted: number; zero: number; last: string; classes: { classId: string; subject: string | null }[] };
/** 학습 · 학부모 보고 카드·상세. `read` = 최근 30일 합계(ClassNote가 꺼지면 없다) · `students`는 학생 메뉴를 볼 수 있을 때만. */
export type ReportExtras = { weeks: ReportCell[]; months: ReportCell[]; read: { read: number; sent: number } | null; students: HomeworkStudent[] | null };

/**
 * '대시보드 전환' 화면이 스냅샷 말고 더 받는 값. 첫 그림을 막지 않게 화면을 연 뒤 따로 읽는다(`/api/dashboard/instruments`).
 * `subjects`가 비면 과목 탭이 서지 않는다(강사 범위·과목 관리자 화면 — 카드가 이미 그 범위로 좁혀져 있다).
 */
export type InstrumentExtras = {
  subjects: { key: string; label: string }[];
  enrolled: Record<string, MonthValues> | null;
  courses: Record<string, MonthValues> | null;
  changes: Record<string, { enrolled: MonthValues; withdrawn: MonthValues }> | null;
  billing: Record<string, MonthValues> | null;
  /** 상세의 '1년 · 전체' 기간 — 기록이 정확한 달부터. 카드는 스냅샷의 6개월을 그대로 쓴다. */
  longChanges: MonthChange[] | null;
  longBilling: SubjectBillingSummary[] | null;
  /** 신규 콜&상담 달별 값 — 카드는 스냅샷의 두 달만 읽는다. */
  longAdmissions: MonthStat[] | null;
  /** 오늘 시간표의 영어 반을 EiE로 칠하는 재료. */
  eieClassIds: string[];
  /** 프로그램 키 → 재원생 구성(상세의 과목 탭이 표를 바꾼다). */
  composition: Record<string, ProgramComposition> | null;
  roster: StudentRoster | null;
  /** 강사별 업무 — 직원 평가 '업무 현황'을 볼 수 있는 사람에게만 실린다. */
  teacherWork: TeacherWork | null;
  /** 등록 후 3개월 내 퇴원 — 운영실 기본 배치에는 없는 카드라 스냅샷에 안 실린다. 퇴원관리 권한이 있을 때만. */
  earlyExits: OverviewData["earlyExits"] | null;
  /** 지난 달들의 퇴원 명단(달마다 막대를 눌렀을 때). */
  earlyNames: OverviewData["earlyExits"]["rows"] | null;
  /** 학생 상담 카드가 놓였을 때만. 🔴 과목 관리자 화면엔 없다(이 값은 과목을 뺄 수 없어 학원 전체가 섞인다). */
  consult: ConsultExtras | null;
  /** 학습 · 학부모 보고 카드가 놓였을 때만. 수업보고서 통계처럼 강사 범위·과목 관리자 화면엔 없다. */
  report: ReportExtras | null;
  /** 출결 카드가 놓였을 때만. 과목 값이라 강사 범위·과목 관리자 화면엔 없다. */
  attendance: AttendanceBySubject | null;
  /** 반복 결석 계층 — 출결 값을 볼 수 있을 때만. */
  absenceLines: AbsenceLine[] | null;
  /** 열린 할 일 현황(종류별 · 담당자별 미처리 · 그중 기한 초과) — 업무 처리 현황을 볼 수 있는 사람에게만. */
  taskBoard: TaskBoard | null;
  /** 학원 설정의 과목 — 콜&상담 과목 칸(자유 글자)을 묶음으로 읽는 재료(`consultGroupsOf`). 학원 범위 화면에만(없으면 묶음 없음). */
  settingSubjects?: SubjectSetting[];
};

export const NO_EXTRAS: InstrumentExtras = { subjects: [], enrolled: null, courses: null, changes: null, billing: null, longChanges: null, longBilling: null, longAdmissions: null, eieClassIds: [], composition: null, roster: null, teacherWork: null, earlyExits: null, earlyNames: null, consult: null, report: null, attendance: null, absenceLines: null, taskBoard: null };

export type ExtrasKey = keyof InstrumentExtras;
/**
 * 라우트의 답 — 읽은 칸만 싣고(`?part=checks`면 확인할 일에 드는 칸만) `failed` = 읽지 못한 칸.
 * 화면은 실린 칸만 바꾸고 실패한 칸은 이전 값을 그대로 둔다(`mergeExtras`).
 */
export type ExtrasReply = Partial<InstrumentExtras> & { failed: ExtrasKey[] };
/** 확인할 일 · 업무 비서 후보가 읽는 칸 — 이 칸을 못 읽었으면 비서 후보를 남기지 않고 AI 정리도 멈춘다. */
export const BRIEF_EXTRAS: readonly ExtrasKey[] = ["absenceLines", "consult", "report", "roster", "taskBoard"];

export function mergeExtras(prev: InstrumentExtras, reply: ExtrasReply): InstrumentExtras {
  const out: Record<string, unknown> = { ...prev };
  for (const [key, value] of Object.entries(reply)) if (key !== "failed" && !reply.failed.includes(key as ExtrasKey)) out[key] = value;
  return out as InstrumentExtras;
}
