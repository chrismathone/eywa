import { useEffect, useRef, useState } from 'react';
import { importSource } from './import-source';
import type { Draft } from './model';
export function SourceDialog({ close, apply }: { close: () => void; apply: (draft: Draft) => void }) {
  const [date, setDate] = useState(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [login, setLogin] = useState(false);
  const [ready, setReady] = useState<Draft | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function load() {
    setBusy(true); setError(''); setLogin(false); setReady(null);
    try {
      const response = await fetch(`/api/timetable/lab/source?date=${encodeURIComponent(date)}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) { setLogin(response.status === 401); throw new Error(data?.error || '시간표를 읽지 못했습니다. 연결 상태를 확인하세요.'); }
      setReady(importSource(data));
    } catch (e) { setError(e instanceof Error ? e.message : '시간표를 읽지 못했습니다.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="source-title" className="lab-modal" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="source-title">기존 시간표 불러오기</h2><button onClick={close} aria-label="불러오기 닫기" disabled={busy}>×</button></header>
    <p>기존 영어 시간표의 강사 배치·학생 명단·수업색·강사색과 보기 설정을 함께 가져옵니다.</p>
    <label>불러올 주의 기준일<input autoFocus type="date" value={date} onChange={e => { setDate(e.target.value); setReady(null); }} disabled={busy} /></label>
    <p className="subtle">선택한 날짜가 포함된 월요일~일요일 시간표입니다. 운영 원본은 바뀌지 않습니다.</p>
    {error && <p role="alert" className="load-error">{error}</p>}
    {login && <p><a href="http://127.0.0.1:4320/login" target="_blank" rel="noreferrer">로그인 창 열기</a> · 로그인 후 이 창에서 다시 불러오세요.</p>}
    {ready && <div className="source-summary"><strong>{ready.source?.academy || '기존 영어 시간표'}</strong>
      <p>{ready.source?.date} 주 · 수업 {ready.placements.filter(p => p.kind !== 'block').length}개 · 비수업 {ready.placements.filter(p => p.kind === 'block').length}개</p>
      <p>불러오면 현재 연습안을 교체합니다. 되돌리기로 이전 안을 복구할 수 있습니다.</p></div>}
    <footer><button onClick={close} disabled={busy}>취소</button>{ready ? <button className="primary" onClick={() => apply(ready)}>이 시간표로 연습 시작</button> : <button className="primary" onClick={load} disabled={busy || !date}>{busy ? '시간표 불러오는 중…' : '시간표 불러오기'}</button>}</footer>
  </dialog>;
}
