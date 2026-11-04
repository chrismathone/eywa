import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reasonOf } from './reason';
import { deleteDraft, listDrafts, loadDraft, overwriteDraft, saveDraft, type DraftSummary } from './draft-api';
import type { ComparedDraft } from './comparison-view';
import type { Draft } from './model';
import type { DraftStore } from './store';
type Props = { store: DraftStore; close: () => void; loaded: (name: string, draft: Draft, id: string) => void; saved: (name: string, draft: Draft, id: string) => void;
  /** 지금 편집 중인 저장본 — 있으면 저장의 기본 동작이 덮어쓰기다(저장할 때마다 새 저장본이 쌓이지 않게, 원장 2026-11-02). */ currentId?: string | null;
  /** 적용 대기 목록 — 운영 연결 화면에서만 넘어온다. */ pending?: ReactNode;
  removed?: (id: string) => void; compare: (left: ComparedDraft, right: ComparedDraft) => void };
const dateText = (text: string) => new Date(text).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const draftLabel = (item: DraftSummary) => `${item.name} · 저장자 ${item.createdByName || '정보 없음'} · ${dateText(item.createdAt)}`;
export function DraftLibrary({ store, close, loaded, saved, removed, currentId = null, compare, pending }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), [base] = useState(() => store.getSnapshot());
  const [items, setItems] = useState<DraftSummary[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [name, setName] = useState(`${base.draft.source?.date ?? '영어 시간표'} 연습본`), [left, setLeft] = useState('current'), [right, setRight] = useState('');
  const [asking, setAsking] = useState<{ item: DraftSummary; kind: 'overwrite' | 'delete' } | null>(null);
  const editing = items.find(item => item.id === currentId && item.manageable);
  useEffect(() => {
    dialog.current?.showModal(); const controller = new AbortController();
    listDrafts(0, controller.signal).then(data => { setItems(data.items); setNextOffset(data.nextOffset); setRight(data.items[0]?.id ?? ''); })
      .catch(e => { if (!controller.signal.aborted) setError(reasonOf(e, '저장한 연습본 목록을 읽지 못했습니다. 잠시 후 다시 열어 주세요.')); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(reasonOf(e, '연습본을 확인해 주세요.')); } finally { setBusy(false); }
  }
  async function open(id: string) {
    const value = await loadDraft(id);
    if (store.getSnapshot().revision !== base.revision) throw new Error('편집 내용이 바뀌었습니다. 창을 닫고 다시 열어 주세요.');
    loaded(value.item.name, { ...value.draft, originId: crypto.randomUUID() }, id);
  }
  /** 덮어쓰기·삭제는 되돌릴 수 없어 한 번 더 확인한다. */
  async function confirmed({ item, kind }: NonNullable<typeof asking>) {
    setAsking(null);
    if (kind === 'overwrite') {
      const next = await overwriteDraft(item.id, item.name, base.draft);
      setItems(current => [next, ...current.filter(row => row.id !== next.id)]);
      saved(next.name, base.draft, next.id); setMessage(`“${next.name}”에 덮어썼습니다.`);
      return;
    }
    await deleteDraft(item.id);
    setItems(current => current.filter(row => row.id !== item.id));
    setNextOffset(offset => offset === null ? null : Math.max(0, offset - 1));
    setLeft(value => value === item.id ? 'current' : value); setRight(value => value === item.id ? '' : value);
    removed?.(item.id); setMessage(`“${item.name}”을 삭제했습니다.`);
  }
  async function compared(id: string): Promise<ComparedDraft> {
    if (id === 'current') return { name: '현재 편집 중', draft: base.draft };
    const value = await loadDraft(id); return { name: draftLabel(value.item), draft: value.draft };
  }
  return <dialog ref={dialog} className="lab-modal draft-library" aria-labelledby="library-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="library-title">연습본 저장·불러오기</h2><button onClick={close} disabled={busy} aria-label="연습본 보관함 닫기">×</button></header>
    <p className="subtle">같은 지점에서 저장한 연습본을 함께 불러오고 비교할 수 있습니다. 운영 시간표에는 반영되지 않습니다.</p>
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const item = await saveDraft(name.trim(), base.draft); setItems(current => [item, ...current]);
      setNextOffset(offset => offset === null ? null : offset + 1); setRight(item.id); saved(item.name, base.draft, item.id); setMessage(`“${item.name}”을 저장했습니다.`);
    }); }}><label>연습본 이름<input autoFocus value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="예: 11월 영어 시간표 A안" /></label>
      {editing && <button type="button" className="primary" disabled={busy || !base.draft.placements.length} onClick={() => setAsking({ item: editing, kind: 'overwrite' })}>“{editing.name}”에 덮어쓰기</button>}
      <button className={editing ? undefined : 'primary'} disabled={busy || !name.trim() || !base.draft.placements.length}>새 연습본으로 저장</button></form>
    <small>새 연습본으로 저장하면 이전 저장본은 그대로 남습니다. 덮어쓰기와 삭제는 저장한 사람과 영어 과목 관리자 이상만 할 수 있습니다.</small>
    {error && <p role="alert" className="load-error">{error}</p>}{message && <p role="status" className="clear-check">{message}</p>}
    {asking && <div role="alert" className="draft-confirm"><p>{asking.kind === 'overwrite' ? `“${asking.item.name}”을 지금 화면의 내용으로 덮어씁니다. 이전 내용은 되돌릴 수 없습니다.` : `“${asking.item.name}”을 삭제합니다. 되돌릴 수 없습니다.`}</p>
      <div><button className="primary" disabled={busy} onClick={() => { const target = asking; void run(() => confirmed(target)); }}>{asking.kind === 'overwrite' ? '덮어쓰기 확인' : '삭제 확인'}</button><button disabled={busy} onClick={() => setAsking(null)}>취소</button></div></div>}
    {pending}<h3>지점 공유 연습본</h3>{busy && <p role="status">연습본을 처리하는 중…</p>}
    {!busy && !items.length && !error && <p>이 지점에 저장된 연습본이 없습니다. 이름을 붙여 첫 연습본을 저장해 보세요.</p>}
    <ul className="draft-list">{items.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>저장자 {item.createdByName || '정보 없음'} · <time dateTime={item.createdAt}>{dateText(item.createdAt)}</time></small><small>반 {item.classCount}개 · 수업 {item.lessonCount}개 · 학생 {item.studentCount}명{item.id === currentId ? ' · 지금 편집 중' : ''}</small></div>
      <span className="draft-actions"><button disabled={busy} onClick={() => void run(() => open(item.id))}>불러오기<span className="sr-only"> {draftLabel(item)}</span></button>
        {item.manageable && <button disabled={busy || !base.draft.placements.length} onClick={() => setAsking({ item, kind: 'overwrite' })}>덮어쓰기<span className="sr-only"> {draftLabel(item)}</span></button>}
        {item.manageable && <button disabled={busy} onClick={() => setAsking({ item, kind: 'delete' })}>삭제<span className="sr-only"> {draftLabel(item)}</span></button>}</span></li>)}</ul>
    <p className="subtle">불러오면 현재 화면이 바뀝니다. 저장하지 않은 편집도 되돌리기로 복구할 수 있습니다.</p>
    {nextOffset !== null && <button disabled={busy} onClick={() => void run(async () => { const data = await listDrafts(nextOffset); setItems(current => [...current, ...data.items.filter(item => !current.some(c => c.id === item.id))]); setNextOffset(data.nextOffset); })}>더 불러오기</button>}
    {error && <button disabled={busy} onClick={() => void run(async () => { const data = await listDrafts(); setItems(data.items); setNextOffset(data.nextOffset); })}>목록 다시 읽기</button>}
    <section className="draft-compare-picker"><h3>두 연습본 비교</h3><div>
      <label>왼쪽<select aria-label="비교할 왼쪽 연습본" value={left} onChange={e => setLeft(e.target.value)} disabled={busy}><option value="current">현재 편집 중</option>{items.map(item => <option key={item.id} value={item.id}>{draftLabel(item)}</option>)}</select></label>
      <label>오른쪽<select aria-label="비교할 오른쪽 연습본" value={right} onChange={e => setRight(e.target.value)} disabled={busy}><option value="" disabled>연습본 선택</option><option value="current">현재 편집 중</option>{items.map(item => <option key={item.id} value={item.id}>{draftLabel(item)}</option>)}</select></label></div>
      <button disabled={busy || !right || left === right} onClick={() => void run(async () => { const [a, b] = await Promise.all([compared(left), compared(right)]); compare(a, b); })}>나란히 비교하기</button></section>
    <footer><button onClick={close} disabled={busy}>닫기</button></footer>
  </dialog>;
}
