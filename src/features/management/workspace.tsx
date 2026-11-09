"use client";
import { useState } from "react";
import { EmbedHiddenInput, EmbedLink as Link } from "@/components/embed-link";
import v from "@/components/analytics/analytics.module.css";
import { SampleBanner, sampleSave } from "@/features/mockup/sample";
import { accountingTotals, categoryLabels, hiringScenario, type AccountingReport, type ManagementSnapshot } from "./model";
import { ReviewPanel } from "./review-panel";
import { ReportedFinancialPanel } from "./reported-financial-panel";
import { CollectionPanel } from "./collection-panel";
import { ManagementVisualSummary, featuredMetricIds } from "./visual-summary";
import s from "./workspace.module.css";

const number = (n: number | null, digits = 0) => n === null ? "자료 필요" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const won = (n: number | null) => n === null ? "자료 필요" : `${number(n)}원`;

/**
 * 경영 분석 — aywa-next(375d27df4) 화면을 계기판 토큰으로 옮긴 시안. 예시 값만 그린다.
 * 원래 있던 ECOUNT 파일 가져오기(미리보기·저장)·AI 검토·그래프 JSON 내려받기는 요청을 보내지 않는다.
 */
export function ManagementWorkspace({ data, months }: { data: ManagementSnapshot; months: readonly string[] }) {
  const [reportId, setReportId] = useState(data.reports[0]?.id ?? ""), [aiMessage, setAiMessage] = useState("");
  const selected = data.reports.find(r => r.id === reportId) ?? data.reports[0], totals = selected ? accountingTotals(selected.document) : null;
  return <main className={`${s.page} ${v.dashboard}`}>
    <SampleBanner/>
    <header className={`${s.header} ${v.hero}`}><div><Link href="/dashboard" className={s.back}>← 대시보드</Link><p className={s.eyebrow}>에이와 · 경영 분석</p><h1>우리 학원의 오늘, 숫자로 한눈에</h1><p>운영 현황부터 수익 구조까지. 지표를 살펴보고 근거와 다음 할 일을 연결하세요.</p></div>
      <form className={s.month}><EmbedHiddenInput/><label htmlFor="management-month">운영 분석 월</label><select id="management-month" name="month" defaultValue={data.month}>{months.map(m => <option key={m} value={m}>{m}</option>)}</select><button>조회</button></form></header>
    <nav className={v.sourceNav} aria-label="경영 분석 영역"><a href="#operations">운영·매출</a><a href="#collection">자료 수집함</a><a href="#reviews">원본 대사·확인 업무</a><a href="#accounting">회계·채용</a><a href="#people">강사·상담 경로</a><Link href={`/dashboard/management/knowledge?month=${data.month}`}>통합 지식그래프 ↗</Link><a href="#knowledge">AI 검토</a><a href="#sources">데이터 연결</a></nav>
    <section id="operations"><div className={s.sectionTitle}><h2>{data.month} 운영 지표</h2><span>기준일 {data.asOf} · 과거 기록은 현재 저장 상태 기준</span></div>
      <ManagementVisualSummary data={data}/>
      <h3 className={s.subheading}>상세 경영 지표</h3>
      <div className={s.cards}>{data.metrics.filter(m => !featuredMetricIds.includes(m.id)).map(m => <article className={s.card} key={m.id} id={`metric-${m.id}`}><Link href={m.href}>{m.label} ↗</Link><strong>{number(m.value, m.unit === "%" ? 1 : 0)}{m.value !== null ? <small>{m.unit}</small> : null}</strong><details><summary>산출 근거</summary><p>{m.definition}</p><p>{m.source}</p></details></article>)}</div>
      <article className={s.panel}><h3>청구액이 달라진 이유를 나누어 보기</h3>{data.bridge ? <><div className={s.bridge}><div><span>전월 대비 실청구액</span><strong className={data.bridge.delta < 0 ? s.warnText : undefined}>{won(data.bridge.delta)}</strong></div><div><span>청구 학생 수 변화분</span><strong>{won(data.bridge.studentsEffect)}</strong></div><div><span>학생당 실청구 변화분</span><strong>{won(data.bridge.perStudentEffect)}</strong></div></div><p>두 변화분의 합은 전체 증감과 같습니다. 할인·수강과목·교재비·환불 구성을 확인해야 실제 원인을 알 수 있습니다. 현재 월은 미마감 자료일 수 있습니다.</p></> : <p>전월과 이번 달에 청구 학생이 모두 있어야 증감을 나눌 수 있습니다.</p>}<Link href="/billing/stats">청구 상세에서 확인 →</Link></article>
    </section>
    <CollectionPanel key={data.month} month={data.month}/>
    <ReviewPanel batches={data.reviewBatches} month={data.month}/>
    <section id="accounting"><div className={s.sectionTitle}><h2>ECOUNT 회계 손익</h2><label className={s.upload} title="시안 화면에서는 파일을 받지 않습니다">손익 엑셀·원장 CSV 가져오기<input aria-label="ECOUNT 회계 파일" type="file" accept=".xlsx,.csv" disabled/></label></div>
      <p>원본 회사명과 기간을 그대로 보존합니다. 청구액과 회계 매출은 합산하지 않습니다. 연간·누적 보고서는 월별로 나누지 않습니다.</p>
      <ReportedFinancialPanel view={data.reportedFinancials}/>
      <details><summary>가져온 원장·보고서의 최초 분류 기록</summary><p>가져오기 당시 분류와 검산 기록입니다.</p>
        {selected && totals ? <article className={s.panel}><label htmlFor="report-select">보고서 기간 </label><select id="report-select" value={selected.id} onChange={e => setReportId(e.target.value)}>{data.reports.map(r => <option key={r.id} value={r.id}>{r.document.start} ~ {r.document.end}</option>)}</select><p>{selected.document.company}</p>
          <div className={s.bridge}><div><span>보고서 매출</span><strong>{won(selected.document.reportedRevenue)}</strong></div><div><span>보고서 영업비용</span><strong>{won(selected.document.reportedOperatingCost)}</strong></div><div><span>보고서 영업손익</span><strong>{won(selected.document.reportedOperatingProfit)}</strong></div><div><span>영업이익률</span><strong>{totals.margin === null ? "대사 후 제공" : `${number(totals.margin, 1)}%`}</strong></div><div><span>분류 기준 인건비율</span><strong>{totals.laborRatio === null ? "대사 후 제공" : `${number(totals.laborRatio, 1)}%`}</strong></div></div>
          <Reconciliation report={selected.document}/><p className={s.muted}>원본 합계 대사 {totals.reconciled ? "일치" : "불일치"} · v{selected.version} · {selected.document.sourceName}</p>
          <details><summary>계정 분류와 원본 추적</summary><div className={s.tableScroll}><table><thead><tr><th>계정</th><th>분류</th><th>금액</th><th>근거</th></tr></thead><tbody>{selected.document.lines.map(l => <tr key={l.key}><td>{l.account}</td><td>{categoryLabels[l.category]}</td><td>{won(l.amount)}</td><td>{l.sourceCell}</td></tr>)}</tbody></table></div><p className={s.hash}>SHA-256 {selected.document.sourceHash}</p></details>
        </article> : <div className={s.panel}>아직 가져온 손익계산서가 없습니다.</div>}
      </details>
      <Hiring data={data}/>
    </section>
    <section id="people" className={s.columns}><article className={s.panel}><h2>강사별 담당 규모</h2><p>현재 담당 반 기준입니다. 담당 변경 이력·학생의 출발 성적·수업 기간을 보정하기 전에는 강사의 성과 점수로 사용하지 않습니다.</p><div className={s.tableScroll}><table><thead><tr><th>강사</th><th>수강 학생</th><th>수강 건수</th></tr></thead><tbody>{data.teachers.filter(t => t.courses > 0).map(t => <tr key={t.id}><td>{t.label}</td><td>{t.students}명</td><td>{t.courses}건</td></tr>)}</tbody></table></div><Link href="/staff">강사·담당 반 확인 →</Link></article>
      <article className={s.panel}><h2>유입경로별 상담</h2><p>{data.month} 상담 접수 건수입니다. 학생이 연결된 상담은 등록 확정과 같지 않으며, 광고의 순증 효과로 해석할 수 없습니다.</p><table><thead><tr><th>기록된 경로</th><th>상담 건수</th><th>학생 연결</th></tr></thead><tbody>{data.channels.map(c => <tr key={c.label}><td>{c.label}</td><td>{c.inquiries}</td><td>{c.registered}</td></tr>)}</tbody></table><h3>광고 효과 측정에 필요한 다음 기록</h3><p>전단지·현수막·엘리베이터별 캠페인, 기간, 비용, 대상 학교·지역, QR·전용 문의 경로, 최초·보조 유입을 함께 기록해야 합니다.</p><Link href="/enrollment">신규 상담에서 확인 →</Link></article></section>
    <section id="knowledge" className={s.panel}><div className={s.sectionTitle}><h2>근거를 연결하는 경영 지식그래프</h2><Link className={s.secondary} href={`/dashboard/management/knowledge?month=${data.month}`}>통합 지식그래프 열기 ↗</Link></div><div className={s.graph} aria-label="경영 지식그래프 연결 구조"><span>MakeEdu 학생 ID</span><b>→</b><span>에이와 학생</span><b>→</b><span>수강 · 반 · 강사</span><b>→</b><span>청구 · 경영 지표</span><b>←</b><span>ECOUNT 기간 손익</span></div><p>{number(data.graph.nodes.length)}개 개체 · {number(data.graph.edges.length)}개 관계. 원본 ID·기간·산식을 함께 보관합니다. 그래프의 연결은 원인으로 확정된 관계가 아닙니다.</p>
      <h3>AI 경영 검토</h3><p>버튼을 누르면 개인별 이름·상담 원문 없이 집계 지표와 산식만 AI에 전달합니다. AI의 설명은 검토용이며, 실제 업무 변경은 담당자가 결정합니다.</p><button onClick={async () => setAiMessage(await sampleSave())}>현재 지표로 AI 검토</button>{aiMessage ? <p role="status" className={s.notice}>{aiMessage} · AI는 호출하지 않았습니다.</p> : null}
    </section>
    <section id="sources" className={s.panel}><h2>데이터 연결 상태</h2><table><thead><tr><th>소스</th><th>상태</th><th>확인 사항</th></tr></thead><tbody>{data.sources.map(x => <tr key={x.name}><td>{x.name}</td><td>{x.state}{x.updatedAt ? <small>{new Date(x.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small> : null}</td><td>{x.note}</td></tr>)}</tbody></table></section>
  </main>;
}

function Reconciliation({ report }: { report: AccountingReport }) {
  const t = accountingTotals(report);
  if (t.reconciled) return null;
  return <div className={s.notice}><strong>대사 검토 필요 · 확정 수익률·채용 계산에서 제외</strong><p>상세 합계−원본 표시 합계: 매출 {won(t.checks.revenue)}, 영업비용 {won(t.checks.cost)}, 영업손익 {won(t.checks.profit)}.</p></div>;
}

/** 채용 시나리오는 순수 계산(브라우저 안)이라 원래 화면 그대로 쓴다 — 저장하지 않는다. */
function Hiring({ data }: { data: ManagementSnapshot }) {
  const [values, setValues] = useState({ additionalMonthlyCost: "3500000", additionalStudents: "12", netFee: "340000", variableCostPerStudent: "25000", targetMargin: "15" });
  const labels: Record<keyof typeof values, string> = { additionalMonthlyCost: "추가 월 인건비 총액(보험·퇴직 부담 포함)", additionalStudents: "추가 수강 예상 인원", netFee: "학생당 월 순수강료", variableCostPerStudent: "학생당 추가 변동비", targetMargin: "목표 영업이익률(%)" };
  const base = data.accounting;
  let result: ReturnType<typeof hiringScenario> | null = null;
  if (base?.ready && Object.values(values).every(x => x !== "")) { try { result = hiringScenario({ revenue: base.revenue, cost: base.cost, labor: base.labor, additionalMonthlyCost: Number(values.additionalMonthlyCost), additionalStudents: Number(values.additionalStudents), netFee: Number(values.netFee), variableCostPerStudent: Number(values.variableCostPerStudent), targetMargin: Number(values.targetMargin) }); } catch { /* 잘못된 가정은 계산하지 않은 채로 둔다 */ } }
  return <article className={s.panel}><h3>강사·알바 추가 채용 시나리오</h3><p>선택 월의 회계 손익에 가정을 더하는 계산입니다. 강의실 수용력·시간대·현금잔고·기존 인력의 업무량은 별도로 확인해야 합니다.</p>{!base?.ready ? <p className={s.notice}>{data.month}의 대사·마감 확인이 완료된 월별 손익이 없어 계산을 보류합니다. 연간·누적 자료를 임의로 월 환산하지 않습니다.</p> : null}<div className={s.inputs}>{Object.entries(labels).map(([k, label]) => <label key={k}>{label}<input type="number" min="0" step={k === "targetMargin" ? "0.1" : "1"} max={k === "targetMargin" ? "99.9" : undefined} value={values[k as keyof typeof values]} onChange={e => setValues({ ...values, [k]: e.target.value })}/></label>)}</div>{result ? <div className={s.bridge}><div><span>가정 적용 후 영업손익</span><strong className={result.profit < 0 ? s.warnText : undefined}>{won(result.profit)}</strong></div><div><span>가정 적용 후 이익률</span><strong>{number(result.margin, 1)}%</strong></div><div><span>추가비용 회수에 필요한 신규생</span><strong>{result.breakEvenNewStudents === null ? "가정상 달성 불가" : `${number(result.breakEvenNewStudents)}명`}</strong></div><div><span>목표 이익률에 필요한 신규생 총수</span><strong>{result.studentsForTarget === null ? "가정상 달성 불가" : `${number(result.studentsForTarget)}명`}</strong></div></div> : base?.ready ? <p>모든 가정을 0 이상으로 입력하면 계산합니다. 인원은 정수, 목표 이익률은 100% 미만입니다.</p> : null}</article>;
}
