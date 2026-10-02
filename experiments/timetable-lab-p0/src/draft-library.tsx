import { useEffect, useRef, useState } from 'react';
import { listDrafts, loadDraft, saveDraft, type DraftSummary } from './draft-api';
import type { ComparedDraft } from './comparison-view';
import type { Draft } from './model';
import type { DraftStore } from './store';
type Props = { store: DraftStore; close: () => void; loaded: (name: string, draft: Draft) => void; saved: (name: string, draft: Draft) => void;
  compare: (left: ComparedDraft, right: ComparedDraft) => void };
const dateText = (text: string) => new Date(text).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function DraftLibrary({ store, close, loaded, saved, compare }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), [base] = useState(() => store.getSnapshot());
  const [items, setItems] = useState<DraftSummary[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [name, setName] = useState(`${base.draft.source?.date ?? '영어 시간표'} 연습본`), [left, setLeft] = useState('current'), [right, setRight] = useState('');
  useEffect(() => {
    dialog.current?.showModal(); const controller = new AbortController();
    listDrafts(0, controller.signal).then(data => { setItems(data.items); setNextOffset(data.nextOffset); setRight(data.items[0]?.id ?? ''); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '연습본을 확인해 주세요.'); } finally { setBusy(false); }
  }
  async function open(id: string) {
    const value = await loadDraft(id);
    if (store.getSnapshot().revision !== base.revision) throw new Error('편집 내용이 바뀌었습니다. 창을 닫고 다시 열어 주세요.');
    loaded(value.item.name, { ...value.draft, originId: crypto.randomUUID() });
  }
  async function compared(id: string): Promise<ComparedDraft> {
    if (id === 'current') return { name: '현재 편집 중', draft: base.draft };
    const value = await loadDraft(id); return { name: value.item.name, draft: value.draft };
  }
  return <dialog ref={dialog} className="lab-modal draft-library" aria-labelledby="library-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="library-title">연습본 저장·불러오기</h2><button onClick={close} disabled={busy} aria-label="연습본 보관함 닫기">×</button></header>
    <p className="subtle">내 계정의 연습본을 저장합니다. 같은 계정으로 다른 기기에서도 불러올 수 있습니다. 운영 시간표에는 반영되지 않습니다.</p>
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const item = await saveDraft(name.trim(), base.draft); setItems(current => [item, ...current]);
      setNextOffset(offset => offset === null ? null : offset + 1); setRight(item.id); saved(item.name, base.draft); setMessage(`“${item.name}”을 저장했습니다.`);
    }); }}><label>연습본 이름<input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="예: 11월 영어 시간표 A안" /></label>
      <button className="primary" disabled={busy || !name.trim() || !base.draft.placements.length}>새 연습본으로 저장</button></form>
    <small>저장할 때마다 새 연습본을 만듭니다. 이전에 저장한 내용은 그대로 남습니다.</small>
    {error && <p role="alert" className="load-error">{error}</p>}{message && <p role="status" className="clear-check">{message}</p>}
    <h3>저장한 연습본</h3>{busy && <p role="status">연습본을 처리하는 중…</p>}
    {!busy && !items.length && !error && <p>저장한 연습본이 없습니다. 이름을 붙여 첫 연습본을 저장해 보세요.</p>}
    <ul className="draft-list">{items.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>{dateText(item.createdAt)} · 반 {item.classCount}개 · 수업 {item.lessonCount}개 · 학생 {item.studentCount}명</small></div>
      <button disabled={busy} onClick={() => void run(() => open(item.id))}>불러오기<span className="sr-only"> {item.name}</span></button></li>)}</ul>
    <p className="subtle">불러오면 현재 화면이 바뀝니다. 저장하지 않은 편집도 되돌리기로 복구할 수 있습니다.</p>
    {nextOffset !== null && <button disabled={busy} onClick={() => void run(async () => { const data = await listDrafts(nextOffset); setItems(current => [...current, ...data.items.filter(item => !current.some(c => c.id === item.id))]); setNextOffset(data.nextOffset); })}>더 불러오기</button>}
    {error && <button disabled={busy} onClick={() => void run(async () => { const data = await listDrafts(); setItems(data.items); setNextOffset(data.nextOffset); })}>목록 다시 읽기</button>}
    <section className="draft-compare-picker"><h3>두 연습본 비교</h3><div>
      <label>왼쪽<select aria-label="비교할 왼쪽 연습본" value={left} onChange={e => setLeft(e.target.value)} disabled={busy}><option value="current">현재 편집 중</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {dateText(item.createdAt)}</option>)}</select></label>
      <label>오른쪽<select aria-label="비교할 오른쪽 연습본" value={right} onChange={e => setRight(e.target.value)} disabled={busy}><option value="" disabled>연습본 선택</option><option value="current">현재 편집 중</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {dateText(item.createdAt)}</option>)}</select></label></div>
      <button disabled={busy || !right || left === right} onClick={() => void run(async () => { const [a, b] = await Promise.all([compared(left), compared(right)]); compare(a, b); })}>나란히 비교하기</button></section>
    <footer><button onClick={close} disabled={busy}>닫기</button></footer>
  </dialog>;
}
