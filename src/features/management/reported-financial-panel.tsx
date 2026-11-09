import type {reportedFinancialView} from "./reported-financials";
import {laborLabels} from "./reported-financials";
import s from "./workspace.module.css";

const won=(v:number)=>`${v.toLocaleString("ko-KR")}원`;
const percent=(v:number|null)=>v===null?"미마감 · 계산 보류":`${v.toFixed(2)}%`;
export function ReportedFinancialPanel({view}:{view:ReturnType<typeof reportedFinancialView>}){
  if(!view)return null;
  const f=view.financials;
  return <article className={s.panel} id="reported-financials">
    <div className={s.sectionTitle}><h3>{view.month} ECOUNT 보고서 기준 손익</h3><span>{view.closed?"사용자 확인 기준 마감 월":"미마감 월"} · 원장 대사 일치</span></div>
    <p>{f.company} · 마감 확인 {f.closedThrough}까지</p>
    <div className={s.bridge}>
      <div><span>보고서 매출</span><strong>{won(f.revenue)}</strong></div>
      <div><span>보고서 영업비용</span><strong>{won(f.cost)}</strong></div>
      <div><span>보고서 영업손익</span><strong>{won(f.profit)}</strong></div>
      <div><span>보고서 기준 영업이익률</span><strong>{percent(view.margin)}</strong></div>
      <div><span>분류한 인건비</span><strong>{won(view.labor)}</strong></div>
      <div><span>보고서 매출 대비 인건비율</span><strong>{percent(view.laborRatio)}</strong></div>
    </div>
    <p>{f.scopeNote}</p>
    <p>영업외수익 {won(f.nonOperatingIncome)} − 영업외비용 {won(f.nonOperatingCost)} 반영 후 보고서 세전손익: <strong>{won(f.profitBeforeTax)}</strong></p>
    <div className={s.notice}><strong>차량 할부금 조정 확인 중 · 채용 판단용 손익은 미확정</strong><p>차량 구입 원금과 이자가 포함된 {won(f.vehicleInstallments)}이 이번 달 보고서 비용에 기재되어 있습니다. 원금·이자 상환명세와 차량 자산·감가상각 내역을 확인해야 조정 손익을 계산할 수 있습니다. 위 수치는 ECOUNT 기재 기준이며 할부금 전액을 빼서 이익을 늘리지 않았습니다.</p>{!view.closed?<p>이 월은 급여 등 입력이 끝나지 않았습니다. 낮은 비용을 인력 절감이나 수익성 개선으로 해석하지 않습니다.</p>:null}<a href="#reviews">차량 조정 확인 업무 →</a></div>
    <details><summary>인건비 구성과 산출 근거</summary><table><thead><tr><th>항목</th><th>월 금액</th></tr></thead><tbody>{Object.entries(laborLabels).map(([key,label])=><tr key={key}><td>{label}</td><td>{won(f.labor[key as keyof typeof f.labor])}</td></tr>)}<tr><th>합계</th><td>{won(view.labor)}</td></tr></tbody></table><p>인건비율 = 위 계정 순액 합계 ÷ 보고서 매출 × 100. 영업이익률 = 보고서 영업손익 ÷ 보고서 매출 × 100. 임대·관리비를 포함한 전체 매출이 분모이며 수강료만 대비한 비율과 구분합니다.</p><p>{f.reference} · 비용 명세 {f.costAccountCount}개 계정의 1~10월 누적액과 원장 각각 일치. 선택 월 매출·영업비용 대사 차이 0원. 자료 확인 시각 {new Date(f.confirmedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p><p className={s.hash}>비용 명세 SHA-256 {f.costAccountHash}</p></details>
  </article>;
}
