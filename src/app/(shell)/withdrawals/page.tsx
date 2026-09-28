import Link from "next/link";
import { isValidYm, kstMonth, kstToday, monthLabel, shiftMonth } from "@/lib/date-kst";
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
import { parseProgram, programLabel, visiblePrograms, type Program } from "@/features/students/program";
import { isModuleEnabled } from "@/lib/modules";
import {
  UserMinus,
  CalendarClock,
  ListChecks,
  Filter,
  AlertCircle,
  UserX,
  BookOpen,
} from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchToggle } from "@/components/search-toggle";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
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
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WithdrawalTrendChart, type WithdrawalMonthPoint } from "./_components/trend-chart";
import { WithdrawalListLayout } from "./_components/list-layout";
import { CustomRange } from "./_components/custom-range";
import { withdrawalPage, withdrawalPageSize } from "@/features/withdrawals/list-pagination";

export const metadata = { title: "퇴원관리 — aywa" };

/** 최근 12개월 추이(기간 축 제외 모집단) — 모듈 함수라 RSC 본문 아님(new Date 허용, #11). */
function monthlyExits(rows: { date: string | null }[]): WithdrawalMonthPoint[] {
  // 🔴 달 축은 **KST** — `new Date().getMonth()`는 서버가 UTC라 매달 1일 새벽에 12개월 창이 한 달 밀린다.
  const thisMonth = kstMonth();
  const months: { key: string; point: WithdrawalMonthPoint }[] = [];
  for (let i = 11; i >= 0; i--) {
    const key = shiftMonth(thisMonth, -i);
    months.push({ key, point: { label: `${Number(key.slice(5))}월`, count: 0 } });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    // `date`는 이미 KST 달력 날짜다(퇴원일·수강 종료일 둘 다 date 컬럼) — UTC로 다시 풀지 않는다.
    const i = idx.get(r.date?.slice(0, 7) ?? "");
    if (i != null) months[i]!.point.count++;
  }
  return months.map((m) => m.point);
}

/**
 * 과목별 분포(과목 축 제외 모집단) 상위 N. 한 줄이 과목 여럿이면(수학·영어를 함께 끊은 퇴원) **과목마다** 센다.
 * 라벨은 학원설정(operations.subjects)에서 — labelOf 주입.
 */
function subjectBreakdown(
  rows: { subjects: string[] }[],
  labelOf: (key: string) => string,
  topN = 6,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const s of r.subjects.length ? r.subjects : ["미상"]) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([s, count]) => ({ label: s === "미상" ? "미상" : labelOf(s), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

type ReasonKey = "all" | WithdrawalReason | "unspecified";
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
  q: string;
  subject: string;
  program: Program | null;
  consult: ConsultKey;
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
  if (p.subject !== "all") sp.set("subject", p.subject);
  if (p.program) sp.set("program", p.program);
  if (p.consult !== "all") sp.set("consult", p.consult);
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
    q?: string;
    subject?: string;
    program?: string;
    consult?: ConsultKey;
    page?: string;
    size?: string;
    embed?: string;
  }>;
}) {
  await requireAccess("withdrawals");
  const sp = await searchParams;
  const type = parseType(sp.type);
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = (sp.reason as ReasonKey) ?? "all";
  const subject = sp.subject ?? "all";
  const consult: ConsultKey = (sp.consult as ConsultKey) ?? "all";
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
  const [withdrawnRaw, subjectEndedRaw, settings] = await Promise.all([
    getWithdrawnStudents(),
    withSubjectEnded ? getSubjectEndedStudents() : Promise.resolve([]),
    getTenantSettings(),
  ]);
  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const all = sortExitRows(toExitRows(withdrawnRaw, subjectEndedRaw));
  const withdrawnTotal = withdrawnRaw.length;
  const subjectEndedTotal = all.length - withdrawnTotal;
  /**
   * 필터를 **축별 술어**로 쪼갠다 — 카드마다 "자기 축만 빼고" 나머지를 적용하기 위해서다(패싯).
   *
   * 🔴 왜 축을 빼나: 필터를 통째로 걸면 그 카드가 스스로를 부정한다 —
   *    · 월별 추이에 **기간**을 걸면 "최근 30일"에서 막대가 1~2개만 남아 12개월 추이가 사라진다.
   *    · 과목별 분포에 **과목**을 걸면 막대가 자기 자신 하나만 남는다.
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
  const byReason = (r: ExitRow) => reason === "all" || (r.reasonKey ?? "unspecified") === reason;
  const bySubject = (r: ExitRow) => subject === "all" || r.subjects.includes(subject);
  const byConsult = (r: ExitRow) =>
    consult === "all" || (r.consulted !== null && (consult === "done" ? r.consulted : !r.consulted));
  const byProgram = (r: ExitRow) =>
    !program ||
    withdrawalProgram(
      { lastClassSubject: r.programSubject, lastClassEnglishTrack: r.englishTrack },
      settings.operations.subjects,
    ) === program;
  // 유형·프로그램·이름은 어느 카드의 '자기 축'도 아니라 모든 모집단에 건다.
  const base = (r: ExitRow) => byName(r) && byProgram(r) && byType(r);

  // 목록 = **전 축** 적용(사용자가 고른 그대로).
  const rows = all.filter((r) => base(r) && byRange(r) && byReason(r) && bySubject(r) && byConsult(r));
  // 카드별 모집단 — 자기 축 하나만 뺀다.
  const trendRows = all.filter((r) => base(r) && byReason(r) && bySubject(r) && byConsult(r)); // 기간 제외
  const subjectRows = all.filter((r) => base(r) && byRange(r) && byReason(r) && byConsult(r)); // 과목 제외
  // 상담 카드는 퇴원만 — 수강종료에는 사후상담이 없다. 사유 카드는 둘 다(유형 필터를 따른다).
  const consultRows = all.filter(
    (r) => r.kind === "withdrawn" && base(r) && byRange(r) && byReason(r) && bySubject(r),
  ); // 상담 제외
  const reasonRows = all.filter((r) => base(r) && byRange(r) && bySubject(r) && byConsult(r)); // 사유 제외

  // 상담 미완료 worklist 집계 — **상담 축만 뺀** 모집단(상담 필터를 걸면 0%/100%밖에 안 나온다).
  const consultPending = consultRows.filter((r) => !r.consulted).length;
  const consultRate = consultRows.length
    ? Math.round(((consultRows.length - consultPending) / consultRows.length) * 100)
    : 0;

  // 사유 통계 — **사유 축만 뺀** 모집단(사유를 고르면 막대가 자기 자신 하나만 남는다).
  const reasonCounts = new Map<string, number>();
  for (const r of reasonRows) {
    const key = r.reasonLabel ?? "미기재";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = topReasons[0]?.[1] ?? 1;

  // 최근 30일 — **기간 축만 뺀** 모집단(자기 기간을 이미 30일로 못박은 수치라 기간 필터를 또 걸 수 없다).
  const recentWindow = resolveRange("30d", { today, month: monthWindow });
  const recent = trendRows.filter((r) => inRange(r, recentWindow)).length;

  // 월별 추이 = 기간 축 제외 · 과목별 분포 = 과목 축 제외(위 술어 주석 참조).
  // ⚠️ **시스템 정리(날짜 미상)는 월별 추이에서 뺀다** — 퇴원일이 실제 시점이 아니라 일괄 처리된 장부 날짜라
  //    그대로 세면 그 달이 부풀어 "7월 퇴원 N명"이 사실과 달라진다(교정 전 152명이 그렇게 나왔다).
  //    목록에서는 숨기지 않는다(실제로 퇴원한 게 맞고 날짜만 모른다) — [system-bulk.ts](@/features/withdrawals/system-bulk) 참조.
  const systemBulkCount = trendRows.filter((r) => r.systemBulk).length;
  const trend = monthlyExits(trendRows.filter((r) => !r.systemBulk));
  const subjects = subjectBreakdown(subjectRows, subjectMaps.labelOf);
  const subjMax = subjects[0]?.count ?? 1;

  const reasonOptions: { value: Exclude<ReasonKey, "all">; label: string }[] = [
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({ value: k, label })),
    { value: "unspecified", label: "미기재" },
  ];

  const custom = "custom" in rangeWindow ? rangeWindow.custom : undefined;
  const current: WdHrefParams = {
    type,
    range,
    from: custom?.from ?? null,
    to: custom?.to ?? null,
    month: monthKey,
    reason,
    q,
    subject,
    program,
    consult,
  };
  const filterActive =
    type !== "all" || range !== "all" || reason !== "all" || subject !== "all" || consult !== "all" || !!program || !!q;
  const rangeOptions = [
    { value: "month" as const, label: monthKey === kstMonth() ? "이번 달" : monthLabel(monthKey) },
    ...RANGE_OPTIONS,
  ];
  // 화면 말 — 유형에 따라 '퇴원' / '수강종료' / '퇴원·수강종료'.
  const noun = type === "withdrawn" ? "퇴원" : type === "subject-ended" ? "수강종료" : "퇴원·수강종료";

  // 통계는 전체 필터 결과를 유지하고, 명단만 오른쪽 카드 높이에 맞는 크기로 자른다.
  const total = rows.length;
  const { page, totalPages, start, end } = withdrawalPage(sp.page, total, size);
  const pageRows = rows.slice(start, end);
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
        description={withSubjectEnded ? `퇴원 ${withdrawnTotal}명 · 수강종료 ${subjectEndedTotal}건` : `퇴원 ${withdrawnTotal}명`}
      />

      {/* Stat strip — Editorial 문법 ②(공용 BigStat) */}
      <StatStrip>
        <BigStat label="전체 퇴원" value={withdrawnTotal} unit="명" tone="rose" icon={<UserMinus size={16} strokeWidth={1.8} />} />
        {withSubjectEnded ? (
        <BigStat
          label="수강종료"
          value={subjectEndedTotal}
          unit="건"
          sub="재원 중 한 과목을 끊음"
          tone="amber"
          icon={<BookOpen size={16} strokeWidth={1.8} />}
        />
        ) : null}
        <BigStat label="최근 30일" value={recent} unit="건" sub={noun} tone="danger" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat
          label="상담 미완료"
          value={consultPending}
          unit="명"
          sub={`퇴원 사후상담 완료율 ${consultRate}%`}
          tone="amber"
          icon={<ListChecks size={16} strokeWidth={1.8} />}
        />
        <BigStat label="필터 결과" value={rows.length} unit="건" tone="blue" icon={<Filter size={16} strokeWidth={1.8} />} />
      </StatStrip>

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
        <FilterSelect
          paramName="consult"
          value={consult === "all" ? "" : consult}
          options={CONSULT_OPTIONS}
          axisLabel="상담"
          ariaLabel="상담 필터"
          {...SELECT_PROPS}
        />
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

      {/* 통계 — 카드마다 **자기 축만 빼고** 필터 반영(패싯). 위 술어 주석 참조. */}
      {all.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className="bg-card shadow-card rounded-2xl p-5">
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-foreground text-base font-bold">월별 {noun} 추이</h2>
              <span className="text-text-faint text-xs">
                {/* 무엇을 센 건지 말해 준다 — 필터가 걸렸는데 "전체"라고 적으면 화면이 거짓말을 한다. */}
                최근 12개월 · {trendRows.length}건
                {range !== "all" ? " (기간 필터는 이 축이라 제외)" : ""}
                {systemBulkCount > 0 ? ` (시스템 정리 ${systemBulkCount}명 제외 — 퇴원일 미상)` : ""}
              </span>
            </header>
            <WithdrawalTrendChart data={trend} />
          </section>
          <section className="bg-card shadow-card rounded-2xl p-5">
            <header className="mb-3">
              <h2 className="text-foreground text-base font-bold">과목별 분포</h2>
              <span className="text-text-faint text-xs">
                {subjectRows.length}건{subject !== "all" ? " (과목 필터는 이 축이라 제외)" : ""}
                {" · 두 과목을 함께 끊은 퇴원은 과목마다 셉니다"}
              </span>
            </header>
            <div className="space-y-3">
              {subjectRows.some((r) => r.subjects.length === 0) ? (
                <p className="text-xs">
                  과목 미상 {subjectRows.filter((r) => r.subjects.length === 0).length}건 포함 · 수강 과목이 기록되지 않은
                  학생입니다.
                </p>
              ) : null}
              {subjects.map((s) => (
                <div key={s.label}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-foreground text-xs font-bold">{s.label}</span>
                    <span className="text-text-dim num text-xs">
                      <span className="text-foreground font-bold">{s.count}</span>건
                    </span>
                  </div>
                  <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                    <span className="bg-rose block h-full" style={{ width: `${(s.count / subjMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
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
            {/* 행 = 유형 | 이름(학교학년) | 마지막 반 | 날짜 | 경과 — 한 줄(§11), 행 전체가 링크.
                유형 라벨 = 퇴원(장미) · 수강종료(호박) — 원장 2026-09-28 "따로 라벨처리". 수강종료는 학생 상세로 간다
                (퇴원 상세는 퇴원 사유·사후상담 화면이라 재원생에겐 맞지 않는다). */}
            <ul data-withdrawal-rows className="divide-line divide-y">
              {pageRows.map((r) => (
                <ExitRowItem key={r.key} row={r} labelOf={subjectMaps.labelOf} />
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

          {/* 사유 분석 — 퇴원 사유 + 수강종료 사유(그 과목 수강의 종료 사유). 유형 필터를 따른다. */}
          <section data-withdrawal-reasons className="bg-card shadow-card overflow-hidden rounded-2xl">
            <header className="border-line border-b px-5 py-4">
              <p className="micro text-amber">사유 분석</p>
              <h2 className="text-foreground mt-1 text-base font-bold">상위 {noun} 사유</h2>
              <p className="mt-1 text-xs">
                {reasonRows.length}건 기준 · 사유 필터 제외
                {reasonCounts.has("미기재") ? ` · 사유 미기재 ${reasonCounts.get("미기재")}건 포함` : ""}
              </p>
            </header>
            <div className="space-y-3 p-5">
              {topReasons.map(([reason, count]) => {
                const pct = (count / maxCount) * 100;
                return (
                  <div key={reason}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-foreground text-xs font-bold">{reason}</span>
                      <span className="text-text-dim num text-xs">
                        <span className="text-foreground font-bold">{count}</span>건 ·{" "}
                        {((count / Math.max(reasonRows.length, 1)) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                      <span className="bg-rose block h-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 규칙 기반 자동 요약 (LLM 아님) — sparkle(AI 마커) 대신 pulse로 라이브 AI와 구분 */}
            <div className="border-line bg-amber-soft border-t px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="bg-amber/15 text-amber flex size-7 shrink-0 items-center justify-center rounded-md">
                  <AlertCircle size={13} strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-amber text-xs font-bold">자동 요약</p>
                  <p className="text-foreground mt-0.5 text-xs leading-relaxed">
                    {topReasons[0]?.[0] === "미기재"
                      ? "사유 미기재가 가장 많습니다. 기록된 사유를 보완해야 퇴원 원인을 비교할 수 있습니다."
                      : topReasons[0]
                        ? `현재 가장 빈번한 ${noun} 사유는 "${topReasons[0][0]}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                        : `${noun} 사유가 등록되면 인사이트가 표시됩니다.`}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </WithdrawalListLayout>
      )}
    </div>
  );
}

/** 목록 한 줄 — 퇴원과 수강종료가 같은 열에 선다(라벨로 가른다). */
function ExitRowItem({ row: r, labelOf }: { row: ExitRow; labelOf: (key: string) => string }) {
  const ago = relativeDayKo(r.date);
  const where = schoolGradeLabel(r.school, r.grade);
  const ended = r.kind === "subject-ended";
  return (
    <li className="hover:bg-bg-soft/50 transition">
      <WindowLink
        href={ended ? `/students/${r.studentId}` : `/withdrawals/${r.studentId}`}
        title={r.name}
        className="grid h-11 grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-5 sm:grid-cols-[4.75rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem_5rem]"
      >
        <span className="whitespace-nowrap">
          <Pill color={ended ? "amber" : "rose"}>{ended ? "수강종료" : "퇴원"}</Pill>
        </span>
        <p className="text-foreground min-w-0 truncate text-base leading-none font-bold">
          {r.name}
          {where ? <span className="text-text-dim ml-1.5 text-sm font-semibold">{where}</span> : null}
          {r.onHold ? <span className="text-text-faint ml-1 text-sm font-normal">(휴원)</span> : null}
        </p>
        {/* 폰 폭에선 반·경과 열을 접는다 — 고정 열이 폭을 다 먹어 이름이 30px로 짓눌린다(리뷰 2026-09-28). */}
        <p className="text-text-dim hidden min-w-0 truncate text-sm sm:block">
          {ended ? `${labelOf(r.subjects[0] ?? "")} 종료 · ` : ""}
          {r.className ?? "수강 반 없음"}
          {ended && r.activeSubjects?.length ? ` · ${r.activeSubjects.map(labelOf).join("·")} 수강중` : ""}
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
              {ago === r.date ? "" : ago}
            </span>
          </>
        )}
      </WindowLink>
    </li>
  );
}
