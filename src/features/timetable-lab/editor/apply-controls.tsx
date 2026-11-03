import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DraftStore } from './store';
import type { Draft } from './model';
import { nextApplyHour } from '../apply-time';
import { previewTimetableLabApply, queueTimetableLabApply, listTimetableLabApplyJobs, cancelTimetableLabApplyJob, readTimetableLabApplyDraft, type ApplyReview, type ApplyJobSummary } from '../server/apply-actions';

const statusLabel = { pending: '적용 예약', applied: '적용 완료', failed: '적용 실패', cancelled: '취소됨' };
const kstLabel = (at: string) => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false });
export function ApplyControls({ store, saved }: { store: DraftStore; saved: (draft: Draft, name: string) => void }) {
  const { draft } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // 시간표 배지에서 들어오면 적용 내역부터 보여 준다.
  const [open, setOpen] = useState(false), [history, setHistory] = useState(() => new URLSearchParams(window.location.search).has('history')), [jobs, setJobs] = useState<ApplyJobSummary[]>([]), [error, setError] = useState('');
  const seen = useRef(new Set<string>());
  const load = useCallback(async () => {
    const response = await listTimetableLabApplyJobs();
    if ('error' in response) { setError(response.error); return; }
    setError(''); setJobs(response.jobs);
    for (const job of response.jobs) if (job.status === 'applied' && seen.current.has(job.id)) {
      seen.current.delete(job.id);
      const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('eywa-timetable-applied') : null;
      channel?.postMessage({ tenantId: store.getSnapshot().draft.source?.tenantId }); channel?.close();
    }
    for (const job of response.jobs) if (job.status === 'pending') seen.current.add(job.id);
  }, [store]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const pending = jobs.some(job => job.status === 'pending');
  useEffect(() => {
    if (!pending) return;
    const interval = window.setInterval(() => { void load(); }, 10000);
    return () => window.clearInterval(interval);
  }, [pending, load]);
  return <>
    <button className="primary" disabled={!draft.source?.baselineHash} title={!draft.source?.baselineHash ? '기존 시간표를 다시 불러온 뒤 적용하세요.' : undefined} onClick={() => setOpen(true)}>연습본 적용</button>
    <button aria-expanded={history} onClick={() => { setHistory(!history); void load(); }}>적용 내역{pending ? ` · 예약 ${jobs.filter(job => job.status === 'pending').length}` : ''}</button>
    {open && <ApplyDialog store={store} close={() => setOpen(false)} done={(job, snapshot) => { saved(snapshot, `${statusLabel[job.status]} · ${kstLabel(job.at)} KST`); setOpen(false); setHistory(true); void load(); }} />}
    {history && <div className="apply-history"><header><strong>연습본 적용 내역 · KST</strong><button onClick={() => setHistory(false)} aria-label="적용 내역 닫기">×</button></header>
      {error && <p role="alert">{error}</p>}
      {!jobs.length && !error && <p>적용 내역이 없습니다.</p>}
      {jobs.map(job => <div key={job.id}><span>{kstLabel(job.at)} · {statusLabel[job.status]}{job.actorName ? ` · ${job.actorName}` : ''}</span>{job.error && <p>{job.error}</p>}{!!job.skipped?.length && <details className="lab-conflict"><summary>적용하지 않은 변경 {job.skipped.length}건</summary><ul>{job.skipped.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}<button onClick={async()=>{const result=await readTimetableLabApplyDraft(job.id);if('error'in result)setError(result.error);else{store.commit('예약 연습본 불러오기',result.draft);saved(store.getSnapshot().draft,`예약 연습본 · ${kstLabel(job.at)} KST`);setError('');}}}>연습본 불러오기</button>{job.status === 'pending' && job.mine && <button onClick={async () => { const result = await cancelTimetableLabApplyJob(job.id); if ('error' in result) setError(result.error); else await load(); }}>예약 취소</button>}</div>)}
    </div>}
  </>;
}

/** 보관함 위의 적용 대기 목록 — 예약 내용은 불러와서 확인한다. */
export function PendingApplies({ load }: { load: (name: string, draft: Draft) => void }) {
  const [jobs, setJobs] = useState<ApplyJobSummary[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void listTimetableLabApplyJobs().then(response => { if (!alive) return; if ('error' in response) setError(response.error); else setJobs(response.jobs.filter(job => job.status === 'pending')); });
    return () => { alive = false; };
  }, []);
  if (!jobs.length && !error) return null;
  return <><h3>적용 대기 중</h3>{error && <p role="alert" className="load-error">{error}</p>}
    <ul className="draft-list">{jobs.map(job => <li key={job.id}><div><strong>{kstLabel(job.at)} KST 적용 예정</strong><small>예약자 {job.actorName || '정보 없음'}</small></div>
      <span className="draft-actions"><button onClick={async () => { const result = await readTimetableLabApplyDraft(job.id); if ('error' in result) setError(result.error); else load(`예약 연습본 · ${kstLabel(job.at)} KST`, result.draft); }}>불러오기</button></span></li>)}</ul></>;
}

function ApplyDialog({ store, close, done }: { store: DraftStore; close: () => void; done: (job: ApplyJobSummary, draft: Draft) => void }) {
  const { revision } = useSyncExternalStore(store.subscribe, store.getSnapshot), dialog = useRef<HTMLDialogElement>(null);
  const initial = nextApplyHour(), [date, setDate] = useState(initial.date), [hour, setHour] = useState(initial.hour), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reviewed, setReviewed] = useState<{ review: ApplyReview; revision: number; snapshot: Draft } | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const review = reviewed?.revision === revision && reviewed.review.date === date && reviewed.review.hour === hour ? reviewed.review : null;
  const needsAck = !!review && review.warnings.length + review.skipped.length > 0;
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function inspect() {
    setBusy(true); setError(''); setAcknowledged(false);
    const current = store.getSnapshot();
    try {
      const result = await previewTimetableLabApply({ draft: current.draft, date, hour });
      if ('error' in result) setError(result.error); else setReviewed({ review: result.review, revision: current.revision, snapshot: current.draft });
    } catch { setError('연결 상태를 확인한 뒤 다시 검사해 주세요.'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!review || !reviewed || store.getSnapshot().revision !== reviewed.revision) return;
    setBusy(true); setError('');
    try {
      const result = await queueTimetableLabApply({ draft: reviewed.snapshot, date, hour, expectedHash: review.hash, acknowledgeWarnings: acknowledged });
      if ('error' in result) { setError(result.error); setReviewed(null); } else done(result.job, reviewed.snapshot);
    } catch { setError('연결 상태를 확인한 뒤 적용 내역에서 예약 여부를 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="lab-modal apply-dialog" aria-labelledby="apply-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="apply-title">연습본 적용</h2><button disabled={busy} onClick={close} aria-label="연습본 적용 창 닫기">×</button></header>
    <p>선택한 기준일부터 이후의 실제 시간표에 적용합니다. 적용 전까지 운영 시간표는 유지됩니다.</p>
    <div className="apply-time-fields"><label>적용일<input type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label><label>적용 시각 · KST<select value={hour} disabled={busy} onChange={event => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}시 정시</option>)}</select></label></div>
    {error && <p role="alert" className="load-error">{error}</p>}
    {review && <><p className="apply-summary">수업 {review.summary.schedules} · 일정 {review.summary.blocks} · 반 {review.summary.classes} · 수강 {review.summary.enrollments} · 학생 {review.summary.students} · 강사 이름 {review.summary.teacherNames}</p>
      {review.notices.length > 0 && <ul className="apply-notices">{review.notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>}
      <ul className="apply-changes">{review.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
      {review.skipped.length > 0 && <div className="lab-conflict apply-skipped"><strong>적용하지 않는 변경 {review.skipped.length}건</strong><ul>{review.skipped.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {review.warnings.length > 0 && <details className="lab-conflict"><summary>겹침 경고 {review.warnings.length}건</summary><ul>{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {needsAck && <label className="apply-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />경고를 확인했습니다.</label>}
      <p>반 배치·순서·접기 설정은 현재 계정에 저장됩니다. 수업 배치와 학생 이동은 운영 자료에 적용됩니다.</p>
    </>}
    <footer><button disabled={busy} onClick={close}>취소</button><button disabled={busy} onClick={inspect}>{busy ? '확인 중…' : review ? '다시 검사' : '변경 내용 검사'}</button><button className="primary" disabled={busy || !review || (needsAck && !acknowledged)} onClick={apply}>연습본 적용 예약</button></footer>
  </dialog>;
}
