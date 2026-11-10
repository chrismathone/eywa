"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { accountingTotals, accountCategories, categoryLabels, type AccountingDraft, type AccountingReport, type ManagementSnapshot } from "./model";
import { ReportedFinancialPanel } from "./reported-financial-panel";
import { HiringPanel } from "./hiring-panel";
import s from "./workspace.module.css";

const number = (n: number | null, digits = 0) => n === null ? "자료 필요" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const won = (n: number | null) => n === null ? "자료 필요" : `${number(n)}원`;

/**
 * ECOUNT 회계 손익 — 손익계산서 .xlsx / 계정별원장 .csv 미리보기(서버가 읽기만) → 원장이 회사·기간 확인 + 계정 분류 검토 → 저장(같은 기간은 새 버전).
 * 원장 집계는 늘 '검토 대기'로만 저장된다(확정 이익률·채용 계산에 쓰지 않는다).
 */
export function AccountingPanel({ data }: { data: ManagementSnapshot }) {
  const router = useRouter();
  const [draft, setDraft] = useState<AccountingDraft | null>(null), [ledgerDrafts, setLedgerDrafts] = useState<AccountingDraft[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [reportId, setReportId] = useState(data.reports.find(r => r.document.start === `${data.month}-01`)?.id ?? data.reports[0]?.id ?? "");
  const selected = data.reports.find(r => r.id === reportId) ?? data.reports[0], totals = selected ? accountingTotals(selected.document) : null;
  async function preview(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage(""); setDraft(null); setLedgerDrafts([]);
    try {
      const form = new FormData(); form.set("file", file);
      const r = await fetch("/api/management/accounting", { method: "POST", body: form }), json = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(json.error ?? "파일을 읽지 못했습니다");
      if (json.documents) { const docs = json.documents as AccountingDraft[]; setLedgerDrafts(docs); setDraft(docs.find(d => d.start.startsWith(data.month)) ?? docs.at(-1) ?? null); }
      else setDraft(json.document);
    } catch (e) { setMessage(e instanceof Error ? e.message : "파일을 읽지 못했습니다"); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft?.scopeConfirmed) return;
    setBusy(true); setMessage("");
    const kind = (k?: string) => k === "ledger" ? "ledger" : "profit_loss";
    const version = data.reports.find(r => r.document.start === draft.start && r.document.end === draft.end && kind(r.document.sourceKind) === kind(draft.sourceKind))?.version ?? 0;
    try {
      const r = await fetch("/api/management/accounting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: draft, expectedVersion: version }) }), json = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(json.error ?? "저장하지 못했습니다");
      setDraft(null); setLedgerDrafts([]); setMessage(json.saved?.unchanged ? "이미 같은 내용이 저장되어 있습니다." : "손익 자료를 저장했습니다."); router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "저장하지 못했습니다"); } finally { setBusy(false); }
  }
  return <section id="accounting"><div className={s.sectionTitle}><h2>ECOUNT 회계 손익</h2><label className={s.upload}>{busy ? "처리 중…" : "손익 엑셀·원장 CSV 가져오기"}<input aria-label="ECOUNT 회계 파일" type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => { void preview(e.target.files?.[0]); e.target.value = ""; }}/></label></div>
    <p>원본 회사명과 기간을 그대로 보존합니다. 청구액과 회계 매출은 합산하지 않습니다. 연간·누적 보고서는 월별로 나누지 않습니다.</p>
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
    <ReportedFinancialPanel view={data.reportedFinancials}/>
    {ledgerDrafts.length > 0 ? <label>원장 검토 월 <select aria-label="원장 검토 월" value={draft?.start ?? ""} onChange={e => setDraft(ledgerDrafts.find(d => d.start === e.target.value) ?? null)}><option value="" disabled>검토할 월 선택</option>{ledgerDrafts.map(d => <option key={d.start} value={d.start}>{d.start} ~ {d.end}</option>)}</select> <small>총 {ledgerDrafts.length}개 월 · 고른 월을 검토한 뒤 저장합니다.</small></label> : null}
    {draft ? <article className={s.panel}><h3>가져오기 검토</h3><p>{draft.company} · {draft.start} ~ {draft.end}</p><p>{draft.sourceName} · {draft.lines.length}개 계정 행{draft.sourceKind !== "ledger" ? ` · 원본 영업손익 ${won(draft.reportedOperatingProfit)}` : " · 원장 월별 집계"}</p>
      <Reconciliation report={{ ...draft, scopeConfirmed: true } as AccountingReport}/><p>계정별 비용 분류를 확인해 주세요. 같은 기간은 기존 자료를 새 버전으로 바꾸며 이전 버전은 보관합니다.</p>
      <div className={s.tableScroll}><table><thead><tr><th>원본 계정</th><th>금액</th><th>경영 분류</th></tr></thead><tbody>{draft.lines.map((line, i) => <tr key={line.key}><td>{line.account}<small>{line.sourceCell}</small></td><td>{won(line.amount)}</td><td><select aria-label={`${line.account} 분류`} value={line.category} onChange={e => setDraft({ ...draft, lines: draft.lines.map((l, j) => i === j ? { ...l, category: e.target.value as typeof l.category } : l) })}>{accountCategories.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}</select></td></tr>)}</tbody></table></div>
      <label className={s.confirm}><input type="checkbox" checked={draft.scopeConfirmed} onChange={e => setDraft({ ...draft, scopeConfirmed: e.target.checked })}/> 이 회사·기간의 자료가 현재 학원에 해당함을 확인했습니다.</label>
      <button disabled={busy || !draft.scopeConfirmed} onClick={() => void save()}>{draft.complete ? "검토한 자료 저장" : "검토 대기 자료 저장"}</button> <button className={s.secondary} disabled={busy} onClick={() => { setDraft(null); setLedgerDrafts([]); }}>취소</button></article> : null}
    <details><summary>가져온 원장·보고서의 최초 분류 기록</summary><p>가져오기 당시 분류와 검산 기록입니다. 최신 보고서 기준 손익과 확인 사항은 위에 표시합니다.</p>
      {selected && totals ? <article className={s.panel}><label htmlFor="report-select">보고서 기간 </label><select id="report-select" value={selected.id} onChange={e => setReportId(e.target.value)}>{data.reports.map(r => <option key={r.id} value={r.id}>{r.document.start} ~ {r.document.end} · {r.document.sourceKind === "ledger" ? "원장" : "손익계산서"}</option>)}</select><p>{selected.document.company}</p>
        <div className={s.bridge}><div><span>{selected.document.sourceKind === "ledger" ? "분류된 원장 매출(검토 중)" : "보고서 매출"}</span><strong>{won(selected.document.sourceKind === "ledger" ? totals.revenue : selected.document.reportedRevenue)}</strong></div><div><span>{selected.document.sourceKind === "ledger" ? "분류된 원장 영업비용(검토 중)" : "보고서 영업비용"}</span><strong>{won(selected.document.sourceKind === "ledger" ? totals.cost : selected.document.reportedOperatingCost)}</strong></div><div><span>보고서 영업손익</span><strong>{won(selected.document.reportedOperatingProfit)}</strong></div><div><span>영업이익률</span><strong>{totals.margin === null ? "대사 후 제공" : `${number(totals.margin, 1)}%`}</strong></div><div><span>분류 기준 인건비율</span><strong>{totals.laborRatio === null ? "대사 후 제공" : `${number(totals.laborRatio, 1)}%`}</strong></div></div>
        <Reconciliation report={selected.document}/><p className={s.muted}>{selected.document.sourceKind === "ledger" ? "월별 손익 마감 대기" : `원본 합계 대사 ${totals.reconciled ? "일치" : "불일치"}`} · v{selected.version} · {selected.document.sourceName}</p>
        <p>매출에는 임대·관리비 등 다른 사업 수익이 포함될 수 있습니다. 학원 단독 수익성은 사업별 비용 배부 후 판단해야 합니다. 대사 일치는 회계 마감 완료를 뜻하지 않습니다.</p>
        <details><summary>계정 분류와 원본 추적</summary><div className={s.tableScroll}><table><thead><tr><th>계정</th><th>분류</th><th>금액</th><th>근거</th></tr></thead><tbody>{selected.document.lines.map(l => <tr key={l.key}><td>{l.account}</td><td>{categoryLabels[l.category]}</td><td>{won(l.amount)}</td><td>{l.sourceCell}</td></tr>)}</tbody></table></div><p className={s.hash}>SHA-256 {selected.document.sourceHash}</p></details>
      </article> : <div className={s.panel}>아직 가져온 손익계산서·원장이 없습니다.</div>}
    </details>
    <HiringPanel data={data}/>
  </section>;
}

function Reconciliation({ report }: { report: AccountingReport }) {
  const t = accountingTotals(report);
  if (report.sourceKind === "ledger" && report.ledgerInfo) return <div className={s.notice}><strong>원장 내부 검산 {report.ledgerInfo.controlsMatched ? "일치" : "불일치"} · 월별 손익 마감 확인 필요</strong><p>원본 조회기간 {report.ledgerInfo.sourceStart} ~ {report.ledgerInfo.sourceEnd} · {report.ledgerInfo.accountCount}개 계정 · 전체 {number(report.ledgerInfo.totalTransactionCount)}건 중 선택 월 {number(report.ledgerInfo.transactionCount)}건</p><ul>{report.ledgerInfo.warnings.map(w => <li key={w}>{w}</li>)}</ul><p>분류 확인과 월별 손익계산서 대사 전에는 확정 이익률·채용 계산에 사용하지 않습니다.</p></div>;
  if (t.reconciled) return null;
  return <div className={s.notice}><strong>대사 검토 필요 · 확정 수익률·채용 계산에서 제외</strong><p>상세 합계−원본 표시 합계: 매출 {won(t.checks.revenue)}, 영업비용 {won(t.checks.cost)}, 영업손익 {won(t.checks.profit)}. 계정별원장 또는 다시 출력한 손익계산서로 차이를 확인해 주세요.</p></div>;
}
