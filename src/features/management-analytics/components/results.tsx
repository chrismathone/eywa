import { BigStat } from "@/components/atoms/big-stat";
import { DATASETS, DATASET_LABELS, FIELDS, type AnalysisResult, type AnalysisReport } from "../contract";

const number = (n: number) => n.toLocaleString("ko-KR");
const rate = (n: number | null) => n === null ? "계산 불가" : `${n.toFixed(1)}%`;

export function ValidationResults({ result }: { result: Extract<AnalysisResult, { ok: false }> }) {
  return <section role="alert" className="bg-danger-soft space-y-2 rounded-2xl p-4">
    <p className="font-bold">{result.error}</p>
    {result.issueCount ? <p className="text-sm">오류 {number(result.issueCount)}건 · 최대 50건 표시 · 행 번호는 빈 줄을 제외한 CSV 레코드 순서입니다.</p> : null}
    <ul className="list-inside list-disc space-y-1 text-sm">
      {result.issues?.map((issue, i) => <li key={i}>
        {DATASET_LABELS[issue.dataset]} {issue.row ? `${issue.row}행` : "전체"} · {((FIELDS[issue.dataset] as Record<string, string>)[issue.field] ?? "자료 확인")} — {issue.message}
      </li>)}
    </ul>
  </section>;
}

export function AnalyticsResults({ report, sample }: { report: AnalysisReport; sample: boolean }) {
  const k = report.kpis;
  return <section aria-label="경영분석 결과" className="space-y-4">
    <div className="space-y-1">
      <h2 className="text-lg font-bold">{sample ? "가상 샘플 분석" : "업로드 자료 분석"} · {report.period.from} ~ {report.period.to}</h2>
      <p className="text-sm">데이터 기준일 {report.asOf} · 업로드한 자료만 집계한 결과입니다.</p>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <BigStat label="재원생" value={number(k.active)} unit="명" sub="조회 종료일 기준" />
      <BigStat label="신규생" value={number(k.newcomers)} unit="명" sub="기간 내 최초 입원 · 재입원 제외" />
      <BigStat label="퇴원" value={number(k.withdrawals)} unit="명" sub="기간 내 퇴원한 고유 학생 수" />
      <BigStat label="순수납" value={number(k.netReceipts)} unit="원" sub={`수납 ${number(k.receipts)} − 환불 ${number(k.refunds)}`} />
      <BigStat label="상담전환율" value={rate(k.conversionRate)} sub={`첫 상담 ${number(k.prospects)}명 중 종료일까지 입원 ${number(k.converted)}명`} />
    </div>
    <div className="bg-card shadow-card space-y-2 rounded-2xl p-4">
      <h3 className="font-bold">집계 요약</h3>
      <p className="text-sm">종료일 재원생은 {number(k.active)}명이며, 기간 중 신규생 {number(k.newcomers)}명과 퇴원생 {number(k.withdrawals)}명이 확인되었습니다. 순수납은 {number(k.netReceipts)}원입니다.</p>
      <p className="text-xs">확인된 수치만 정리한 요약입니다. 외부 AI에 데이터를 전송하지 않습니다.</p>
    </div>
    <div className="overflow-x-auto rounded-2xl bg-card p-4 shadow-card">
      <table className="w-full whitespace-nowrap text-right text-sm">
        <caption className="pb-3 text-left font-bold">월별 추이 · 첫 달과 마지막 달은 선택한 기간만 집계</caption>
        <thead><tr>{["월", "재원", "신규", "퇴원", "순수납 (원)", "상담전환"].map((s) => <th key={s} scope="col" className="p-2">{s}</th>)}</tr></thead>
        <tbody>{report.months.map((m) => <tr key={m.month} className="border-line-faint border-t">
          <th scope="row" className="p-2">{m.month}</th><td className="num p-2">{number(m.active)}</td><td className="num p-2">{number(m.newcomers)}</td>
          <td className="num p-2">{number(m.withdrawals)}</td><td className="num p-2">{number(m.netReceipts)}</td><td className="num p-2">{rate(m.conversionRate)} ({m.converted}/{m.prospects})</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-2 text-xs">각 월의 전환율은 그 달 첫 상담자 중 해당 월의 조회 종료일까지 입원한 비율입니다. 월별 비율을 합산하지 않습니다.</p>
    </div>
    <div className="bg-card shadow-card space-y-2 rounded-2xl p-4">
      <h3 className="font-bold">데이터 검증</h3>
      {DATASETS.map((d) => <p key={d} className="text-sm">{DATASET_LABELS[d]}: 입력 {number(report.quality[d].rows)}행 · 반영 {number(report.quality[d].accepted)}행 · 동일 중복 제외 {number(report.quality[d].duplicates)}행</p>)}
      <p className="text-xs">전체 기간 이력과 지점 일치 여부는 업로드한 관리자의 확인에 의존합니다. 정상 형식의 누락 행은 자동 탐지할 수 없습니다.</p>
    </div>
  </section>;
}
