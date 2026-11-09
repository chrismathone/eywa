"use client";
import { useState } from "react";
import { sampleSave } from "@/features/mockup/sample";
import s from "./workspace.module.css";

/**
 * 자료 수집함 — 시안. 원래 화면의 파일 검증(`/api/management/collection`)과 학원 PC 수집기 등록(CollectorPanel)은
 * 옮기지 않았다(새 표·외부 수집기 필요). 흐름과 확인 문구만 보여 주고, 검증 버튼은 안내 문구를 돌려준다.
 */
export function CollectionPanel({ month }: { month: string }) {
  const [source, setSource] = useState<"makeedu" | "ecount">("makeedu"), [scope, setScope] = useState(false), [fullScope, setFullScope] = useState(false), [message, setMessage] = useState("");
  return <section id="collection" className={s.panel}><div className={s.sectionTitle}><h2>자료 수집함</h2><span>파일 선택 → 검증 → 이력 저장 → 확인 업무</span></div>
    <p>파일을 직접 가져오거나 학원 PC 수집기로 지정 폴더에서 전송합니다. 같은 파일·같은 비교 자료는 중복 저장하지 않으며 청구·납부 내역을 자동 수정하지 않습니다.</p>
    <div className={s.inputs}><label>자료 종류<select value={source} onChange={e => { setSource(e.target.value as typeof source); setScope(false); setFullScope(false); setMessage(""); }}><option value="makeedu">MakeEdu 수납통합내역</option><option value="ecount">ECOUNT 월별손익분석</option></select></label><label>원본 엑셀 파일<input type="file" accept=".xlsx" disabled title="시안 화면에서는 파일을 받지 않습니다"/></label></div>
    {source === "makeedu" ? <p>청구월 <strong>{month}</strong>로 비교합니다. MakeEdu 수납통합내역에서 전체원생·전체수납, 이전달 미납 제외로 출력합니다.</p> : <p>엑셀 안의 월별 기간을 사용합니다. 같은 회사·월의 원장이 필요합니다. <a href="#accounting">계정별원장 확인 →</a></p>}
    <label className={s.confirm}><input type="checkbox" checked={scope} onChange={e => setScope(e.target.checked)}/> 현재 학원의 원본 자료임을 확인했습니다.</label>
    {source === "makeedu" ? <label className={s.confirm}><input type="checkbox" checked={fullScope} onChange={e => setFullScope(e.target.checked)}/> {month} 전체원생·전체수납이며 이전달 미납이 제외된 파일입니다.</label> : null}
    <button disabled={!scope || (source === "makeedu" && !fullScope)} onClick={async () => setMessage(await sampleSave())}>파일 검증·미리보기</button>
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
  </section>;
}
