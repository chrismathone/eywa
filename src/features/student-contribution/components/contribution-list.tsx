"use client";
import { useMemo, useState, useTransition } from "react";
import { ContributionLink as Link } from "./student-contribution-scope";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { scoreRaws, sumRaws } from "../model/calc";
import type { getContributionList } from "../server/queries";
import { refreshContribution } from "../server/actions";
import { ContributionHeader } from "./contribution-shell";
import { ListPager } from "./list-pager";
import { ScoreBreakdown } from "./score-breakdown";
import { fieldClass, numberText, signedText } from "./presentation";
import { PendingBadge } from "./pending-badge";
import { matchesStudentFilters } from "../model/student-filters";
import { DEFAULT_LIST_STATE, contributionStudentHref } from "../model/list-state";
import { useContributionListState } from "./use-contribution-list-state";
import { StudentFilterFields } from "./student-filter-fields";
import { CHANGE_PERIODS, changePeriod, changePeriodLabel, compareListScores } from "../model/list-controls";
import { useRecentContribution } from "./use-recent-contribution";
import { RecentChange, changeColor } from "./recent-change";
import { AggregationStatus } from "./aggregation-status";
import { relativeRows, relativeScore } from "../model/relative-score";
import { FamilyLoyaltyOverview } from "./family-loyalty-card";
import { familyBonus, loyaltyTotal } from "../model/family-loyalty";
import { RelativeScoreBadge } from "./relative-score";
type Data = NonNullable<Awaited<ReturnType<typeof getContributionList>>>;
export const pointsText = numberText;
export function ContributionList({ data }: { data: Data }) {
  const [filters, update] = useContributionListState();
  const { page, pageSize } = filters;
  const [message, setMessage] = useState(""), [busy, start] = useTransition();
  // 학생 순위표는 눌러서 연다 — 원장 2026-10-29 *"원생 정보도 … 전체(요약)가 먼저 뜨고, 필요해서 누르고 들어가면 개별 리스트"*.
  // 주소에 거르기·쪽이 실려 있으면(학생 상세에서 돌아옴 · 화면이 떠 있는 채 주소만 바뀜 포함) 펼친 채로 — 숫자만 줄고 거르기 칸이 숨는 일이 없게(리뷰).
  const [opened, setListOpen] = useState(false);
  const [familyOnly, setFamilyOnly] = useState(false);
  const listOpen = opened || familyOnly || (Object.keys(DEFAULT_LIST_STATE) as (keyof typeof DEFAULT_LIST_STATE)[])
    .some((key) => key !== "pageSize" && JSON.stringify(filters[key]) !== JSON.stringify(DEFAULT_LIST_STATE[key]));
  const router = useRouter();
  // 검색·쪽·정렬을 바꿔도 전체 재원생 기준 등급은 바뀌지 않는다.
  const cohort = useMemo(() => relativeRows(data.rows, data.config), [data.rows, data.config]);
  const recent = useRecentContribution(data, filters.period), periodLabel = changePeriodLabel(filters.period);
  const filter = (patch: Partial<typeof filters>) => update({ ...patch, page: 1 });
  const rows = useMemo(() => data.rows.filter((r) => matchesStudentFilters(r, filters) && (!familyOnly || (r.family.selfActive && (r.family.activeCount ?? 0) >= 2)))
    .map((r) => ({ ...r, loyalty: loyaltyTotal(r.total ? scoreRaws(r.total.raws, data.config).total : null, r.family, data.config), score: r.total ? scoreRaws(r.total.raws, data.config) : null,
      recent: recent.byStudent.has(r.id) ? scoreRaws(recent.byStudent.get(r.id)!, data.config).total : null }))
    .sort((a, b) => compareListScores({ ...a, value: filters.sort === "recent" ? a.recent : a.loyalty },
      { ...b, value: filters.sort === "recent" ? b.recent : b.loyalty }, filters.direction)), [data, filters, recent.byStudent, familyOnly]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  const rankings = new Map(shown.map(r => [r.id, relativeScore(cohort, r.id)]));
  const raws = sumRaws(rows.flatMap((r) => r.total ? [r.total.raws] : []));
  const totals = rows.reduce((out, r) => ({ operations: out.operations + (r.score?.operations ?? 0), participation: out.participation + (r.score?.participation ?? 0), recent: out.recent + (r.recent ?? 0) }), { operations: 0, participation: 0, recent: 0 });
  const largestRecent = Math.max(1e-9, ...rows.map((r) => Math.abs(r.recent ?? 0)));
  const reset = () => { setFamilyOnly(false); update({ ...DEFAULT_LIST_STATE, pageSize }); };
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader title="원생 로열티" description="함께 재원하는 가족을 우선 평가합니다. 기존 활동 누적에 현재 가족 가점을 더해 1~5등급과 상위 %로 비교합니다."
      active="students" canConfigure={data.gate.canConfigure} actions={data.gate.canWrite && <Button disabled={busy || !data.ready} onClick={() => start(async () => {
        const result = await refreshContribution(); setMessage(result.error ?? result.message ?? ""); router.refresh();
      })}><EyIcon name="sync" size={16} />{busy ? "집계 중…" : "지금 집계"}</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line px-5 py-4 phone:gap-2 phone:px-4 phone:py-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm phone:grid phone:w-full phone:gap-y-1 phone:[&>p]:flex phone:[&>p]:items-baseline phone:[&>p]:justify-between"><p>조회 학생 <strong className="ml-2 text-lg tabular-nums">{rows.length}명</strong></p>
        <p>운영 기여 <strong className="ml-2 tabular-nums">{numberText(totals.operations)}점</strong></p><p>학습·참여 <strong className="ml-2 tabular-nums">{numberText(totals.participation)}점</strong></p>
        <p>{periodLabel} 증감 <strong className={`ml-2 tabular-nums ${changeColor(totals.recent)}`}>{recent.loading || recent.error ? "—" : `${signedText(totals.recent)}점`}</strong></p></div>
      <AggregationStatus cron={data.refreshCron} checkedAt={data.checkedAt} refreshedAt={data.refreshedAt} missing={rows.filter((r) => r.enrolledMonths === null).length} busy={busy} />
    </div>
    {(!data.ready || !data.historyReady) && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{!data.ready ? "로열티 기록 저장이 아직 준비되지 않았습니다." : "첫 집계를 준비 중입니다. 완료 전에는 일부 기록만 표시될 수 있습니다."}</p>}
    {message && <p role="status" className="rounded-lg border border-line p-3 text-sm">{message}</p>}
    <FamilyLoyaltyOverview rows={rows} config={data.config} />
    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={familyOnly} onChange={e=>{setFamilyOnly(e.target.checked);update({page:1});}} />형제자매 함께 재원하는 학생만 보기</label>
    <div className="grid grid-cols-1 items-stretch gap-5 2xl:grid-cols-[minmax(0,1fr)_22rem]">
    {listOpen ? <section className="@container flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card" aria-label="원생 로열티 목록">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <StudentFilterFields filters={filters} options={data} onChange={filter} onReset={reset}>
        <select aria-label="정렬" value={filters.sort} onChange={(e) => filter({ sort: e.target.value === "recent" ? "recent" : "total" })} className={fieldClass}><option value="total">로열티 점수</option><option value="recent">기간별 증감</option></select>
        <select aria-label="정렬 방향" value={filters.direction} onChange={(e) => filter({ direction: e.target.value === "asc" ? "asc" : "desc" })} className={fieldClass}><option value="desc">높은 순 ↓</option><option value="asc">낮은 순 ↑</option></select>
        </StudentFilterFields>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-xs">
        <span>등급·순위: 전체 재원생의 로열티(가족 가점 포함) 기준 · 검색해도 비교 대상 유지</span>
        <label className="flex items-center gap-2">변화 조회 기간<select aria-label="변화 조회 기간" value={filters.period} onChange={(e) => filter({ period: changePeriod(e.target.value) })} className={fieldClass}>
          {CHANGE_PERIODS.map((period) => <option key={period} value={period}>{changePeriodLabel(period)}</option>)}</select></label>
      </div>
      {(recent.loading || recent.error) && <div role="status" className="flex items-center justify-between gap-2 border-b border-line bg-secondary px-4 py-2 text-sm">
        <span>{recent.loading ? `${periodLabel} 변화를 불러오는 중입니다.` : recent.error}</span>{recent.error && <Button size="sm" variant="outline" onClick={recent.refreshRequired ? () => router.refresh() : recent.retry}>{recent.refreshRequired ? "새로고침" : "다시 시도"}</Button>}</div>}
      <div className="overflow-x-auto"><table className="w-full min-w-180 table-fixed text-left text-sm phone:min-w-0"><colgroup><col className="w-[20%] phone:w-[60%]" /><col className="w-[20%] phone:hidden" /><col className="w-[16%] phone:w-[40%]" /><col className="w-[15%] phone:hidden" /><col className="w-[14%] phone:hidden" /><col className="w-[15%] phone:hidden" /></colgroup><thead className="bg-secondary"><tr>
        {["학생", "학교·학년", "로열티 점수", "운영 기여", "학습·참여", periodLabel].map((label, index) => <th scope="col" key={index} aria-sort={index === (filters.sort === "total" ? 2 : 5) ? filters.direction === "asc" ? "ascending" : "descending" : undefined} className={`whitespace-nowrap px-5 py-3 font-medium ${index > 1 ? "text-right" : ""} ${index === 1 || index > 2 ? "phone:hidden" : ""}`}>
          {index === 2 || index === 5 ? <button type="button" className="rounded focus-visible:outline-primary" onClick={() => filter({ sort: index === 2 ? "total" : "recent", direction: filters.sort === (index === 2 ? "total" : "recent") && filters.direction === "desc" ? "asc" : "desc" })}>
            {label}{index === (filters.sort === "total" ? 2 : 5) ? filters.direction === "asc" ? " ↑" : " ↓" : " ↕"}</button> : label}</th>)}
      </tr></thead><tbody>{filters.sort === "recent" && (recent.loading || recent.error) ? <tr><td colSpan={6} className="h-72 px-5 text-center text-text-dim">{recent.loading ? "기간별 증감 순으로 정렬하고 있습니다…" : "기간별 증감을 조회한 뒤 목록을 표시합니다."}</td></tr> : shown.map((r) => <tr key={r.id} className="border-b border-line-faint transition-colors last:border-0 hover:bg-primary-softer">
        <td className="px-5 py-3"><div className="flex flex-wrap items-center gap-2"><Link className="font-semibold text-primary underline-offset-4 hover:underline" href={contributionStudentHref(r.id, { ...filters, page: current })}>{r.name}</Link>
          {!!r.total?.unavailable.length && <PendingBadge key={`${r.id}:${r.total.computedAt}`} studentId={r.id} name={r.name} metrics={r.total.unavailable} />}<span className="whitespace-nowrap text-xs" title={r.enrolledMonths === null ? "로열티와 함께 집계됩니다. 위 집계 일정에서 남은 시간을 확인하세요." : "최근 집계 기준, 유효한 수업료 청구가 있는 달 수입니다. 같은 달의 여러 과목은 한 달로 셉니다."}>{r.enrolledMonths === null ? "재원기간 —" : `재원 ${numberText(r.enrolledMonths)}개월`}</span></div><p className="mt-1 hidden text-xs phone:block">{schoolGradeLabel(r.school, r.grade) || "—"}</p></td><td className="px-5 py-3 phone:hidden">{schoolGradeLabel(r.school, r.grade) || "—"}</td>
        <td className="px-5 py-3 text-right font-bold text-primary tabular-nums">{r.loyalty === null ? "확인 대기" : numberText(r.loyalty)}{r.family.selfActive && (r.family.activeCount ?? 0) >= 2 && <span className="mt-1 block text-xs font-semibold text-att-late-ink">{r.family.activeCount}남매 · 가족 +{numberText(familyBonus(r.family,data.config) ?? 0)}점</span>}{data.ready && data.historyReady && r.loyalty !== null && rankings.get(r.id) && <RelativeScoreBadge result={rankings.get(r.id)!} />}<span className={`mt-1 hidden text-xs font-normal phone:block ${r.recent === null ? "text-text-dim" : changeColor(r.recent)}`}>{periodLabel} {r.recent === null ? "—" : signedText(r.recent)}</span></td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden">{r.score ? numberText(r.score.operations) : "—"}</td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden">{r.score ? numberText(r.score.participation) : "—"}</td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden"><RecentChange value={r.recent} largest={largestRecent} /></td>
      </tr>)}</tbody></table>
        {!rows.length && <div className="space-y-3 py-20 text-center"><p>조건에 맞는 학생이 없습니다.</p><Button variant="outline" size="sm" onClick={reset}>검색 조건 초기화</Button></div>}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between border-t border-line px-4 py-2 text-xs"><span>점수 단위: 점 · 현재 배점 기준</span><label className="flex items-center gap-2">한 페이지<select aria-label="학생 목록 표시 수" value={pageSize} onChange={(e) => update({ pageSize: Number(e.target.value), page: 1 })} className="rounded border border-line bg-card px-2 py-1">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}명</option>)}</select></label></div>
      <ListPager page={current} total={rows.length} pageSize={pageSize} onChange={(next) => update({ page: next })} label="학생 목록" unit="명" />
    </section> : <section className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-line bg-card p-10 text-center" aria-label="원생 로열티 목록">
      <p className="text-sm">학생별 점수 순위는 눌러서 봅니다.</p>
      <Button variant="outline" onClick={() => setListOpen(true)}>학생 목록 보기 ({rows.length}명)</Button>
    </section>}
    <aside className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card"><div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-sm"><h2 className="font-semibold">조회한 학생의 기존 활동 구성</h2><span>{rows.length}명</span></div><ScoreBreakdown raws={raws} config={data.config} contained /><p className="border-t border-line px-5 py-3 text-xs leading-relaxed">가족 가점을 제외한 활동 실적입니다. 가족 가점은 각 학생의 현재 로열티에 별도로 반영합니다. 페이지를 넘겨도 구성은 같습니다.</p></aside>
    </div>
    <details className="rounded-xl border border-line p-4 text-xs leading-relaxed"><summary className="cursor-pointer text-sm font-medium">점수와 자료 범위 안내</summary><div className="mt-3 space-y-2">
      <p>목록의 등급·순위는 전체 재원생의 로열티(가족 가점 포함) 기준입니다. 검색·학년·과목 필터로 목록을 좁혀도 기준은 유지됩니다. 학생을 선택하면 같은 학년·비슷한 재원기간·최근 12개월로 비교할 수 있습니다. 미확인 자료가 있으면 잠정 등급이며, 5명 미만 또는 전원 동점이면 등급을 보류합니다.</p>
      <p>로열티 = 기존 활동 누적 + 현재 가족 가점입니다. 전체 만점은 없으며 1~5등급·상위 %로 상대 위치를 봅니다. 가족 가점은 현재 동시 재원 상태에 한 번만 적용하며, 월별 활동 증감과 최근 12개월 활동 비교에는 포함하지 않습니다. 기간별 증감은 선택한 기간에 반영된 점수의 합계로, 정정과 집계 중인 이번 달도 포함합니다. 이전의 같은 길이 기간과 비교한 증감률은 아닙니다. 환불 등으로 줄면 마이너스로 표시합니다.</p>
      <p>수업료·수강 기간: 메이크에듀 2020년부터, 에이와 2026년부터. EiE는 2025년 5월부터입니다. 재원 기간은 유효한 수업료 청구가 있는 달 수로 계산합니다.</p>
      <p>재원 개월이 집계 전인 학생은 다음 로열티 집계에서 표시됩니다. 실제 입원일부터 지난 달 수와는 다를 수 있습니다.</p>
      <p>출결은 2026년부터, 영상 숙제는 기능 도입 후 실제 제출 기록을 확인합니다. 학부모 글은 수집한 기록, 선생님 답글은 2026년 9월 30일 이후 에이와 발송분을 사용합니다.</p>
      <p>소개자가 연결되지 않은 상담은 점수에 포함되지 않습니다. 과목 필터는 수강 이력이 있는 학생을 찾습니다.</p>
    </div></details>
  </div>;
}
