"use client";
import { useMemo, useState, useTransition } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
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
import { fieldClass, numberText } from "./presentation";
import { PendingBadge } from "./pending-badge";
import { matchesStudentFilters } from "../model/student-filters";
import { DEFAULT_LIST_STATE, contributionStudentHref } from "../model/list-state";
import { useContributionListState } from "./use-contribution-list-state";
import { StudentFilterFields } from "./student-filter-fields";
type Data = NonNullable<Awaited<ReturnType<typeof getContributionList>>>;
export const pointsText = numberText;
export function ContributionList({ data }: { data: Data }) {
  const [filters, update] = useContributionListState();
  const { page, pageSize } = filters;
  const [message, setMessage] = useState(""), [busy, start] = useTransition();
  const router = useRouter();
  const filter = (patch: Partial<typeof filters>) => update({ ...patch, page: 1 });
  const rows = useMemo(() => data.rows.filter((r) => matchesStudentFilters(r, filters))
    .map((r) => ({ ...r, score: r.total ? scoreRaws(r.total.raws, data.config) : null, recent: r.total ? scoreRaws(r.total.recent, data.config).total : null }))
    .sort((a, b) => (filters.sort === "recent" ? (b.recent ?? -Infinity) - (a.recent ?? -Infinity) : (b.score?.total ?? -Infinity) - (a.score?.total ?? -Infinity)) || a.name.localeCompare(b.name)), [data, filters]);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  const raws = sumRaws(rows.flatMap((r) => r.total ? [r.total.raws] : []));
  const totals = rows.reduce((out, r) => ({ operations: out.operations + (r.score?.operations ?? 0), participation: out.participation + (r.score?.participation ?? 0) }), { operations: 0, participation: 0 });
  const reset = () => update({ ...DEFAULT_LIST_STATE, pageSize });
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader title="원생 기여도" description="학생의 운영 기여와 학습·참여 기록을 모아 봅니다. 학생을 선택하면 점수의 계산 근거를 확인할 수 있습니다."
      active="students" canConfigure={data.gate.canConfigure} actions={data.gate.canWrite && <Button disabled={busy || !data.ready} onClick={() => start(async () => {
        const result = await refreshContribution(); setMessage(result.error ?? result.message ?? ""); router.refresh();
      })}><EyIcon name="sync" size={16} />{busy ? "집계 중…" : "지금 집계"}</Button>} />
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line px-5 py-4 phone:gap-2 phone:px-4 phone:py-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm phone:grid phone:w-full phone:grid-cols-2 phone:gap-x-3 phone:gap-y-1"><p className="phone:col-span-2">조회 학생 <strong className="ml-2 text-lg tabular-nums">{rows.length}명</strong></p>
        <p>운영 기여 <strong className="ml-2 tabular-nums">{numberText(totals.operations)}점</strong></p><p>학습·참여 <strong className="ml-2 tabular-nums">{numberText(totals.participation)}점</strong></p></div>
      <p className="text-xs">최근 집계 {data.refreshedAt ? new Date(data.refreshedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "집계 전"}</p>
    </div>
    {(!data.ready || !data.historyReady) && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{!data.ready ? "기여도 기록 저장이 아직 준비되지 않았습니다." : "첫 집계를 준비 중입니다. 완료 전에는 일부 기록만 표시될 수 있습니다."}</p>}
    {message && <p role="status" className="rounded-lg border border-line p-3 text-sm">{message}</p>}
    <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_22rem]">
    <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-card" aria-label="원생 기여도 목록">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <StudentFilterFields filters={filters} options={data} onChange={filter} onReset={reset}>
        <select aria-label="정렬" value={filters.sort} onChange={(e) => filter({ sort: e.target.value === "recent" ? "recent" : "total" })} className={fieldClass}><option value="total">누적 기여도 순</option><option value="recent">최근 12개월 증가분 순</option></select>
        </StudentFilterFields>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-180 table-fixed text-left text-sm phone:min-w-0"><colgroup><col className="w-[20%] phone:w-[60%]" /><col className="w-[20%] phone:hidden" /><col className="w-[16%] phone:w-[40%]" /><col className="w-[15%] phone:hidden" /><col className="w-[14%] phone:hidden" /><col className="w-[15%] phone:hidden" /></colgroup><thead className="bg-secondary"><tr>
        {["학생", "학교·학년", "누적 기여도", "운영 기여", "학습·참여", "최근 12개월"].map((label, index) => <th scope="col" key={label} className={`whitespace-nowrap px-5 py-3 font-medium ${index > 1 ? "text-right" : ""} ${index === 1 || index > 2 ? "phone:hidden" : ""}`}>{label}</th>)}
      </tr></thead><tbody>{shown.map((r) => <tr key={r.id} className="border-b border-line-faint transition-colors last:border-0 hover:bg-primary-softer">
        <td className="px-5 py-3"><div className="flex flex-wrap items-center gap-2"><Link className="font-semibold text-primary underline-offset-4 hover:underline" href={contributionStudentHref(r.id, { ...filters, page: current })}>{r.name}</Link>
          {!!r.total?.unavailable.length && <PendingBadge key={`${r.id}:${r.total.computedAt}`} studentId={r.id} name={r.name} metrics={r.total.unavailable} />}<span className="whitespace-nowrap text-xs" title="최근 집계 기준, 유효한 수업료 청구가 있는 달 수입니다. 같은 달의 여러 과목은 한 달로 셉니다.">{r.enrolledMonths === null ? "기간 집계 전" : `재원 ${numberText(r.enrolledMonths)}개월`}</span></div><p className="mt-1 hidden text-xs phone:block">{schoolGradeLabel(r.school, r.grade) || "—"}</p></td><td className="px-5 py-3 phone:hidden">{schoolGradeLabel(r.school, r.grade) || "—"}</td>
        <td className="px-5 py-3 text-right font-bold text-primary tabular-nums">{r.score ? numberText(r.score.total) : "집계 전"}<span className="mt-1 hidden text-xs font-normal phone:block">최근 12개월 {r.recent === null ? "—" : `${r.recent > 0 ? "+" : ""}${numberText(r.recent)}`}</span></td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden">{r.score ? numberText(r.score.operations) : "—"}</td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden">{r.score ? numberText(r.score.participation) : "—"}</td>
        <td className="px-5 py-3 text-right tabular-nums phone:hidden">{r.recent === null ? "—" : `${r.recent > 0 ? "+" : ""}${numberText(r.recent)}`}</td>
      </tr>)}</tbody></table>
        {!rows.length && <div className="space-y-3 py-20 text-center"><p>조건에 맞는 학생이 없습니다.</p><Button variant="outline" size="sm" onClick={reset}>검색 조건 초기화</Button></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between border-t border-line px-4 py-2 text-xs"><span>점수 단위: 점 · 현재 배점 기준</span><label className="flex items-center gap-2">한 페이지<select aria-label="학생 목록 표시 수" value={pageSize} onChange={(e) => update({ pageSize: Number(e.target.value), page: 1 })} className="rounded border border-line bg-card px-2 py-1">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}명</option>)}</select></label></div>
      <ListPager page={current} total={rows.length} pageSize={pageSize} onChange={(next) => update({ page: next })} label="학생 목록" unit="명" />
    </section>
    <aside className="space-y-4"><div className="flex items-center justify-between text-sm"><h2 className="font-semibold">조회한 학생의 점수 구성</h2><span>{rows.length}명</span></div><ScoreBreakdown raws={raws} config={data.config} /><p className="px-1 text-xs leading-relaxed">검색과 필터에 해당하는 학생 전체의 누적 실적입니다. 페이지를 넘겨도 구성은 같습니다.</p></aside>
    </div>
    <details className="rounded-xl border border-line p-4 text-xs leading-relaxed"><summary className="cursor-pointer text-sm font-medium">점수와 자료 범위 안내</summary><div className="mt-3 space-y-2">
      <p>모든 점수는 현재 배점으로 계산하며 만점과 상한이 없습니다. 최근 12개월 증가분에는 정정도 포함됩니다.</p>
      <p>수업료·수강 기간: 메이크에듀 2020년부터, 에이와 2026년부터. EiE는 2025년 5월부터입니다. 재원 기간은 유효한 수업료 청구가 있는 달 수로 계산합니다.</p>
      <p>재원 개월이 집계 전인 학생은 다음 기여도 집계에서 표시됩니다. 실제 입원일부터 지난 달 수와는 다를 수 있습니다.</p>
      <p>출결은 2026년부터, 영상 숙제는 기능 도입 후 실제 제출 기록을 확인합니다. 학부모 글은 수집한 기록, 선생님 답글은 2026년 9월 30일 이후 에이와 발송분을 사용합니다.</p>
      <p>소개자가 연결되지 않은 상담은 점수에 포함되지 않습니다. 과목 필터는 수강 이력이 있는 학생을 찾습니다.</p>
    </div></details>
  </div>;
}
