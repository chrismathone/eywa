import Link from "next/link";
import { kstDateOf, kstMonth, shiftMonth } from "@/lib/date-kst";
import {
  UserMinus,
  CalendarClock,
  ListChecks,
  Filter,
  AlertCircle,
  UserX,
} from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchToggle } from "@/components/search-toggle";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
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
  type SubjectEndedRow,
} from "@/features/withdrawals/server/queries";
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WithdrawalTrendChart, type WithdrawalMonthPoint } from "./_components/trend-chart";

export const metadata = { title: "퇴원관리 — eywa" };

const PAGE_SIZE = 50;

/** 퇴원 후 경과 일수(필터용 수치 — 표시는 relativeDayKo). withdrawn_at는 date 컬럼. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** 퇴원 후 상담 시도 여부 — 3개 추적 플래그 중 하나라도 true면 "상담함"(재등록 평가용). */
function isConsulted(r: { metadata: { consultation?: { adminCalledParent: boolean; teacherCalledParent: boolean; talkedWithStudent: boolean } } | null }): boolean {
  const c = r.metadata?.consultation;
  return !!c && (c.adminCalledParent || c.teacherCalledParent || c.talkedWithStudent);
}

/** 최근 12개월 퇴원 추이(기간 축 제외 모집단) — 모듈 함수라 RSC 본문 아님(new Date 허용, #11). */
function monthlyWithdrawals(rows: { withdrawnAt: string | null }[]): WithdrawalMonthPoint[] {
  // 🔴 달 축은 **KST** — `new Date().getMonth()`는 서버가 UTC라 매달 1일 새벽에 12개월 창이 한 달 밀린다.
  const thisMonth = kstMonth();
  const months: { key: string; point: WithdrawalMonthPoint }[] = [];
  for (let i = 11; i >= 0; i--) {
    const key = shiftMonth(thisMonth, -i);
    months.push({ key, point: { label: `${Number(key.slice(5))}월`, count: 0 } });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    if (!r.withdrawnAt) continue;
    // 🔴 버킷 키도 **KST 날짜**에서 — `.slice(0, 7)`은 UTC 달이라 1일 새벽 퇴원이 앞 달 칸에 들어간다.
    const i = idx.get(kstDateOf(r.withdrawnAt)?.slice(0, 7) ?? "");
    if (i != null) months[i]!.point.count++;
  }
  return months.map((m) => m.point);
}

/** 과목별 퇴원 분포(과목 축 제외 모집단) 상위 N. 라벨은 학원설정(operations.subjects)에서 — labelOf 주입. */
function subjectBreakdown(
  rows: { lastClassSubject: string | null }[],
  labelOf: (key: string) => string,
  topN = 6,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const s = r.lastClassSubject ?? "미상";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([s, count]) => ({ label: s === "미상" ? "미상" : labelOf(s), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

type RangeKey = "all" | "30d" | "90d" | "year";
type ReasonKey = "all" | WithdrawalReason | "unspecified";
type ConsultKey = "all" | "pending" | "done";

/** 드롭다운 항목 — 해제 항목('전체')은 FilterSelect가 맨 위에 스스로 세운다(축 이름은 `axisLabel`, `allLabel`에 넣지 말 것). */
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all">; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "올해" },
];

const CONSULT_OPTIONS: { value: Exclude<ConsultKey, "all">; label: string }[] = [
  { value: "pending", label: "상담 미완료" },
  { value: "done", label: "상담 완료" },
];

/** 툴바 공통 — 축마다 라벨 하나(`기간: 최근 30일`), 폭은 글자만큼. */
const SELECT_PROPS = { className: "w-auto", triggerClassName: TOOLBAR_SELECT } as const;

/**
 * 유형(퇴원 / 수강종료) — 두 목록을 오가는 보기 전환도 라벨 하나(지시서 §10 "보기 전환은 라벨"). 옛 세그먼트 칩 둘을 대체.
 * 두 갈래(퇴원 목록·수강종료 목록) 모두에 서서 어느 쪽에서도 되돌아올 수 있다.
 * 🔴 유형을 바꾸면 퇴원 목록의 필터·검색어를 **지운다**(`clearParams`) — 수강종료 갈래엔 필터도 '초기화'도 없어, 실은 채 넘어가면
 *    URL에만 남은 필터가 되돌아올 때 되살아나는데 사용자는 그것을 볼 길이 없다(리뷰 2026-09-04).
 */
const WITHDRAWN_FILTER_PARAMS = ["range", "reason", "subject", "consult", "q"];
function TypeSelect({ viewType }: { viewType: "withdrawn" | "subject-ended" }) {
  return (
    <FilterSelect
      paramName="type"
      value={viewType === "subject-ended" ? "subject-ended" : ""}
      options={[{ value: "subject-ended", label: "수강종료" }]}
      allLabel="퇴원"
      axisLabel="유형"
      ariaLabel="유형"
      clearParams={WITHDRAWN_FILTER_PARAMS}
      {...SELECT_PROPS}
    />
  );
}

type WdHrefParams = { range: RangeKey; reason: ReasonKey; q: string; subject: string; consult: ConsultKey };

function buildWdHref(p: WdHrefParams): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.reason !== "all") sp.set("reason", p.reason);
  if (p.subject !== "all") sp.set("subject", p.subject);
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
    reason?: ReasonKey;
    q?: string;
    subject?: string;
    consult?: ConsultKey;
    page?: string;
  }>;
}) {
  await requireAccess("withdrawals");
  const sp = await searchParams;
  const viewType: "withdrawn" | "subject-ended" =
    sp.type === "subject-ended" ? "subject-ended" : "withdrawn";
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = (sp.reason as ReasonKey) ?? "all";
  const subject = sp.subject ?? "all";
  const consult: ConsultKey = (sp.consult as ConsultKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [all, settings] = await Promise.all([getWithdrawnStudents(), getTenantSettings()]);
  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 수강종료 집계는 재원 전수 + enrollment 조회라 무거워, 해당 탭일 때만 계산.
  const subjectEnded = viewType === "subject-ended" ? await getSubjectEndedStudents() : [];
  /**
   * 필터를 **축별 술어**로 쪼갠다 — 카드마다 "자기 축만 빼고" 나머지를 적용하기 위해서다(패싯).
   *
   * 🔴 왜 축을 빼나: 필터를 통째로 걸면 그 카드가 스스로를 부정한다 —
   *    · 월별 추이에 **기간**을 걸면 "최근 30일"에서 막대가 1~2개만 남아 12개월 추이가 사라진다.
   *    · 과목별 분포에 **과목**을 걸면 막대가 자기 자신 하나만 남는다.
   *    · 상담률에 **상담**을 걸면 0% 아니면 100%밖에 안 나온다.
   * ⚠️ 반대로 아무것도 안 걸면(예전 동작) 사유 카드만 필터를 따라 움직여 **한 화면이 서로 다른 모집단을
   *    말한다** — 원장 지적(2026-08-10)의 실체가 그것이었다.
   */
  const term = q.toLowerCase();
  const rangeDays = range === "30d" ? 30 : range === "90d" ? 90 : 365;
  type Wd = (typeof all)[number];
  const byName = (r: Wd) => !q || r.name.toLowerCase().includes(term);
  const byRange = (r: Wd) => {
    if (range === "all") return true;
    const since = daysSince(r.withdrawnAt);
    return since !== null && since <= rangeDays;
  };
  const byReason = (r: Wd) => reason === "all" || (r.metadata?.reason ?? "unspecified") === reason;
  const bySubject = (r: Wd) => subject === "all" || r.lastClassSubject === subject;
  const byConsult = (r: Wd) => consult === "all" || (consult === "done" ? isConsulted(r) : !isConsulted(r));

  // 목록·사유 카드 = **전 축** 적용(사용자가 고른 그대로).
  const rows = all.filter((r) => byName(r) && byRange(r) && byReason(r) && bySubject(r) && byConsult(r));
  // 카드별 모집단 — 자기 축 하나만 뺀다.
  const trendRows = all.filter((r) => byName(r) && byReason(r) && bySubject(r) && byConsult(r)); // 기간 제외
  const subjectRows = all.filter((r) => byName(r) && byRange(r) && byReason(r) && byConsult(r)); // 과목 제외
  const consultRows = all.filter((r) => byName(r) && byRange(r) && byReason(r) && bySubject(r)); // 상담 제외
  const reasonRows = all.filter((r) => byName(r) && byRange(r) && bySubject(r) && byConsult(r)); // 사유 제외

  // 상담 미완료 worklist 집계 — **상담 축만 뺀** 모집단(상담 필터를 걸면 0%/100%밖에 안 나온다).
  const consultPending = consultRows.filter((r) => !isConsulted(r)).length;
  const consultRate = consultRows.length
    ? Math.round(((consultRows.length - consultPending) / consultRows.length) * 100)
    : 0;

  // 사유 통계 — **사유 축만 뺀** 모집단(사유를 고르면 막대가 자기 자신 하나만 남는다).
  const reasonCounts = new Map<string, number>();
  for (const r of reasonRows) {
    const key =
      (r.metadata?.reason
        ? REASON_LABEL[r.metadata.reason as WithdrawalReason]
        : r.withdrawalReason) ?? "미기재";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = topReasons[0]?.[1] ?? 1;

  // 최근 30일 — **기간 축만 뺀** 모집단(자기 기간을 이미 30일로 못박은 수치라 기간 필터를 또 걸 수 없다).
  const recent = trendRows.filter((r) => {
    const d = daysSince(r.withdrawnAt);
    return d !== null && d <= 30;
  }).length;

  // 월별 추이 = 기간 축 제외 · 과목별 분포 = 과목 축 제외(위 술어 주석 참조).
  // ⚠️ **시스템 정리(날짜 미상)는 월별 추이에서 뺀다** — 퇴원일이 실제 시점이 아니라 일괄 처리된 장부 날짜라
  //    그대로 세면 그 달이 부풀어 "7월 퇴원 N명"이 사실과 달라진다(교정 전 152명이 그렇게 나왔다).
  //    목록에서는 숨기지 않는다(실제로 퇴원한 게 맞고 날짜만 모른다) — [system-bulk.ts](@/features/withdrawals/system-bulk) 참조.
  const systemBulkCount = trendRows.filter((r) => r.systemBulk).length;
  const trend = monthlyWithdrawals(trendRows.filter((r) => !r.systemBulk));
  const subjects = subjectBreakdown(subjectRows, subjectMaps.labelOf);
  const subjMax = subjects[0]?.count ?? 1;

  const reasonOptions: { value: Exclude<ReasonKey, "all">; label: string }[] = [
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({ value: k, label })),
    { value: "unspecified", label: "미기재" },
  ];

  const current: WdHrefParams = { range, reason, q, subject, consult };
  const filterActive = range !== "all" || reason !== "all" || subject !== "all" || consult !== "all" || !!q;

  // 사유 분석·통계는 전체 필터 결과(rows) 기준 — 목록만 50행으로 슬라이스(billing 메모리 페이지네이션).
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const base = buildWdHref(current);
    if (p <= 1) return base;
    return base === "/withdrawals" ? `/withdrawals?page=${p}` : `${base}&page=${p}`;
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* Editorial 문법 ① — eyebrow→헤드라인 위계 신설(상세 [studentId]의 헤더 패턴 역수출) */}
      {/* description = 창 컴팩트 라벨 겸용 — 없으면 title 폴백이 창 타이틀바 '퇴원관리'와 순수 중복(적대 리뷰).
          설명 문장("…관리합니다")이 아니라 값(§4·§12) — 필터와 무관한 전체 수. 창에선 이 줄이 유일한 화면 안 제목이라
          수강종료 갈래에선 그 목록의 수를 적는다(리뷰: 수강종료 목록 위에 '퇴원 N명'이 서 있었다). */}
      <PageHeader
        eyebrow="학생 케어"
        title="퇴원관리"
        description={viewType === "subject-ended" ? `수강종료 ${subjectEnded.length}명` : `전체 퇴원 ${all.length}명`}
      />

      {viewType === "subject-ended" ? (
        <>
          {/* 수강종료 갈래도 같은 툴바 자리 — 유형 라벨 하나로 퇴원 목록으로 되돌아간다. */}
          <div className="flex flex-wrap items-center gap-2 px-1">
            <TypeSelect viewType={viewType} />
          </div>
          <SubjectEndedView rows={subjectEnded} labelOf={subjectMaps.labelOf} />
        </>
      ) : (
        <>
      {/* Stat strip — Editorial 문법 ②(공용 BigStat, 구 로컬 Stat 대체) */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <BigStat label="전체 퇴원" value={all.length} unit="명" tone="rose" icon={<UserMinus size={16} strokeWidth={1.8} />} />
        <BigStat label="최근 30일" value={recent} unit="명" tone="danger" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat
          label="상담 미완료"
          value={consultPending}
          unit="명"
          sub={`사후상담 완료율 ${consultRate}%`}
          tone="amber"
          icon={<ListChecks size={16} strokeWidth={1.8} />}
        />
        <BigStat label="필터 결과" value={rows.length} unit="명" tone="blue" icon={<Filter size={16} strokeWidth={1.8} />} />
      </section>

      {/* 툴바 — 지시서 §10: 축마다 라벨 하나(`유형: 퇴원` · `기간: 최근 30일` · 사유 · 과목 · 상담), 검색은 눌러야 나온다.
          옛 칩 묶음 넷(유형 2 · 기간 4 · 과목 N · 상담 3) + `micro` 소라벨 + 상시 검색창 두 줄을 한 줄로 걷었다.
          최소 창(1040)에서 드롭다운 다섯 + 검색 + 초기화가 한 줄에 선다(검색을 펼쳐도 ~900px). 상담 칩의 앰버 톤은
          드롭다운으로 오며 사라진다(의미색이 아니라 강조였다 — 값은 트리거 글자가 말한다). */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <TypeSelect viewType={viewType} />
        <FilterSelect
          paramName="range"
          value={range === "all" ? "" : range}
          options={RANGE_OPTIONS}
          axisLabel="기간"
          ariaLabel="기간 필터"
          {...SELECT_PROPS}
        />
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
        <FilterSelect
          paramName="consult"
          value={consult === "all" ? "" : consult}
          options={CONSULT_OPTIONS}
          axisLabel="상담"
          ariaLabel="상담 필터"
          {...SELECT_PROPS}
        />
        {/* 검색 토글은 퇴원 갈래에만 선다(수강종료 목록엔 검색이 없다) — 유형 전환이 검색어를 지우니(TypeSelect) 여기서 type을 되돌릴 일은 없다. */}
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
              <h2 className="text-foreground text-base font-bold">월별 퇴원 추이</h2>
              <span className="text-text-faint text-xs">
                {/* 무엇을 센 건지 말해 준다 — 필터가 걸렸는데 "전체"라고 적으면 화면이 거짓말을 한다. */}
                최근 12개월 · {trendRows.length}명
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
                {subjectRows.length}명
                {subject !== "all" ? " (과목 필터는 이 축이라 제외)" : ""}
              </span>
            </header>
            <div className="space-y-3">
              {subjects.map((s) => (
                <div key={s.label}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-foreground text-xs font-bold">{s.label}</span>
                    <span className="text-text-dim num text-xs">
                      <span className="text-foreground font-bold">{s.count}</span>명
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
          title="퇴원 학생이 없습니다"
          description="퇴원 처리된 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* 최근 퇴원 리스트 */}
          <section className="bg-card shadow-card overflow-hidden rounded-2xl">
            <header className="border-line flex items-baseline justify-between border-b px-5 py-4">
              <div>
                <p className="micro">최근 퇴원</p>
                <h2 className="text-foreground mt-1 text-base font-bold">학생 명단</h2>
              </div>
              <p className="text-text-faint num text-xs">
                {total}명{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
              </p>
            </header>
            {/* 행 = 이름(학교학년) | 마지막 반 | 퇴원일 | 경과 — 한 줄(§11), 행 전체가 링크. 옛 두 줄 행(이름 / 반)을 접었다.
                학교·학년은 앱 규약 `schoolGradeLabel`("경명여중1") — 공백 join 금지. 오른쪽 둘은 폭 고정 열이라 행마다 같은 자리. */}
            <ul className="divide-line divide-y">
              {pageRows.map((r) => {
                const ago = relativeDayKo(r.withdrawnAt);
                const where = schoolGradeLabel(r.school, r.grade);
                return (
                  <li key={r.id} className="hover:bg-bg-soft/50 transition">
                    <WindowLink
                      href={`/withdrawals/${r.id}`}
                      title={r.name}
                      className="grid h-11 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_6.5rem_5rem] items-center gap-3 px-5"
                    >
                      <p className="text-foreground min-w-0 truncate text-base leading-none font-bold">
                        {r.name}
                        {where ? <span className="text-text-dim ml-1.5 text-sm font-semibold">{where}</span> : null}
                      </p>
                      <p className="text-text-dim min-w-0 truncate text-sm">{r.lastClassName ?? "수강 반 없음"}</p>
                      {/* 시스템 일괄 정리분 = 퇴원일이 실제 시점이 아니라 장부 날짜라 경과일을 표시하지 않는다
                          (그대로 두면 "20일 전 퇴원"처럼 틀린 사실을 읽게 된다). */}
                      {r.systemBulk ? (
                        <>
                          <span className="justify-self-end">
                            <Pill color="neutral">시스템 정리</Pill>
                          </span>
                          <span className="text-text-faint justify-self-end text-sm whitespace-nowrap">퇴원일 미상</span>
                        </>
                      ) : (
                        <>
                          <span className="text-foreground num justify-self-end text-sm font-bold whitespace-nowrap">
                            {r.withdrawnAt ?? "—"}
                          </span>
                          <span className="text-text-faint num justify-self-end text-sm whitespace-nowrap">{ago}</span>
                        </>
                      )}
                    </WindowLink>
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 ? (
              <div className="border-line border-t px-5 py-3">
                <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
              </div>
            ) : null}
          </section>

          {/* 사유 분석 */}
          <section className="bg-card shadow-card overflow-hidden rounded-2xl">
            <header className="border-line border-b px-5 py-4">
              <p className="micro text-amber">사유 분석</p>
              <h2 className="text-foreground mt-1 text-base font-bold">상위 퇴원 사유</h2>
            </header>
            <div className="space-y-3 p-5">
              {topReasons.map(([reason, count]) => {
                const pct = (count / maxCount) * 100;
                return (
                  <div key={reason}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-foreground text-xs font-bold">{reason}</span>
                      <span className="text-text-dim num text-xs">
                        <span className="text-foreground font-bold">{count}</span>명 ·{" "}
                        {((count / rows.length) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                      <span
                        className="bg-rose block h-full"
                        style={{ width: `${pct}%` }}
                      />
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
                  {/* 구 font-mono uppercase 코딩틱 라벨 → 한글 12px semibold 승격 */}
                  <p className="text-amber text-xs font-bold">자동 요약</p>
                  <p className="text-foreground mt-0.5 text-xs leading-relaxed">
                    {topReasons[0]
                      ? `현재 가장 빈번한 퇴원 사유는 "${topReasons[0][0]}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                      : "퇴원 사유가 등록되면 인사이트가 표시됩니다."}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function SubjectEndedView({
  rows,
  labelOf,
}: {
  rows: SubjectEndedRow[];
  labelOf: (key: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        image="withdrawals"
        icon={() => <UserX size={32} strokeWidth={1.8} />}
        title="수강종료 학생이 없습니다"
        description="재원 중이지만 특정 과목을 모두 끊은 학생이 생기면 여기에 표시됩니다."
      />
    );
  }
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl">
      <header className="border-line flex items-baseline justify-between border-b px-5 py-4">
        <div>
          <p className="micro text-amber">과목 이탈 신호</p>
          <h2 className="text-foreground mt-1 text-base font-bold">수강종료 학생</h2>
        </div>
        <p className="text-text-faint num text-xs">{rows.length}명</p>
      </header>
      {/* 행 = 이름(학교학년) | 종료·수강중 과목 알약 | 종료일 — 한 줄(§11). 알약이 많으면 그 행만 감긴다(min-h). */}
      <ul className="divide-line divide-y">
        {rows.map((r) => {
          const where = schoolGradeLabel(r.school, r.grade);
          return (
            <li key={r.id} className="hover:bg-bg-soft/50 transition">
              <WindowLink
                href={`/students/${r.id}`}
                title={r.name}
                className="grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_7rem] items-center gap-3 px-5 py-1"
              >
                <p className="text-foreground min-w-0 truncate text-base leading-none font-bold">
                  {r.name}
                  {where ? <span className="text-text-dim ml-1.5 text-sm font-semibold">{where}</span> : null}
                  {r.status === "on_hold" ? <span className="text-text-faint ml-1 text-sm font-normal">(휴원)</span> : null}
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <span className="text-text-faint mr-0.5 text-sm">종료</span>
                  {r.endedSubjects.map((s) => (
                    <Pill key={s} color="amber">
                      {labelOf(s)}
                    </Pill>
                  ))}
                  {r.activeSubjects.length > 0 ? (
                    <>
                      <span className="text-text-faint ml-1.5 mr-0.5 text-sm">수강중</span>
                      {r.activeSubjects.map((s) => (
                        <Pill key={s} color="primary" soft>
                          {labelOf(s)}
                        </Pill>
                      ))}
                    </>
                  ) : null}
                </div>
                <span className="text-text-faint num justify-self-end text-sm whitespace-nowrap">
                  {r.lastEndedAt ? `${r.lastEndedAt} 종료` : null}
                </span>
              </WindowLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
