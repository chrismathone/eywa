"use client";
import { useState } from "react";
import { COLLECTOR_PACKAGE_PATH, COLLECTOR_PACKAGE_VERSION, collectorResultLabel, type CollectorDevice } from "./collector-contract";
import s from "./workspace.module.css";

const date = (v: string | null) => v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 없음";
async function call(body?: unknown) {
  const r = await fetch("/api/management/collector-devices", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).error ?? "연결 정보를 처리하지 못했습니다");
  return r;
}

/**
 * 학원 PC 수집기 — 🔴 기본 꺼짐(지점 스위치 · s2_0071). 켜면 연결 파일을 발급할 수 있고, 끄면 모든 PC 요청이 거절된다.
 * 펼칠 때까지 아무 요청도 보내지 않는다(목록은 '연결 상태 새로고침'으로).
 */
export function CollectorPanel() {
  const [state, setState] = useState<{ enabled: boolean; devices: CollectorDevice[] } | null>(null), [checkedAt, setCheckedAt] = useState(0);
  const [name, setName] = useState("학원 PC"), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load() { const j = await (await call()).json(); setState({ enabled: j.enabled === true, devices: j.devices ?? [] }); setCheckedAt(Date.now()); }
  async function run(action: "list" | "enable" | "create" | "revoke", arg?: string | boolean) {
    setBusy(true); setMessage("");
    try {
      if (action === "enable") { await call({ action, enabled: arg === true }); setMessage(arg === true ? "PC 수집기를 켰습니다. 연결 파일을 발급해 PC에 설치할 수 있습니다." : "PC 수집기를 껐습니다. 모든 PC의 다음 요청부터 거절됩니다."); }
      if (action === "revoke") { await call({ action, id: arg }); setMessage("수집 연결을 해제했습니다. 그 PC의 다음 요청부터 차단됩니다."); }
      if (action === "create") {
        const url = URL.createObjectURL(await (await call({ action, name, scopeConfirmed: confirmed })).blob()), a = document.createElement("a");
        a.href = url; a.download = "aywa-collector-connection.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setConfirmed(false); setMessage("연결 파일을 내려받았습니다. 학원 PC의 설치 프로그램에서 선택해 주세요. 다시 내려받을 수 없으며, 잃어버리면 이 연결을 해제하고 새로 발급합니다.");
      }
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "연결 정보를 처리하지 못했습니다"); } finally { setBusy(false); }
  }
  return <details id="collector-pc"><summary>학원 PC 수집기(선택) · 설치·연결 관리</summary>
    <p>학원 PC의 전용 폴더에 넣은 원본 엑셀을 15분마다 확인해 대조 기록으로 보냅니다. 기본은 꺼져 있습니다. 원본 사이트에서 파일을 내려받는 일은 자동이 아닙니다. 보내는 자료로 청구·회계 자료를 고치지 않습니다.</p>
    {state === null ? <button disabled={busy} onClick={() => void run("list")}>{busy ? "확인 중…" : "연결 상태 확인"}</button> : <>
      <label className={s.confirm}><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => void run("enable", e.target.checked)}/> PC 수집기 사용(끄면 모든 PC의 전송이 거절됩니다)</label>
      {state.enabled ? <>
        <ol><li><a href={COLLECTOR_PACKAGE_PATH} download>PC 수집기 {COLLECTOR_PACKAGE_VERSION} ZIP 내려받기</a> → 학원 PC에서 압축을 풉니다.</li><li>아래에서 연결 파일을 발급한 뒤 압축 폴더의 <strong>설치.cmd</strong>를 실행하고 연결 파일을 선택합니다.</li><li><strong>수집폴더\makeedu\2026-10</strong>처럼 자료 종류·청구월 폴더에 원본 엑셀을 넣습니다. ECOUNT는 파일 안의 실제 기간을 읽습니다.</li></ol>
        <div className={s.inputs}><label>PC 표시 이름<input maxLength={60} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label></div>
        <label className={s.confirm}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/> 이 학원 자료의 대조 기록 저장을 이 PC에 90일간 허용합니다. 청구 수정·회계 확정·외부 발송 권한은 포함하지 않습니다.</label>
        <button disabled={busy || !confirmed || !name.trim()} onClick={() => void run("create")}>수집 전용 연결 파일 발급</button>{" "}
        <p className={s.muted}>연결 파일에는 수집 전용 인증정보가 들어 있습니다. 채팅이나 공용 폴더로 공유하지 마세요. 설치 후 Windows 사용자 보안 저장소에 암호화해 보관합니다.</p>
      </> : null}
      <button className={s.secondary} disabled={busy} onClick={() => void run("list")}>연결 상태 새로고침</button>
      {state.devices.length === 0 ? <p>등록된 수집 PC가 없습니다.</p> : <div className={s.tableScroll}><table><thead><tr><th>PC</th><th>연결</th><th>마지막 접속 / 전송 성공</th><th>처리 결과</th><th>관리</th></tr></thead><tbody>{state.devices.map(d => <tr key={d.id}><td>{d.name}</td><td>{d.revoked_at ? "해제됨" : Date.parse(d.expires_at) <= checkedAt ? "만료됨" : d.last_seen_at ? "등록됨 · 접속 확인" : "등록됨 · 설치 대기"}<br/>만료 {date(d.expires_at)}</td><td>{date(d.last_seen_at)}<br/>{date(d.last_success_at)}</td><td>{collectorResultLabel(d.last_result)}</td><td><button disabled={busy || !!d.revoked_at} onClick={() => void run("revoke", d.id)}>연결 해제</button></td></tr>)}</tbody></table></div>}
    </>}
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
  </details>;
}
