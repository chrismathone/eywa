import Link from "next/link";
import { Fragment, Suspense, type ReactNode } from "react";
import { isValidYm, kstMonth, kstToday, monthLabel, monthRange, shiftMonth } from "@/lib/date-kst";
import { withdrawalMonthWindow, withdrawalProgram } from "@/features/withdrawals/window";
import {
  inRange,
  parseType,
  resolveRange,
  sortExitRows,
  toExitRows,
  type ExitRow,
  type RangeKey,
  type TypeKey,
} from "@/features/withdrawals/exit-rows";
import { parseProgram, programLabel, subjectGroupOf, visiblePrograms, type Program } from "@/features/students/enrollment/program";
import { isModuleEnabled } from "@/lib/modules";
import {
  UserMinus,
  CalendarClock,
  ListChecks,
  Filter,
  UserX,
  BookOpen,
  X,
} from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchToggle } from "@/components/search-toggle";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_ON, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { EmbedLink } from "@/components/embed-link";
import { tipProps } from "@/components/hover-tip/tip";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { requireAccess } from "@/lib/auth/require-access";
import { relativeDayKo } from "@/lib/relative-time";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  getWithdrawnStudents,
  getSubjectEndedStudents,
  REASON_LABEL,
  type WithdrawalReason,
} from "@/features/withdrawals/server/queries";
import {
  FACET_NONE,
  REASON_CLEANUP,
  parseBreakdownAxis,
  teacherFacetsIn,
  type RowTeachers,
  REASON_TEXT_PREFIX,
  REASON_UNSPECIFIED,
  attributeTeachers,
  gradeItems,
  gradeOf,
  judgeSubjects,
  parseFacet,
  reasonFacetLabel,
  reasonFacetOf,
  detailFacetLabel,
  detailItems,
  reasonDetailFacetOf,
  schoolItems,
  schoolOf,
  subjectComboItems,
  subjectItems,
  teacherCellText,
  teacherFacetLabel,
  teacherFilterOptions,
  teacherItems,
} from "@/features/withdrawals/breakdown";
import { loadExitTeacherJudge, type ExitTeacherJudge } from "@/features/withdrawals/server/exit-teacher-judge";
import { mergeSheetExits } from "@/features/withdrawals/sheet-exit-rows";
import { loadSheetExits, loadStudentNames } from "@/features/withdrawals/server/sheet-teachers";
import { teacherNames } from "@/features/withdrawals/server/exit-overlay-loaders";
import { createClient } from "@/lib/supabase/server";
import { reportWarning } from "@/lib/observability/report-error";
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WithdrawalTrendChart, type WithdrawalMonthPoint } from "./_components/trend-chart";
import { scopeText, spanText } from "@/features/withdrawals/scope-text";
import { EXIT_BASIS_TAG, countedEarlierByMonth, countedEarlierTitle } from "@/features/withdrawals/exit-basis";
import { loadWithdrawalTrendPrefs } from "@/features/withdrawals/server/trend-prefs";
import { WithdrawalListLayout } from "./_components/list-layout";
import { CustomRange } from "./_components/custom-range";
import { withdrawalPage, withdrawalPageSize } from "@/features/withdrawals/list-pagination";
import {
  EARLY_MAX_DAYS,
  EARLY_SPANS,
  earlyCounts,
  earlySpan,
  isEarlyWithin,
  parseEarly,
  type EarlyKey,
} from "@/features/withdrawals/early-exit";
import { EarlyExitBand } from "./_components/early-exit-band";
import { WithdrawalBreakdownCard, type BreakdownRow, type BreakdownView } from "./_components/breakdown-card";
import { ReasonAnalysisCard } from "./_components/reason-analysis-card";
import { TeacherChurnSection, TeacherChurnSkeleton } from "./_components/teacher-churn-section";
import { getTeacherChurnGate } from "@/features/withdrawals/server/teacher-churn";
import { REASON_DETAILS, reasonDetailOf } from "@/features/withdrawals/reason-detail";
import type { BreakdownAxis } from "@/features/withdrawals/breakdown";

export const metadata = { title: "퇴원관리 — 에이와" };

/** 최근 12개월 추이(기간 축 제외 모집단) — 모듈 함수라 RSC 본문 아님(new Date 허용, #11). */
function monthlyExits(rows: { countDate: string | null }[]): WithdrawalMonthPoint[] {
  // 🔴 달 축은 **KST** — `new Date().getMonth()`는 서버가 UTC라 매달 1일 새벽에 12개월 창이 한 달 밀린다.
  const thisMonth = kstMonth();
  const months: { key: string; point: WithdrawalMonthPoint }[] = [];
  for (let i = 11; i >= 0; i--) {
    const key = shiftMonth(thisMonth, -i);
    months.push({ key, point: { label: `${Number(key.slice(5))}월`, count: 0 } });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    // `countDate`는 이미 KST 달력 날짜다(퇴원월 기준 날짜·수강 종료일) — UTC로 다시 풀지 않는다.
    // 퇴원은 퇴원월(수강료를 낸 마지막 달, 원장 2026-10-29)의 막대에 선다.
    const i = idx.get(r.countDate?.slice(0, 7) ?? "");
    if (i != null) months[i]!.point.count++;
  }
  return months.map((m) => m.point);
}

/**
 * 사유 필터 값 — 표준 사유 키 · 미기재 · 장부 정리 · 자유 글(`t:반 폐지`). 사유 카드의 막대와 같은 묶음(`reasonFacetOf`)이라
 * 막대를 눌러 거른 명단 수가 막대 숫자와 같다.
 */
type ReasonKey = string;
type ConsultKey = "all" | "pending" | "done";

/**
 * 드롭다운 항목 — 해제 항목('전체')은 FilterSelect가 맨 위에 스스로 세운다(축 이름은 `axisLabel`, `allLabel`에 넣지 말 것).
 * '이번 달'(`month`)은 달 라벨이 URL `month=`에 따라 바뀌어 컴포넌트에서 앞에 붙인다.
 * ⚠️ `year`는 달력 연도가 아니라 **최근 365일**이다 — 옛 라벨 '올해'가 거짓이라 '최근 1년'으로 고쳤다(2026-09-11, 값 불변).
 * '직접 지정'(`custom`)을 고르면 옆에 날짜 두 칸이 선다(원장 2026-09-28 — 기간 커스터마이징).
 */
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all" | "month">; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "최근 1년" },
  { value: "custom", label: "직접 지정" },
];

/**
 * 유형(전체 / 퇴원 / 수강종료) — 원장 2026-09-28 *"퇴원관리에 수강종료도 포함 … 따로 라벨처리하거나 상단 필터에도"*.
 * 기본은 **둘 다**(한 목록, 줄마다 라벨). 필터·검색은 두 유형이 함께 쓰므로 유형을 바꿔도 지우지 않는다.
 * ⚠️ 운영실 '퇴원생' 카드는 `type=withdrawn`으로 들어온다 — 카드 숫자(퇴원만)와 목록이 같아야 한다(kpi-links.ts).
 */
const TYPE_OPTIONS: { value: Exclude<TypeKey, "all">; label: string }[] = [
  { value: "withdrawn", label: "퇴원" },
  { value: "subject-ended", label: "수강종료" },
];

const CONSULT_OPTIONS: { value: Exclude<ConsultKey, "all">; label: string }[] = [
  { value: "pending", label: "상담 미완료" },
  { value: "done", label: "상담 완료" },
];

/** 툴바 공통 — 축마다 라벨 하나(`기간: 최근 30일`), 폭은 글자만큼. */
const SELECT_PROPS = { className: "w-auto", triggerClassName: TOOLBAR_SELECT } as const;

type WdHrefParams = {
  type: TypeKey;
  range: RangeKey;
  from: string | null;
  to: string | null;
  month: string;
  reason: ReasonKey;
  /** 세부 사유(2단계) — 세부가 있는 대분류를 골랐을 때만(`detail=` · 고르지 않은 줄은 `none`). */
  detail: string | null;
  q: string;
  subject: string;
  program: Program | null;
  consult: ConsultKey;
  early: EarlyKey | null;
  /** 분석 카드의 칸(원장 2026-10-15) — 학년 · 학교 · 강사(선생님 id). 값이 없는 줄은 `none`. */
  grade: string | null;
  school: string | null;
  teacher: string | null;
};

function buildWdHref(p: WdHrefParams): string {
  const sp = new URLSearchParams();
  if (p.type !== "all") sp.set("type", p.type);
  if (p.range !== "all") sp.set("range", p.range);
  if (p.range === "month") sp.set("month", p.month);
  if (p.range === "custom" && p.from && p.to) {
    sp.set("from", p.from);
    sp.set("to", p.to);
  }
  if (p.reason !== "all") sp.set("reason", p.reason);
  if (p.reason !== "all" && p.detail) sp.set("detail", p.detail);
  if (p.subject !== "all") sp.set("subject", p.subject);
  if (p.program) sp.set("program", p.program);
  if (p.consult !== "all") sp.set("consult", p.consult);
  if (p.early) sp.set("early", p.early);
  if (p.grade) sp.set("grade", p.grade);
  if (p.school) sp.set("school", p.school);
  if (p.teacher) sp.set("teacher", p.teacher);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/withdrawals?${s}` : "/withdrawals";
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    range?: RangeKey;
    month?: string;
    from?: string;
    to?: string;
    reason?: ReasonKey;
    detail?: string;
    q?: string;
    subject?: string;
    program?: string;
    consult?: ConsultKey;
    early?: string;
    grade?: string;
    school?: string;
    teacher?: string;
    axis?: string;
    page?: string;
    size?: string;
    embed?: string;
  }>;
}) {
  const user = await requireAccess("withdrawals");
  const sp = await searchParams;
  const type = parseType(sp.type);
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = parseFacet(sp.reason) ?? "all";
  // 세부 사유 — 고른 대분류에 세부가 있고, 그 대분류의 세부(또는 '세부 미기재')일 때만 건다(다른 대분류의 세부가 붙어 와도 무시).
  // 주소 값은 아무 글이나 올 수 있다 — `constructor` 같은 기본 속성 이름이 표를 뚫지 않게 제 칸만 본다.
  const reasonDetails = Object.hasOwn(REASON_DETAILS, reason) ? REASON_DETAILS[reason as WithdrawalReason] : [];
  const detailRaw = reasonDetails.length ? parseFacet(sp.detail) : null;
  const detailF = detailRaw && (detailRaw === FACET_NONE || reasonDetailOf(detailRaw)?.reason === reason) ? detailRaw : null;
  // 분석 카드의 칸(학년·학교·강사) — 누르면 명단이 그 값으로 걸러진다(`breakdown.ts`).
  const gradeF = parseFacet(sp.grade);
  const schoolF = parseFacet(sp.school);
  const teacherF = parseFacet(sp.teacher);
  const subject = sp.subject ?? "all";
  const consult: ConsultKey = (sp.consult as ConsultKey) ?? "all";
  // 등록 후 조기 퇴원(원장 2026-10-15) — 1·2·3개월 이내(누적). 퇴원만 판정한다(`early-exit.ts`).
  // '수강종료만' 보기에선 걸지 않는다 — 같이 걸면 목록이 통째로 비고 화면 말이 '퇴원'으로 바뀐다(리뷰 2026-10-15).
  //   주소의 `early=`는 남겨 둬 유형을 되돌리면 다시 걸린다(툴바 칸도 그동안 숨긴다).
  const early = type === "subject-ended" ? null : parseEarly(sp.early);
  const q = sp.q ?? "";
  const size = withdrawalPageSize(sp.size);
  const today = kstToday();
  // '이번 달'(운영실 KPI '퇴원생' ↗) — 달은 URL `month=`(없거나 모양이 틀리면 KST 이번 달). 판정은 카드와 같은 창.
  const monthKey = isValidYm(sp.month) ? sp.month : kstMonth();
  // 1일 ~ min(말일, 오늘) — 운영실 카드·등록·퇴원 추이 패널과 같은 창(오늘 이후로 적힌 퇴원 예정은 아직 퇴원이 아니다).
  const monthWindow = withdrawalMonthWindow(monthKey, today);
  const rangeWindow = resolveRange(range, { today, month: monthWindow, from: sp.from, to: sp.to });
  // 프로그램(EiE·인재원 영어·수학) — 퇴원은 마지막 수강 반, 수강종료는 그 과목 마지막 반 기준(withdrawalProgram).
  const program = parseProgram(sp.program);

  // 🔑 세 조회는 서로 독립이다(B4). 수강종료는 재원 전수 + 수강 조회라 가장 무겁다 — '퇴원만'(운영실 카드가 여는 보기)
  //    에선 아예 안 부른다(그 보기엔 수강종료 줄이 한 줄도 안 선다). `loading.tsx`는 두지 않는다 — 필터를 자주 바꾸는
  //    화면이라 바꿀 때마다 스켈레톤이 번쩍인다(CLAUDE.md B7 트레이드오프).
  const withSubjectEnded = type !== "withdrawn";
  // 강사별 = 그만둘 때 다니던 반의 그날 담임(퇴원생 관리 차트 기준 · 시간표 X와 같은 판정 `homeroomOf` — 원장 2026-11-11). 명단의 '담당강사' 열·담당강사 필터·강사 카드가 이 판정
  // 하나를 같이 쓴다(원장 2026-10-15 *"모든 곳에서 담당이 일치하게 보이도록 같은 배선"*) — 무거워서 화면은 기다리지 않고 흘려받는다(아래).
  // 판정할 줄의 폭 = 기간 필터 창과 월별 추이(최근 12개월)를 덮는다 · '전체 기간'은 26개월 전 1일부터(시간표 X의 가장 오래된
  // 석 달 묶음 — 기준 달 24개월 전의 맨 왼쪽 열 — 과 같은 폭). '직접 지정'도 그보다 넓히지 않는다(재료가 무거워지고 '전체 기간'보다 숫자가 커진다).
  // 🔴 끝은 이번 달 말일로 고정(X와 같다) — 끝이 움직이면 같은 줄의 선생님이 화면마다 갈린다.
  const thisMonth = kstMonth();
  const judgeFloor = shiftMonth(thisMonth, -26);
  const judgeFromMonth =
    rangeWindow.kind === "all" ? judgeFloor : [judgeFloor, [rangeWindow.from.slice(0, 7), shiftMonth(thisMonth, -11)].sort()[0]!].sort()[1]!;
  // 분석 축 = 주소(`axis=` — 카드가 고를 때 싣는다) → 계정 저장값. 저장이 안 되는 화면(운영 콘솔의 읽기 전용 지점 보기)에서도 주소로 산다.
  const axisParam = sp.axis ? parseBreakdownAxis(sp.axis) : null;
  const prefsP = loadWithdrawalTrendPrefs();
  // null = 읽다 실패(카드가 그렇다고 말한다 · 강사 칸 필터는 걸지 않는다 · 명단 담당 칸은 '—').
  const judgeP: Promise<ExitTeacherJudge | null> = loadExitTeacherJudge(
    user.tenantId,
    { from: monthRange(shiftMonth(judgeFromMonth, -5)).from, end: monthRange(thisMonth).to },
    { today, thisMonth },
  ).catch((e: unknown) => {
    reportWarning("퇴원관리 강사별 판정 실패", { scope: "withdrawals.teacherJudge", message: e instanceof Error ? e.message : String(e) });
    return null;
  });
  // 🔑 화면이 판정을 **기다리는 것은 강사 칸 필터가 걸렸을 때뿐**이다(명단이 판정으로 걸러진다). 강사 축만 볼 때는 강사 카드만
  //    나중에 흘려보내고(Suspense) 나머지를 먼저 그린다 — 강사 축을 저장해 둔 계정의 모든 이동이 판정을 기다리지 않게.
  // 강사별 퇴원율 추이(원장 2026-11-11) = 권한 '강사별 퇴원율'(퇴원관리 줄 아래 · 기본 원장만) — 문만 여기서 보고(가볍다) 표는 아래 Suspense가 흘려받는다.
  //   문을 먼저 봐야 볼 수 없는 사람에게 대기 카드가 번쩍이지 않는다. 문 판정이 실패하면 카드만 없다(화면은 산다).
  // 2026-10까지는 퇴원생 관리 차트의 줄을 그대로 통계로 쓴다(원장 2026-11-11 — `sheet-exit-rows.ts`). 시트를 못 읽으면 null(에이와 줄 그대로).
  // 🔴 '퇴원만' 보기도 수강종료를 읽는다 — 시트는 퇴원·수강종료를 가르지 않아, 에이와 수강종료 줄과 이어야 그 줄을 퇴원으로 잘못 세지 않는다.
  const sheetExitsP = loadSheetExits(user.tenantId);
  // 시트에만 있는 줄이 과목만 끊은 것인지 가리는 학생 이름 — 실패하면 시트를 입히지 않는다(과목만 끊은 줄을 퇴원으로 부풀리지 않게).
  const studentNamesP = sheetExitsP.then((s) =>
    s
      ? loadStudentNames(user.tenantId).catch((e: unknown) => {
          reportWarning("퇴원관리 시트 맞춤 실패", { scope: "withdrawals.sheetNames", message: e instanceof Error ? e.message : String(e) });
          return null;
        })
      : null,
  );
  const [withdrawnRaw, subjectEndedRaw, settings, trendPrefs, blockingJudge, churnGate, sheetExits, studentNames] = await Promise.all([
    getWithdrawnStudents(),
    // 시트를 쓰지 않는 지점의 '퇴원만' 보기는 종전처럼 수강종료를 읽지 않는다(가장 무거운 조회).
    withSubjectEnded ? getSubjectEndedStudents({ withNotes: true }) : sheetExitsP.then((s) => (s ? getSubjectEndedStudents({ withNotes: true }) : [])),
    getTenantSettings(),
    prefsP,
    teacherF ? judgeP : Promise.resolve(undefined),
    getTeacherChurnGate().catch(() => null),
    sheetExitsP,
    studentNamesP,
  ]);
  const axis = axisParam ?? trendPrefs.axis;
  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const merged = sortExitRows(mergeSheetExits(toExitRows(withdrawnRaw, subjectEndedRaw), studentNames ? sheetExits : null, today, studentNames ?? undefined));
  // '퇴원만'이면 수강종료 줄은 명단에서 뺀다(읽은 까닭은 시트 줄과 잇기 위해서뿐).
  const all = withSubjectEnded ? merged : merged.filter((r) => r.kind === "withdrawn");
  // 머리글은 '명'이다 — 시트 줄은 과목마다라 같은 학생이 두 줄일 수 있어 사람으로 센다(학생 id · 시트에만 있으면 이름+달).
  const personOf = (r: ExitRow) => r.studentId || `${r.name}|${(r.countDate ?? "").slice(0, 7)}`;
  const withdrawnTotal = new Set(merged.filter((r) => r.kind === "withdrawn").map(personOf)).size;
  const subjectEndedTotal = merged.filter((r) => r.kind !== "withdrawn").length;
  /**
   * 필터를 **축별 술어**로 쪼갠다 — 카드마다 "자기 축만 빼고" 나머지를 적용하기 위해서다(패싯).
   *
   * 🔴 왜 축을 빼나: 필터를 통째로 걸면 그 카드가 스스로를 부정한다 —
   *    · 월별 추이에 **기간**을 걸면 "최근 30일"에서 막대가 1~2개만 남아 12개월 추이가 사라진다.
   *    · ~~과목별 분포에 **과목**을 걸면 막대가 자기 자신 하나만 남는다~~ → 2026-10-15 원장 *"필터링 영향 받게 움직여야지"* —
   *      과목을 고르면 과목 칸도 그 과목이 든 줄만, 함께 끊은 과목 묶음('수학' · '수학+영어')으로 센다(`subjectComboItems`).
   *    · 상담률에 **상담**을 걸면 0% 아니면 100%밖에 안 나온다.
   * ⚠️ 반대로 아무것도 안 걸면(예전 동작) 사유 카드만 필터를 따라 움직여 **한 화면이 서로 다른 모집단을
   *    말한다** — 원장 지적(2026-08-10)의 실체가 그것이었다.
   * ⚠️ 사유는 퇴원·수강종료 둘 다(수강종료 = 그 과목 수강의 종료 사유). 사후상담은 퇴원에만 있어 상담 필터를 걸면
   *    수강종료 줄은 빠진다(모르는 것을 '미완료'로 세지 않는다).
   */
  const term = q.toLowerCase();
  const byName = (r: ExitRow) => !q || r.name.toLowerCase().includes(term);
  const byType = (r: ExitRow) => type === "all" || r.kind === type;
  const byRange = (r: ExitRow) => inRange(r, rangeWindow);
  // 사유 = 사유 카드 막대와 같은 묶음(장부 정리 · 표준 사유 · 자유 글 · 미기재 — `reasonFacetOf`).
  // 세부 사유는 사유 축 안의 한 칸이다(사유 카드가 자기 축으로 함께 뺀다).
  const byReason = (r: ExitRow) =>
    (reason === "all" || reasonFacetOf(r).value === reason) && (!detailF || reasonDetailFacetOf(r) === detailF);
  const bySubject = (r: ExitRow) => subject === "all" || r.subjects.includes(subject);
  const byConsult = (r: ExitRow) =>
    consult === "all" || (r.consulted !== null && (consult === "done" ? r.consulted : !r.consulted));
  const byProgram = (r: ExitRow) =>
    !program ||
    withdrawalProgram(
      { lastClassSubject: r.programSubject, lastClassEnglishTrack: r.englishTrack },
      settings.operations.subjects,
    ) === program;
  // 등록 후 조기 퇴원 — 퇴원만 판정한다(수강종료는 상담 필터처럼 빠진다 · 등록일을 모르는 퇴원도 빠진다).
  const byEarly = (r: ExitRow) => !early || (r.kind === "withdrawn" && isEarlyWithin(r.tenureDays, early));
  const byGrade = (r: ExitRow) => !gradeF || gradeOf(r) === gradeF;
  const bySchool = (r: ExitRow) => !schoolF || schoolOf(r) === schoolF;
  // 강사 — 그 과목을 그만둘 때 다니던 반의 그날 담임(`homeroomOf`). 판정은 줄 × 과목으로 해 두고(`attributeTeachers`), 읽을 때 **걸린 과목·프로그램에 드는
  // 과목만** 고른다(수학만 보는데 함께 끊은 영어 선생님이 서지 않게 — `judgeSubjects`). 판정 폭 밖의 옛 줄은 결과에 없다(강사 칸을 고르면 빠진다).
  // 🔴 과목 카드도 과목마다 같은 함수로 묻는다(`teacherMatches(r, 과목)`) — 칸 숫자 = 그 과목을 눌러 거른 명단 수.
  const programGroup = program ? (program === "math" ? "math" : "english") : null;
  const currentSubject = subject === "all" ? null : subject;
  const attribute = (judge: ExitTeacherJudge) => attributeTeachers(all, judge, { from: `${judgeFromMonth}-01`, today });
  const subjectsInScope = (r: ExitRow, subjectKey: string | null) =>
    judgeSubjects(r, { subject: subjectKey, programGroup }, (s) => subjectGroupOf(s, settings.operations.subjects));
  /** 판정한 줄의 강사 칸 값(걸린 과목 범위 — `teacherFacetsIn`: 센 선생님 + 아무도 안 센 과목이 있으면 '담당 미반영') — 판정 폭 밖·범위 밖이면 null. */
  const teacherFacetsOf = (map: ReadonlyMap<string, RowTeachers>, r: ExitRow, subjectKey: string | null) => {
    const per = map.get(r.key);
    return per ? teacherFacetsIn(per, subjectsInScope(r, subjectKey)) : null;
  };
  // 판정을 기다린 경우(강사 칸 필터)만 여기서 판정한다 — 무거운 퇴원율 계산이 throw해도 화면은 산다(필터를 걸지 않고 그렇다고 적는다).
  let teacherMap: Map<string, RowTeachers> | null = null;
  let teacherFailed = blockingJudge === null;
  if (blockingJudge) {
    try {
      teacherMap = attribute(blockingJudge);
    } catch (e) {
      reportWarning("퇴원관리 강사별 판정 실패", { scope: "withdrawals.teacherAttribution", message: e instanceof Error ? e.message : String(e) });
      teacherFailed = true;
    }
  }
  const teacherMatches = (r: ExitRow, subjectKey: string | null) => {
    if (!teacherF || !teacherMap) return true;
    return teacherFacetsOf(teacherMap, r, subjectKey)?.includes(teacherF) ?? false;
  };
  const byTeacher = (r: ExitRow) => teacherMatches(r, currentSubject);
  // 유형·프로그램·이름은 어느 카드의 '자기 축'도 아니라 모든 모집단에 건다.
  const base = (r: ExitRow) => byName(r) && byProgram(r) && byType(r);
  const facets = {
    range: byRange,
    reason: byReason,
    subject: bySubject,
    consult: byConsult,
    early: byEarly,
    grade: byGrade,
    school: bySchool,
    teacher: byTeacher,
  } as const;
  type Facet = keyof typeof facets;
  const facetKeys = Object.keys(facets) as Facet[];
  /** 기본 + 축 전부 — `skip`에 적은 축은 뺀다(그 카드의 '자기 축'). */
  const passes = (r: ExitRow, ...skip: Facet[]) => base(r) && facetKeys.every((k) => skip.includes(k) || facets[k](r));

  // 목록 = **전 축** 적용(사용자가 고른 그대로).
  const rows = all.filter((r) => passes(r));
  // 카드별 모집단 — 자기 축 하나만 뺀다.
  const trendRows = all.filter((r) => passes(r, "range")); // 기간 제외
  // 과목 제외 — 강사 칸이 걸렸으면 과목마다 그 과목에서 그 선생님이 센 것만 남긴다(과목을 누르면 그 과목으로 다시 판정하므로).
  const subjectRows = all
    .filter((r) => passes(r, "subject", "teacher"))
    .flatMap((r) => {
      if (!teacherF || !teacherMap) return [r];
      if (!r.subjects.length) return teacherMatches(r, null) ? [r] : [];
      const kept = r.subjects.filter((s) => teacherMatches(r, s));
      return kept.length ? [{ ...r, subjects: kept }] : [];
    });
  const gradeRows = all.filter((r) => passes(r, "grade")); // 학년 제외
  const schoolRows = all.filter((r) => passes(r, "school")); // 학교 제외
  const teacherRows = all.filter((r) => passes(r, "teacher")); // 강사 제외
  // 상담 카드는 퇴원만 — 수강종료에는 사후상담이 없다. 사유 카드는 둘 다(유형 필터를 따른다).
  // 상담 제외 · 시트에만 있는 줄(학생 연결 없음 — 상담을 적을 수 없다)은 상담률에 넣지 않는다(`byConsult`와 같은 모집단).
  const consultRows = all.filter((r) => r.kind === "withdrawn" && r.consulted !== null && passes(r, "consult"));
  const reasonRows = all.filter((r) => passes(r, "reason")); // 사유 제외
  // 등록 후 띠는 퇴원만 — 등록 후 축 제외(고른 칸에 갇혀 나머지 칸이 0이 되지 않게).
  const earlyRows = all.filter((r) => r.kind === "withdrawn" && passes(r, "early"));
  const earlyJudged = earlyRows.filter((r) => r.tenureDays !== null);
  const earlyCount = earlyCounts(earlyJudged.map((r) => ({ days: r.tenureDays })));

  // 상담 미완료 worklist 집계 — **상담 축만 뺀** 모집단(상담 필터를 걸면 0%/100%밖에 안 나온다).
  const consultPending = consultRows.filter((r) => !r.consulted).length;
  const consultRate = consultRows.length
    ? Math.round(((consultRows.length - consultPending) / consultRows.length) * 100)
    : 0;

  // 사유 통계 — **사유 축만 뺀** 모집단(사유를 고르면 막대가 자기 자신 하나만 남는다).
  // 🔴 장부 정리(일괄 퇴원 — 실제 사유가 아니다)는 막대에 세우지 않고 따로 적는다(원장 2026-10-15 *"퇴원사유 대부분이 기타이니
  //    분석이 … 전혀 분석안되는"* — 올해 '기타' 193건 중 153건이 장부 정리 메모였다). 비중의 분모도 장부 정리를 뺀 수.
  const reasonGroups = new Map<string, { label: string; count: number }>();
  let cleanupCount = 0;
  for (const r of reasonRows) {
    const f = reasonFacetOf(r);
    if (f.value === REASON_CLEANUP) {
      cleanupCount++;
      continue;
    }
    const g = reasonGroups.get(f.value) ?? { label: f.label, count: 0 };
    g.count++;
    reasonGroups.set(f.value, g);
  }
  const topReasons = [...reasonGroups].sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label, "ko"));
  const reasonBase = reasonRows.length - cleanupCount;

  // 이번 달 — **기간 축만 뺀** 모집단(자기 기간을 이미 이번 달로 못박은 수치라 기간 필터를 또 걸 수 없다).
  // 🔴 운영실 '퇴원생'과 같은 창(`withdrawalMonthWindow`, 1일 ~ 오늘) — 원장 2026-09-28 *"최근 30일 -> 이번달"*.
  //    툴바에서 다른 달을 골라도 이 카드는 **이번 달**이다(카드 이름이 곧 기간).
  const recentWindow = resolveRange("month", { today, month: withdrawalMonthWindow(kstMonth(), today) });
  const recent = trendRows.filter((r) => inRange(r, recentWindow)).length;
  // 고른 달(1일~오늘)에 **퇴원·종료**했지만 수업료를 앞 달까지만 내 앞 달로 센 줄 — 센 달마다 묶어 그 달 명단으로 보낸다(원장 2026-11-03
  // *"오해 소지가 없도록"* — 11월 1일 퇴원 4건이 10월로 세져 '이번 달'이 비어 오류처럼 보였다). 판정은 운영실 팝업과 같은 `countedEarlier`.
  // 모집단 = 기간 축만 뺀 줄(이 화면 숫자와 같은 단위 — 퇴원은 학생마다, 수강종료는 과목마다). 시스템 정리(날짜 미상)는 기간 판정처럼 뺀다.
  const carriedGroups =
    range === "month" ? countedEarlierByMonth(trendRows.filter((r) => !r.systemBulk), monthWindow.from, monthWindow.to) : [];
  const carriedTotal = carriedGroups.reduce((n, [, c]) => n + c, 0);

  // 월별 추이 = 기간 축 제외 · 과목별 분포 = 과목 필터가 없을 때만 과목 축 제외(고르면 명단과 같은 줄을 묶음으로 — 위 술어 주석).
  // ⚠️ **시스템 정리(날짜 미상)는 월별 추이에서 뺀다** — 퇴원일이 실제 시점이 아니라 일괄 처리된 장부 날짜라
  //    그대로 세면 그 달이 부풀어 "7월 퇴원 N명"이 사실과 달라진다(교정 전 152명이 그렇게 나왔다).
  //    목록에서는 숨기지 않는다(실제로 퇴원한 게 맞고 날짜만 모른다) — [system-bulk.ts](@/features/withdrawals/system-bulk) 참조.
  // 🔴 사유 없는 단체 장부 정리(`cleanup` — 수업 기록이 있는 쪽)도 월별 추이에서 뺀다 — 퇴원일이 마지막 수업 종료일(07-03 일괄 종료
  //    같은 장부 날짜)이라 그 달이 부푼다(원장 2026-10-20 *"단체로 장부 정리한 건에 대해서는 추세선에서 배제시킬것"*). 명단·이번 달은 그대로.
  const systemBulkCount = trendRows.filter((r) => r.systemBulk).length;
  const cleanupTrendCount = trendRows.filter((r) => r.cleanup && !r.systemBulk).length;
  const trend = monthlyExits(trendRows.filter((r) => !r.systemBulk && !r.cleanup));
  const reasonOptions: { value: string; label: string }[] = [
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({ value: k, label })),
    { value: REASON_UNSPECIFIED, label: "미기재" },
    { value: REASON_CLEANUP, label: "장부 정리" },
    // 사유 카드에서 고른 자유 글(‘반 폐지’ 등)은 드롭다운에 없는 값이라 지금 고른 것만 더한다(이름이 보이게).
    ...(reason.startsWith(REASON_TEXT_PREFIX) ? [{ value: reason, label: reasonFacetLabel(reason) ?? reason }] : []),
  ];

  const custom = "custom" in rangeWindow ? rangeWindow.custom : undefined;
  const current: WdHrefParams = {
    type,
    range,
    from: custom?.from ?? null,
    to: custom?.to ?? null,
    month: monthKey,
    reason,
    detail: detailF,
    q,
    subject,
    program,
    consult,
    // 주소에는 원래 값을 싣는다 — '수강종료만' 보기에서 숨긴 `early=`가 쪽 넘김에 빠지지 않게(유형을 되돌리면 다시 걸린다).
    early: parseEarly(sp.early),
    grade: gradeF,
    school: schoolF,
    teacher: teacherF,
  };
  const filterActive =
    type !== "all" ||
    range !== "all" ||
    reason !== "all" ||
    subject !== "all" ||
    consult !== "all" ||
    !!program ||
    !!early ||
    !!gradeF ||
    !!schoolF ||
    !!teacherF ||
    !!q;
  const rangeOptions = [
    { value: "month" as const, label: monthKey === kstMonth() ? "이번 달" : monthLabel(monthKey) },
    ...RANGE_OPTIONS,
  ];
  // 화면 말 — 유형에 따라 '퇴원' / '수강종료' / '퇴원·수강종료'. 등록 후 필터가 걸리면 퇴원만 남는다.
  const withdrawnOnly = type === "withdrawn" || !!early;
  const noun = withdrawnOnly ? "퇴원" : type === "subject-ended" ? "수강종료" : "퇴원·수강종료";
  // 칸 주소(띠 · 분석 카드 · 사유 막대 · 툴바 칩) — 고른 칸을 다시 누르면 푼다.
  // 목록 크기(`size=`)를 싣는다 — 빠지면 기본 크기로 한 번 그린 뒤 목록 틀이 크기를 다시 붙여 무거운 조회가 두 번 돈다(리뷰 2026-10-15).
  // 창 안의 `embed=1`은 링크(`EmbedLink`)가 붙인다.
  const hrefWith = (patch: Partial<WdHrefParams>) => {
    const href = buildWdHref({ ...current, ...patch });
    return `${href}${href.includes("?") ? "&" : "?"}size=${size}`;
  };
  const earlyHrefs = Object.fromEntries(EARLY_SPANS.map((s) => [s.key, hrefWith({ early: early === s.key ? null : s.key })])) as Record<
    EarlyKey,
    string
  >;
  // 고른 대분류의 세부 막대 — 같은 모집단(사유 축 제외)에서 그 대분류 줄만 · 세부를 고르면 그 칸이 켜진다(다시 누르면 해제).
  const detailView = reasonDetails.length
    ? (() => {
        const inReason = reasonRows.filter((r) => reasonFacetOf(r).value === reason);
        return {
          reasonLabel: reasonFacetLabel(reason) ?? "",
          total: inReason.length,
          rows: detailItems(inReason, reason as WithdrawalReason).map((i) => ({
            ...i,
            active: detailF === i.value,
            href: hrefWith({ detail: detailF === i.value ? null : i.value }),
          })),
        };
      })()
    : null;

  // 선생님 이름 — 강사 칸에 선 사람 + 고른 사람(명단에 없어도 칩에 이름이 서게). 못 읽으면 이름만 비운다(카드는 산다).
  const namesFor = (map: ReadonlyMap<string, RowTeachers>) => {
    const ids = [
      ...new Set([...teacherRows.flatMap((r) => teacherFacetsOf(map, r, currentSubject) ?? []), ...(teacherF ? [teacherF] : [])]),
    ].filter((id) => id !== FACET_NONE);
    return ids.length
      ? createClient()
          .then((supabase) => teacherNames(supabase, ids))
          .catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>());
  };
  const names = teacherMap ? await namesFor(teacherMap) : new Map<string, string>();
  const teacherLabel = (id: string) => teacherFacetLabel(id, (x) => names.get(x) ?? null);
  /**
   * 담당 판정 한 벌 — 강사 카드 · 담당강사 필터 선택지 · 명단 '담당강사' 칸이 **같은 map·같은 이름**을 쓴다(원장 2026-10-15 *"모든 곳에서
   * 담당이 일치하게 보이도록 같은 배선"*). 강사로 걸렀으면 이미 기다린 판정을, 아니면 흘려받을 약속을 같이 쓴다(두 번 계산하지 않게).
   * null = 판정 실패(카드는 '못 불러옴', 칸은 '—', 필터는 고른 값만).
   */
  const teacherInfoP: Promise<{ map: ReadonlyMap<string, RowTeachers>; names: ReadonlyMap<string, string> } | null> = teacherF
    ? Promise.resolve(teacherMap ? { map: teacherMap, names } : null)
    : judgeP.then(async (judge) => {
        if (!judge) return null;
        try {
          const map = attribute(judge);
          return { map, names: await namesFor(map) };
        } catch (e) {
          reportWarning("퇴원관리 강사별 판정 실패", { scope: "withdrawals.teacherAttribution", message: e instanceof Error ? e.message : String(e) });
          return null;
        }
      });
  // 담당강사 필터 선택지 = 강사 카드 칸과 같은 값(강사 축만 뺀 모집단 — 다른 강사로 바로 갈아탈 수 있게).
  const teacherOptionsP = teacherInfoP.then((info) =>
    info
      ? teacherFilterOptions(
          teacherRows.map((r) => teacherFacetsOf(info.map, r, currentSubject)),
          teacherF,
          (id) => info.names.get(id) ?? null,
        )
      : null,
  );

  // 🔑 수치마다 **언제부터·누구를** 센 것인지 적는다(원장 2026-09-29 *"전체 퇴원 458명이 언제부터의 수치인지? 올 한 해 단위로 …
  //    항상 수치에 관한 구체적인 언급이 필요"*). 위 카드 둘(올해 퇴원·올해 수강종료)은 **학원 전체**(필터 무관),
  //    이번 달·상담 미완료·차트는 걸린 필터를 `scopeText`로 밝힌다.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const inYear = (r: ExitRow) => !!r.countDate && r.countDate >= yearStart && r.countDate <= today;
  const yearWithdrawn = all.filter((r) => r.kind === "withdrawn" && !r.systemBulk && inYear(r)).length;
  const yearBulk = all.filter((r) => r.kind === "withdrawn" && r.systemBulk && inYear(r)).length;
  const yearEnded = all.filter((r) => r.kind === "subject-ended" && inYear(r)).length;
  const firstWithdrawn = all.reduce<string | null>((m, r) => (r.kind === "withdrawn" && r.date && (!m || r.date < m) ? r.date : m), null);
  const scopeParts = {
    program: program ? programLabel(program, settings.operations.subjects, isModuleEnabled(settings.modules.disabled, "eie")) : null,
    subject: subject !== "all" ? subjectMaps.labelOf(subject) : null,
    reason: reason === "all" ? null : [reasonFacetLabel(reason), detailF ? detailFacetLabel(detailF) : null].filter(Boolean).join(" · ") || null,
    consult: consult === "all" ? null : (CONSULT_OPTIONS.find((o) => o.value === consult)?.label ?? null),
    early: early ? earlySpan(early).label : null,
    grade: gradeF ? (gradeF === FACET_NONE ? "학년 미기재" : gradeF) : null,
    school: schoolF ? (schoolF === FACET_NONE ? "학교 미기재" : schoolF) : null,
    teacher: teacherF && teacherMap ? teacherLabel(teacherF) : null,
    q: q || null,
  };
  const scope = scopeText(scopeParts);
  // 상담 카드는 상담 축을, 등록 후 띠는 등록 후 축을 일부러 뺀 모집단이다 — 그 필터 라벨을 적으면 적용 안 한 필터를 적은 셈이 된다.
  const consultScope = scopeText({ ...scopeParts, consult: null });
  const rangeText = rangeWindow.kind === "all" ? "전체 기간" : spanText(rangeWindow.from, rangeWindow.to);

  // 분석 카드(원장 2026-10-15) — 축마다 자기 축만 뺀 모집단(과목 칸은 과목을 고르면 그 필터도 따른다) · 칸을 누르면 명단이 그 값으로 걸러진다(고른 칸은 해제).
  // 설명 = 건수 · 기간 · 걸린 범위(자기 축은 빼고 — 적용 안 한 필터를 적으면 거짓말) · 자기 축 필터를 뺐다는 말.
  const caption = (n: number, skip: "subject" | "grade" | "school" | "teacher", on: boolean, label: string) =>
    `${n}건 · ${rangeText} · ${scopeText({ ...scopeParts, [skip]: null })}${on ? ` · ${label} 필터는 이 축이라 제외` : ""}`;
  const toRows = (
    items: readonly { value: string; label: string; count: number }[],
    picked: string | null,
    href: (value: string | null) => string,
  ): BreakdownRow[] =>
    items.map((i) => ({ ...i, active: picked === i.value, href: href(picked === i.value ? null : i.value) }));
  const breakdownViews = {
    // 과목을 고르면 과목 칸도 그 필터를 따른다(원장 2026-10-15 *"필터링 영향 받게 움직여야지"*) — 명단과 같은 줄을 함께 끊은 과목
    // 묶음('수학' · '수학+영어')으로 한 번씩 센다. 묶음 칸으로 거르는 주소는 없다(필터를 푸는 길은 툴바 · '필터 초기화').
    subject:
      subject === "all"
        ? {
            caption: caption(subjectRows.length, "subject", false, "과목"),
            total: subjectRows.length,
            share: true,
            note: "두 과목을 함께 끊은 퇴원은 과목마다 셉니다.",
            rows: toRows(subjectItems(subjectRows, subjectMaps.labelOf), null, (v) => hrefWith({ subject: v ?? "all" })).map(
              // 과목 미상은 거를 주소가 없다(과목 필터는 과목 키만 받는다).
              (r) => (r.value === FACET_NONE ? { ...r, href: null } : r),
            ),
          }
        : {
            caption: `${rows.length}건 · ${rangeText} · ${scope}`,
            total: rows.length,
            share: true,
            note: "함께 끊은 과목은 한 칸으로 묶어 셉니다.",
            rows: subjectComboItems(rows, subject, settings.operations.subjects.map((s) => s.key), subjectMaps.labelOf).map(
              (i) => ({ ...i, active: false, href: null }),
            ),
          },
    grade: {
      caption: caption(gradeRows.length, "grade", !!gradeF, "학년"),
      total: gradeRows.length,
      share: true,
      note: "학년은 학생 기록에 적힌 값입니다.",
      rows: toRows(gradeItems(gradeRows, settings.operations.gradeLevels), gradeF, (v) => hrefWith({ grade: v })),
    },
    school: {
      caption: caption(schoolRows.length, "school", !!schoolF, "학교"),
      total: schoolRows.length,
      share: true,
      note: "학교는 학생 기록에 적힌 값입니다.",
      rows: toRows(schoolItems(schoolRows), schoolF, (v) => hrefWith({ school: v })),
    },
  } satisfies Record<string, BreakdownView>;
  /** 강사 칸 — 판정 폭 밖의 옛 줄은 세지 않고 따로 적는다. 담당 미반영 = 그만둘 때 다니던 정규 반을 찾지 못한 줄(장부 정리 포함). */
  function teacherView(map: ReadonlyMap<string, RowTeachers>, names: ReadonlyMap<string, string>): BreakdownView {
    const judged = teacherRows.filter((r) => map.has(r.key));
    const outside = teacherRows.length - judged.length;
    const facetsOf = (r: ExitRow) => teacherFacetsOf(map, r, currentSubject);
    // 걸린 과목이 프로그램 밖인 줄(예: 수학 프로그램에서 영어 과목을 고름) — 어느 칸에도 세지 않는다.
    const offScope = judged.filter((r) => facetsOf(r) === null).length;
    return {
      caption: caption(judged.length - offScope, "teacher", !!teacherF, "강사"),
      total: judged.length - offScope,
      share: false,
      rows: toRows(
        teacherItems(judged, facetsOf, (id) => names.get(id) ?? null),
        teacherF,
        (v) => hrefWith({ teacher: v }),
      ),
      // 강사·'담당 미반영' 정의 문장은 원장 지시로 뺐다(2026-11-11 *"이 멘트 제거"*) — 걸린 범위·옛 줄 안내만 남긴다.
      note: [
        programGroup || subject !== "all" ? "걸린 과목·프로그램의 담당만 셉니다." : "",
        outside ? `${judgeFromMonth.replace("-", "년 ")}월 전 ${outside}건은 강사를 가리지 않았습니다.` : "",
        offScope ? `걸린 프로그램 밖 과목만 끊은 ${offScope}건은 세지 않았습니다.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  // 강사 카드 — 판정을 기다렸으면 지금 그리고, 아니면(강사 축만 볼 때) 따로 흘려보낸다. 판정·이름·집계 어디서 실패해도 카드만 '못 불러옴'.
  const teacherNow: { view: BreakdownView | null; error: boolean } = teacherMap && blockingJudge
    ? { view: teacherView(teacherMap, names), error: false }
    : { view: null, error: teacherFailed };
  // 강사 칸 필터가 없으면 강사 카드는 늘 흘려받는다 — 판정은 명단 담당 칸 때문에 매 방문 계산하므로, 강사 축을 누를 때 다시 부르지 않게.
  const teacherLater =
    !teacherF
      ? Promise.all([judgeP, teacherInfoP]).then(([judge, info]) => {
          if (!judge || !info) return { view: null, error: true };
          try {
            return { view: teacherView(info.map, info.names), error: false };
          } catch (e) {
            reportWarning("퇴원관리 강사별 판정 실패", { scope: "withdrawals.teacherAttribution", message: e instanceof Error ? e.message : String(e) });
            return { view: null, error: true };
          }
        })
      : null;
  const earlyScope = `${rangeText} · ${scopeText({ ...scopeParts, early: null })}`;
  // 월별 추이의 **학원 전체** 막대(원장 *"과목별과는 별도로 전체 추이수치가 필요"*) — 유형만 따르고 다른 필터는 안 건다.
  // 등록 후 필터가 걸리면 비교 막대도 퇴원만(수강종료 건을 섞으면 '명'과 '건'이 한 차트에 선다).
  const typeRows = all.filter((r) => (withdrawnOnly ? r.kind === "withdrawn" : byType(r)) && !r.systemBulk && !r.cleanup);
  const narrowed = trendRows.filter((r) => !r.systemBulk && !r.cleanup).length !== typeRows.length;
  const typeTrend = narrowed ? monthlyExits(typeRows) : null;
  const trendData: WithdrawalMonthPoint[] = typeTrend ? trend.map((p, i) => ({ ...p, total: typeTrend[i]?.count ?? 0 })) : trend;
  const sum = (xs: readonly { count: number }[]) => xs.reduce((a, x) => a + x.count, 0);

  // 통계는 전체 필터 결과를 유지하고, 명단만 오른쪽 카드 높이에 맞는 크기로 자른다.
  const total = rows.length;
  const { page, totalPages, start, end } = withdrawalPage(sp.page, total, size);
  const pageRows = rows.slice(start, end);
  // 명단 '담당강사' 칸 — 강사 카드가 세는 값 그대로(`teacherCellText`). 판정은 흘려받는다(명단은 먼저 선다).
  const teacherCellsP = teacherInfoP.then((info) =>
    info
      ? new Map(pageRows.map((r) => [r.key, teacherCellText(teacherFacetsOf(info.map, r, currentSubject), (id) => info.names.get(id) ?? null)]))
      : null,
  );
  // 🔴 흘려받는 경계에 검색어 key — 같은 경계를 다시 쓰면 이동 내내 옛 화면을 붙들어 모든 필터·쪽 이동이 판정을 기다린다(아래 분석 카드와 같은 까닭).
  const streamKey = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (k !== "axis" && typeof v === "string" ? [[k, v]] : []))).toString();
  const pageHref = (p: number) => {
    const base = buildWdHref(current);
    const params = new URLSearchParams(base.split("?")[1]);
    params.set("size", String(size));
    if (p > 1) params.set("page", String(p));
    if (sp.embed === "1") params.set("embed", "1");
    return `/withdrawals?${params}`;
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* description = 창 컴팩트 라벨 겸용 — 필터와 무관한 전체 수(값, §4·§12). */}
      <PageHeader
        eyebrow="학생 케어"
        title="퇴원관리"
        description={`누적 퇴원 ${withdrawnTotal}명${firstWithdrawn ? `(${firstWithdrawn.slice(0, 7).replace("-", ".")}~)` : ""}${withSubjectEnded ? ` · 수강종료 ${subjectEndedTotal}건` : ""}`}
      />

      {/* Stat strip — Editorial 문법 ②(공용 BigStat) */}
      <StatStrip>
        <BigStat
          label="올해 퇴원"
          value={yearWithdrawn}
          unit="명"
          sub={`${spanText(yearStart, today)} · ${EXIT_BASIS_TAG} · 학원 전체${yearBulk ? ` · 날짜 미상 ${yearBulk}명 제외` : ""}`}
          tone="rose"
          icon={<UserMinus size={16} strokeWidth={1.8} />}
        />
        {withSubjectEnded ? (
        <BigStat
          label="올해 수강종료"
          value={yearEnded}
          unit="건"
          sub={`${spanText(yearStart, today)} · ${EXIT_BASIS_TAG} · 학원 전체 · 재원 중 한 과목을 끊음`}
          tone="amber"
          icon={<BookOpen size={16} strokeWidth={1.8} />}
        />
        ) : null}
        <BigStat
          label="이번 달"
          value={recent}
          unit="건"
          sub={`${noun} · ${EXIT_BASIS_TAG} · ${scope}`}
          tone="danger"
          icon={<CalendarClock size={16} strokeWidth={1.8} />}
        />
        <BigStat
          label="상담 미완료"
          value={consultPending}
          unit="명"
          sub={`퇴원 사후상담 완료율 ${consultRate}% · ${rangeText} · ${consultScope}`}
          tone="amber"
          icon={<ListChecks size={16} strokeWidth={1.8} />}
        />
        <BigStat label="필터 결과" value={rows.length} unit="건" tone="blue" icon={<Filter size={16} strokeWidth={1.8} />} />
      </StatStrip>

      {/* 강사별 퇴원율 추이 — 아래 필터와 따로 세는 강사평가 값(카드 머리에 기준을 적는다). 권한 '강사별 퇴원율'이 열린 사람만.
          🔴 필터 툴바 **위**에 둔다(원장 2026-11-13 *"필터를 실제 적용되는곳 위에"*) — 툴바 아래에는 필터가 걸리는 카드만 잇는다
          (등록 후 띠 · 월별 추이 · 분석 카드 · 명단 · 사유 분석). 필터가 안 걸리는 카드를 툴바 아래로 되돌리지 말 것. */}
      {churnGate ? (
        <Suspense fallback={<TeacherChurnSkeleton view={trendPrefs.churnView} />}>
          <TeacherChurnSection initialSort={trendPrefs.churnSort} initialView={trendPrefs.churnView} />
        </Suspense>
      ) : null}

      {/* 세는 달 = 수업료를 낸 마지막 달(원장 2026-10-29). 규칙 설명 문장은 원장 지시로 뺐다(2026-11-11 *"이 멘트도 제거"*) —
          앞 달 명단에 들어간 건수 안내만 남긴다(그때만 선다). */}
      {carriedTotal > 0 ? (
        <p className="text-text-dim px-1 text-sm">
          <>
            <span className="text-foreground font-semibold">{countedEarlierTitle(monthKey, carriedTotal, "건")}</span>{" — "}
            {carriedGroups.map(([m, n], i) => (
              <Fragment key={m}>
                {i ? " · " : ""}
                <EmbedLink href={hrefWith({ month: m })} scroll={false} className="text-primary font-semibold underline-offset-2 hover:underline">
                  {Number(m.slice(5, 7))}월 명단 보기({n}건 포함)
                </EmbedLink>
              </Fragment>
            ))}
          </>
        </p>
      ) : null}

      {/* 툴바 — 지시서 §10: 축마다 라벨 하나(`유형: 전체` · `기간: 최근 30일` · 사유 · 과목 · 상담), 검색은 눌러야 나온다. */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <FilterSelect
          paramName="type"
          value={type === "all" ? "" : type}
          options={TYPE_OPTIONS}
          axisLabel="유형"
          ariaLabel="유형"
          {...SELECT_PROPS}
        />
        {/* 기간을 바꾸면 `month=`·`from=`·`to=`는 지운다 — 옛 값이 붙어 남지 않게. */}
        <FilterSelect
          paramName="range"
          value={range === "all" ? "" : range}
          options={rangeOptions}
          axisLabel="기간"
          ariaLabel="기간 필터"
          clearParams={["month", "from", "to"]}
          {...SELECT_PROPS}
        />
        {custom ? <CustomRange key={`${custom.from}~${custom.to}`} from={custom.from} to={custom.to} /> : null}
        <FilterSelect
          paramName="reason"
          value={reason === "all" ? "" : reason}
          options={reasonOptions}
          axisLabel="사유"
          ariaLabel="사유 필터"
          clearParams={["detail"]}
          {...SELECT_PROPS}
        />
        {/* 과목 선택지는 학원설정 단일 소스(subjectMaps.options) — 하드코딩 금지. */}
        <FilterSelect
          paramName="subject"
          value={subject === "all" ? "" : subject}
          options={subjectMaps.options}
          axisLabel="과목"
          ariaLabel="과목 필터"
          {...SELECT_PROPS}
        />
        {/* 프로그램 — 퇴원은 마지막 수강 반, 수강종료는 그 과목 마지막 반 기준(withdrawalProgram). */}
        <FilterSelect
          paramName="program"
          value={program ?? ""}
          options={visiblePrograms(isModuleEnabled(settings.modules.disabled, "eie")).map((p) => ({
            value: p,
            label: programLabel(p, settings.operations.subjects, isModuleEnabled(settings.modules.disabled, "eie")),
          }))}
          axisLabel="프로그램"
          ariaLabel="프로그램 필터"
          {...SELECT_PROPS}
        />
        {/* 담당강사(원장 2026-10-15) — 선택지 = 강사 카드 칸과 같은 판정(`teacherFilterOptions`) · 고르면 `teacher=`(강사 카드 칸과 같은 주소).
            판정이 무거워 선택지는 흘려받는다 — 그동안은 고른 값만 든 같은 드롭다운. 판정에 실패하면 아래 칩이 '불러오지 못해 걸지 않음'. */}
        {teacherF && !teacherMap ? null : (
          <Suspense
            key={`teacher-filter:${streamKey}`}
            fallback={<TeacherFilter value={teacherF} options={teacherF ? [{ value: teacherF, label: teacherLabel(teacherF) }] : []} />}
          >
            <StreamedTeacherFilter value={teacherF} options={teacherOptionsP} />
          </Suspense>
        )}
        <FilterSelect
          paramName="consult"
          value={consult === "all" ? "" : consult}
          options={CONSULT_OPTIONS}
          axisLabel="상담"
          ariaLabel="상담 필터"
          {...SELECT_PROPS}
        />
        {/* 등록 후 조기 퇴원(원장 2026-10-15) — 등록일부터 30·60·90일 이내 퇴원(누적). 수강종료는 빠진다. */}
        {type !== "subject-ended" ? (
          <FilterSelect
            paramName="early"
            value={early ?? ""}
            options={EARLY_SPANS.map((s) => ({ value: s.key, label: s.label }))}
            axisLabel="등록 후"
            ariaLabel="등록 후 퇴원 기간 필터"
            {...SELECT_PROPS}
          />
        ) : null}
        {/* 분석 카드에서 고른 칸(학년·학교) — 드롭다운이 없는 축이라 칩으로 보이고 × 로 푼다(강사는 위 담당강사 드롭다운). */}
        {detailF ? <FacetChip label={`세부: ${detailFacetLabel(detailF)}`} href={hrefWith({ detail: null })} /> : null}
        {gradeF ? <FacetChip label={`학년: ${scopeParts.grade}`} href={hrefWith({ grade: null })} /> : null}
        {schoolF ? <FacetChip label={`학교: ${scopeParts.school}`} href={hrefWith({ school: null })} /> : null}
        {teacherF && !teacherMap ? <FacetChip label="담당강사: 불러오지 못해 걸지 않음" href={hrefWith({ teacher: null })} /> : null}
        <SearchToggle placeholder="학생명" defaultValue={q} />
        {filterActive ? (
          <Link
            href="/withdrawals"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-text-faint hover:text-foreground inline-flex items-center px-1 whitespace-nowrap transition`}
          >
            필터 초기화
          </Link>
        ) : null}
      </div>

      {/* 등록 후 3개월 내 퇴원 — 퇴원만 세므로 '수강종료만' 보기에선 세우지 않는다. */}
      {all.length > 0 && type !== "subject-ended" ? (
        <EarlyExitBand
          counts={earlyCount}
          judged={earlyJudged.length}
          unjudged={earlyRows.length - earlyJudged.length}
          active={early}
          hrefs={earlyHrefs}
          scope={earlyScope}
        />
      ) : null}

      {/* 통계 — 카드마다 **자기 축만 빼고** 필터 반영(패싯). 위 술어 주석 참조. */}
      {all.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className="bg-card shadow-card rounded-2xl p-5">
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-foreground text-base font-bold">월별 {noun} 추이</h2>
              <span className="text-text-faint text-xs">
                {/* 무엇을 센 건지 말해 준다 — 필터가 걸렸는데 "전체"라고 적으면 화면이 거짓말을 한다. */}
                최근 12개월 · {EXIT_BASIS_TAG} · {typeTrend ? `학원 전체 ${sum(typeTrend)}건 · ${scope} ${sum(trend)}건` : `${scope} ${sum(trend)}건`}
                {range !== "all" ? " (기간 필터는 이 축이라 제외)" : ""}
                {systemBulkCount > 0 ? ` (시스템 정리 ${systemBulkCount}명 제외 — 퇴원일 미상)` : ""}
                {cleanupTrendCount > 0 ? ` (장부 정리 ${cleanupTrendCount}명 제외 — 퇴원일이 장부 날짜)` : ""}
              </span>
            </header>
            <WithdrawalTrendChart data={trendData} filterLabel={typeTrend ? scope : noun} initialPrefs={trendPrefs} unit={withdrawnOnly ? "명" : "건"} />
          </section>
          {/* 분석 카드 — 과목 · 강사 · 학년 · 학교(원장 2026-10-15). 축마다 자기 축만 빼고 필터를 따른다(패싯 — 과목 칸은 과목을 고르면 그것도 따른다) · 칸을 누르면 명단이 걸러진다.
              🔴 Suspense에 검색어 key — Next는 검색어만 바뀌는 이동에서 같은 경계를 다시 쓰고, 이미 보인 경계는 이동 내내 옛 화면을 붙든다
              (= 모든 필터·쪽 이동이 판정 ~1초를 기다림). 이동마다 새 경계라 대기 카드가 바로 선다(적대 리뷰 2026-10-15). */}
          {teacherLater ? (
            <Suspense
              key={new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (k !== "axis" && typeof v === "string" ? [[k, v]] : []))).toString()}
              fallback={<WithdrawalBreakdownCard views={{ ...breakdownViews, teacher: null }} initialAxis={axis} teacherLoading />}>
              <StreamedBreakdown views={breakdownViews} axis={axis} teacher={teacherLater} />
            </Suspense>
          ) : (
            <WithdrawalBreakdownCard views={{ ...breakdownViews, teacher: teacherNow.view }} initialAxis={axis} teacherError={teacherNow.error} />
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          image="withdrawals"
          icon={() => <UserX size={32} strokeWidth={1.8} />}
          title={`${noun} 학생이 없습니다`}
          description="퇴원 처리되거나 한 과목을 끊은 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <WithdrawalListLayout size={size} total={total}>
          <section data-withdrawal-list className="bg-card shadow-card overflow-hidden rounded-2xl">
            <header data-withdrawal-header className="border-line flex items-baseline justify-between border-b px-5 py-4">
              <div>
                <p className="micro">최근 {noun}</p>
                <h2 className="text-foreground mt-1 text-base font-bold">학생 명단</h2>
              </div>
              <p className="text-text-faint num text-xs">
                {start + 1}–{end} / {total}건
              </p>
            </header>
            {/* 행 = 유형 | 이름(학교학년) | 마지막 반 | 담당강사 | 사유·메모 | 날짜 | 경과 — 한 줄(§11), 행 전체가 링크.
                유형 라벨 = 퇴원(장미) · 수강종료(호박) — 원장 2026-09-28 "따로 라벨처리". 수강종료는 학생 상세로 간다
                (퇴원 상세는 퇴원 사유·사후상담 화면이라 재원생에겐 맞지 않는다). */}
            <ul data-withdrawal-rows className="divide-line divide-y">
              {pageRows.map((r) => (
                <ExitRowItem
                  key={r.key}
                  row={r}
                  labelOf={subjectMaps.labelOf}
                  today={today}
                  teacher={
                    <Suspense key={`teacher-cell:${streamKey}:${r.key}`} fallback={<span className="text-text-faint" title="담당 확인 중">…</span>}>
                      <TeacherCell cells={teacherCellsP} rowKey={r.key} />
                    </Suspense>
                  }
                />
              ))}
            </ul>
            <div data-withdrawal-pager className="border-line border-t px-5 py-3">
              {totalPages > 1 ? (
                <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} scroll={false} />
              ) : (
                <p className="text-center text-xs">전체 {total}건</p>
              )}
            </div>
          </section>

          {/* 사유 분석 — 퇴원 사유 + 수강종료 사유(그 과목 수강의 종료 사유). 유형 필터를 따른다 · 대분류를 고르면 세부 막대. */}
          <ReasonAnalysisCard
            noun={noun}
            base={reasonBase}
            unspecified={reasonGroups.get(REASON_UNSPECIFIED)?.count ?? 0}
            bars={topReasons.map(([value, g]) => ({
              value,
              label: g.label,
              count: g.count,
              active: reason === value,
              href: hrefWith({ reason: reason === value ? "all" : value, detail: null }),
            }))}
            cleanup={
              cleanupCount > 0
                ? { count: cleanupCount, active: reason === REASON_CLEANUP, href: hrefWith({ reason: reason === REASON_CLEANUP ? "all" : REASON_CLEANUP, detail: null }) }
                : null
            }
            details={detailView}
            summary={
              topReasons[0]?.[0] === REASON_UNSPECIFIED
                ? "사유 미기재가 가장 많습니다. 기록된 사유를 보완해야 퇴원 원인을 비교할 수 있습니다."
                : topReasons[0]?.[0] === "other"
                  ? "'기타'가 가장 많습니다. 막대를 눌러 명단 줄의 메모로 실제 사유를 확인하고, 알맞은 사유로 고쳐 주세요."
                  : topReasons[0]
                    ? `현재 가장 빈번한 ${noun} 사유는 "${topReasons[0][1].label}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                    : `${noun} 사유가 등록되면 인사이트가 표시됩니다.`
            }
          />
        </WithdrawalListLayout>
      )}
    </div>
  );
}

/** 목록 한 줄 — 퇴원과 수강종료가 같은 열에 선다(라벨로 가른다). */
function ExitRowItem({ row: r, labelOf, today, teacher }: {
  row: ExitRow;
  labelOf: (key: string) => string;
  today: string;
  /** '담당강사' 칸 — 흘려받는 판정(`TeacherCell`). */
  teacher: ReactNode;
}) {
  // 오늘 이후 날짜 = 퇴원 예정(아직 다니는 중) — '오늘'이라 적으면 거짓이다.
  const ago = r.date && r.date > today ? "예정" : relativeDayKo(r.date, today);
  // 퇴원월이 퇴원일의 달과 다르면(수강료를 앞 달까지만 냄 — 원장 2026-10-29) 어느 달로 셌는지 적는다.
  const ended = r.kind === "subject-ended";
  const countedMonth =
    r.countDate && r.date && r.countDate.slice(0, 7) !== r.date.slice(0, 7) ? `${Number(r.countDate.slice(5, 7))}월 ${ended ? "종료" : "퇴원"}` : null;
  const where = schoolGradeLabel(r.school, r.grade);
  const reason = reasonFacetOf(r);
  const detail = r.detail ? reasonDetailOf(r.detail)?.label : null;
  const reasonText = detail ? `${reason.label} · ${detail}` : reason.label;
  return (
    <li className="hover:bg-bg-soft/50 transition">
      <WindowLink
        // 퇴원생 관리 차트에만 있는 줄은 에이와 학생이 없다 — 이 목록 자리에 머문다.
        href={r.fromSheet || !r.studentId ? "/withdrawals" : ended ? `/students/${r.studentId}` : `/withdrawals/${r.studentId}`}
        title={r.fromSheet ? `${r.name} — 퇴원생 관리 차트 기록` : r.name}
        className="grid h-11 grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-5 sm:grid-cols-[4.75rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_6.5rem_5rem] xl:grid-cols-[4.75rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.55fr)_minmax(0,1fr)_6.5rem_5rem]"
      >
        <span className="whitespace-nowrap">
          <Pill color={ended ? "amber" : "rose"}>{ended ? "수강종료" : "퇴원"}</Pill>
        </span>
        <p className="text-foreground min-w-0 truncate text-base leading-none font-bold">
          {r.name}
          {where ? <span className="text-text-dim ml-1.5 text-sm font-semibold">{where}</span> : null}
          {r.onHold ? <span className="text-text-faint ml-1 text-sm font-normal">(휴원)</span> : null}
          {/* 등록 후 3개월 안에 그만둔 퇴원 — 며칠 만인지(원장 2026-10-15 조기 퇴원 추적). */}
          {r.tenureDays !== null && r.tenureDays <= EARLY_MAX_DAYS ? (
            <span className="text-rose ml-1.5 text-sm font-semibold">등록 {r.tenureDays}일 만</span>
          ) : null}
        </p>
        {/* 폰 폭에선 반·경과 열을 접는다 — 고정 열이 폭을 다 먹어 이름이 30px로 짓눌린다(리뷰 2026-09-28). */}
        <p className="text-text-dim hidden min-w-0 truncate text-sm sm:block">
          {ended ? `${labelOf(r.subjects[0] ?? "")} 종료 · ` : ""}
          {r.className ?? "수강 반 없음"}
          {ended && r.activeSubjects?.length ? ` · ${r.activeSubjects.map(labelOf).join("·")} 수강중` : ""}
        </p>
        {/* 담당강사(원장 2026-10-15) — 강사 카드·담당강사 필터·시간표 X와 같은 판정('담당 미반영' · 판정 폭 밖은 '—').
            넓은 화면(xl)에서만 — 좁은 창에선 담당강사 필터·강사 카드로 본다. */}
        <p className="text-text-dim hidden min-w-0 truncate text-sm xl:block">{teacher}</p>
        {/* 사유 · 메모 — '기타'의 실제 사유는 메모에 있다(원장 2026-10-15 *"눌러서 들어가 볼 수 있게"*). 잘리면 카드로 전문. */}
        <p
          className="text-text-dim hidden min-w-0 truncate text-sm sm:block"
          {...tipProps({ title: r.name, rows: [["사유", reasonText], ["메모", r.memo ?? ""]] })}
        >
          <span className={r.cleanup ? "text-text-faint" : "text-foreground font-semibold"}>{reasonText}</span>
          {r.memo && !r.cleanup ? ` · ${r.memo}` : ""}
        </p>
        {/* 시스템 일괄 정리분 = 퇴원일이 실제 시점이 아니라 장부 날짜라 경과일을 표시하지 않는다
            (그대로 두면 "20일 전 퇴원"처럼 틀린 사실을 읽게 된다). */}
        {r.systemBulk ? (
          <>
            <span className="justify-self-end">
              <Pill color="neutral">시스템 정리</Pill>
            </span>
            <span className="text-text-faint hidden justify-self-end text-sm whitespace-nowrap sm:inline">퇴원일 미상</span>
          </>
        ) : (
          <>
            <span className="text-foreground num justify-self-end text-sm font-bold whitespace-nowrap">{r.date ?? "—"}</span>
            <span className="text-text-faint num hidden justify-self-end text-sm whitespace-nowrap sm:inline">
              {countedMonth ?? (ago === r.date ? "" : ago)}
            </span>
          </>
        )}
      </WindowLink>
    </li>
  );
}

/** 분석 카드에서 고른 칸 — 툴바 칩(× 로 푼다). 창 안에서도 `embed=1`을 잃지 않는 링크. */
function FacetChip({ label, href }: { label: string; href: string }) {
  return (
    <EmbedLink href={href} scroll={false} aria-label={`${label} 필터 해제`} className={`${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_ON}`}>
      {label}
      <X size={12} strokeWidth={2} />
    </EmbedLink>
  );
}

/** 명단 '담당강사' 칸 — 판정이 끝나면 그 줄의 글(`teacherCellText`), 판정 실패면 '—'. */
async function TeacherCell({ cells, rowKey }: { cells: Promise<ReadonlyMap<string, string> | null>; rowKey: string }) {
  const map = await cells;
  const text = map?.get(rowKey) ?? "—";
  return <span title={map ? text : "담당을 불러오지 못했습니다"}>{text}</span>;
}

/** 담당강사 드롭다운 — 고르면 `teacher=`(강사 카드 칸과 같은 주소 · 쪽은 1쪽으로). */
function TeacherFilter({ value, options }: { value: string | null; options: { value: string; label: string }[] }) {
  return <FilterSelect paramName="teacher" value={value ?? ""} options={options} axisLabel="담당강사" ariaLabel="담당강사 필터" {...SELECT_PROPS} />;
}

/** 담당강사 선택지를 흘려받아 그린다 — 판정 실패면 고른 값만(선택이 사라지지 않게). */
async function StreamedTeacherFilter({ value, options }: { value: string | null; options: Promise<{ value: string; label: string }[] | null> }) {
  return <TeacherFilter value={value} options={(await options) ?? []} />;
}

/** 강사 카드를 나중에 그린다 — 판정이 끝날 때까지 Suspense가 같은 카드(강사 칸 '세는 중')를 보인다. */
async function StreamedBreakdown({ views, axis, teacher }: {
  views: Record<"subject" | "grade" | "school", BreakdownView>;
  axis: BreakdownAxis;
  teacher: Promise<{ view: BreakdownView | null; error: boolean }>;
}) {
  const t = await teacher;
  return <WithdrawalBreakdownCard views={{ ...views, teacher: t.view }} initialAxis={axis} teacherError={t.error} />;
}
