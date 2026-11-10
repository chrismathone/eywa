"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceEvidence } from "./reviews";
import { CollectorPanel } from "./collector-panel";
import s from "./workspace.module.css";

type Plan = { evidence: SourceEvidence[]; planHash: string; alreadyRecorded: string[] };
const value = (v: number | null, unit: string) => v === null ? "비교 제외" : `${v.toLocaleString("ko-KR")}${unit}`;

/**
 * 자료 수집함 — 파일 선택 → 서버 검증(미리보기 · 저장 없음) → 대조 기록 저장 → 원본 대사·확인 업무.
 * 저장은 미리보기와 같은 파일을 서버가 다시 계산해 지문이 같을 때만(`/api/management/collection`). 청구·납부 내역은 고치지 않는다.
 */
export function CollectionPanel({ month }: { month: string }) {
  const router = useRouter();
  const [source, setSource] = useState<"makeedu" | "ecount">("makeedu"), [file, setFile] = useState<File>(), [scope, setScope] = useState(false), [fullScope, setFullScope] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const reset = () => { setPlan(null); setMessage(""); };
  async function run(mode: "preview" | "commit") {
    if (!file || !scope) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData();
      form.set("source", source); form.set("month", month); form.set("mode", mode); form.set("scope", String(scope)); form.set("fullScope", String(fullScope)); form.set("file", file);
      if (plan) form.set("planHash", plan.planHash);
      const response = await fetch("/api/management/collection", { method: "POST", body: form }), data = await response.json().catch(() => ({}));
      if (!response.ok) { setPlan(null); throw Error(data.error ?? "수집 검증을 완료하지 못했습니다"); }
      if (mode === "preview") { setPlan(data); setMessage("검증 결과를 확인한 뒤 수집 이력에 저장할 수 있습니다."); }
      else { setPlan(null); setMessage(`새 대조 ${data.inserted}개월 저장 · 같은 대조 ${data.duplicates}개월은 기존 이력 유지. 아래 원본 대사·확인 업무에서 결과를 확인하세요.`); router.refresh(); }
    } catch (e) { setMessage(e instanceof Error ? e.message : "수집 검증을 완료하지 못했습니다"); } finally { setBusy(false); }
  }
  return <section id="collection" className={s.panel}><div className={s.sectionTitle}><h2>자료 수집함</h2><span>파일 선택 → 검증 → 이력 저장 → 확인 업무</span></div>
    <p>원본 파일을 직접 올립니다(원본 사이트에서 내려받는 일은 수동입니다). 같은 파일·같은 비교 자료는 중복 저장하지 않으며 청구·납부 내역을 자동으로 고치지 않습니다.</p>
    <CollectorPanel/>
    <div className={s.inputs}><label>자료 종류<select disabled={busy} value={source} onChange={e => { setSource(e.target.value as typeof source); setScope(false); setFullScope(false); setFile(undefined); reset(); }}><option value="makeedu">MakeEdu 수납통합내역</option><option value="ecount">ECOUNT 월별손익분석</option></select></label>
      <label>원본 엑셀 파일<input key={source} type="file" accept=".xlsx" disabled={busy} onChange={e => { setFile(e.target.files?.[0]); reset(); }}/></label></div>
    {source === "makeedu" ? <p>청구월 <strong>{month}</strong>로 비교합니다(다른 달은 위 운영 분석 월을 바꿔 주세요). MakeEdu 수납통합내역에서 전체원생·전체수납, 이전달 미납 제외로 출력한 파일이 필요합니다. 파일에 월 정보가 없어 조회 조건 확인이 필요합니다.</p> : <p>엑셀 안의 월별 기간을 사용합니다. 같은 회사·월의 계정별원장이 먼저 저장되어 있어야 합니다. <a href="#accounting">계정별원장 CSV 먼저 가져오기 →</a></p>}
    <label className={s.confirm}><input type="checkbox" disabled={busy} checked={scope} onChange={e => { setScope(e.target.checked); reset(); }}/> 현재 학원의 원본 자료임을 확인했습니다.</label>
    {source === "makeedu" ? <label className={s.confirm}><input type="checkbox" disabled={busy} checked={fullScope} onChange={e => { setFullScope(e.target.checked); reset(); }}/> {month} 전체원생·전체수납이며 이전달 미납이 제외된 파일입니다.</label> : null}
    <button disabled={busy || !file || !scope || (source === "makeedu" && !fullScope)} onClick={() => void run("preview")}>{busy ? "처리 중…" : "파일 검증·미리보기"}</button>
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
    {plan ? <div><h3>수집 검증 결과 · {plan.evidence.length}개월</h3>{plan.alreadyRecorded.length ? <p>이미 저장된 같은 대조: {plan.alreadyRecorded.join(", ")}. 후속 확인 결과는 아래 원본 대사·확인 업무의 최신 이력에서 확인하세요.</p> : null}
      <div className={s.tableScroll}><table><thead><tr><th>월</th><th>원본</th><th>확인할 항목</th></tr></thead><tbody>{plan.evidence.map(e => <tr key={e.month}><td>{e.month}</td><td>{e.sourceName}</td><td>{plan.alreadyRecorded.includes(e.month) ? "기존 대조 · 최신 확인 이력 참조" : e.issues.length ? e.issues.map(i => i.title).join(" · ") : source === "makeedu" ? "학생별 청구·할인·수납 비교 일치" : "표시 합계 비교 일치"}</td></tr>)}</tbody></table></div>
      {plan.evidence.map(e => <details key={e.month}><summary>{e.month} 수치와 근거 보기</summary><p>{e.summary}</p><div className={s.tableScroll}><table><thead><tr><th>항목</th><th>원본</th><th>에이와 집계</th></tr></thead><tbody>{e.facts.map(f => <tr key={f.label}><td>{f.label}</td><td>{value(f.sourceValue, f.unit)}</td><td>{value(f.aywaValue, f.unit)}</td></tr>)}</tbody></table></div>{e.issues.map(i => <p key={i.key}>{i.title}: {i.detail} {i.nextAction}</p>)}</details>)}
      <p>검토가 필요한 결과도 이력으로 저장해 담당·기한을 관리할 수 있습니다. 저장은 원장 수정이나 회계 마감 확정이 아닙니다.</p>
      <button disabled={busy} onClick={() => void run("commit")}>검증 결과를 수집 이력에 저장</button></div> : null}
  </section>;
}
