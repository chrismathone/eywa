import { useRef, type ClipboardEvent } from 'react';
import { reasonOf } from './reason';
import { copyBlocks, moveBlocks, type Position } from './block-commands';
import { lessons, timeLabel, type Lesson } from './model';
import type { DraftStore } from './store';
type Copied = { token: string; entries: Lesson[]; anchor: string; cut: boolean; revision: number; classRevision: number; origin: string };
const mime = 'application/x-aywa-timetable-blocks';
const originOf = (store: DraftStore) => { const { source, originId } = store.getSnapshot().draft; return originId ?? (source ? `${source.tenantId}:${source.loadedAt}` : 'example'); };
export function useBlockClipboard(store: DraftStore, ids: string[], position: Position | null, announce: (s: string) => void) {
  const pending = useRef<Copied | null>(null);
  const copy = (event: ClipboardEvent, cut: boolean) => {
    const { draft, revision } = store.getSnapshot(), entries = lessons(draft).items.filter(p => ids.includes(p.id));
    if (!entries.length) return;
    event.preventDefault();
    pending.current = { token: crypto.randomUUID(), entries: structuredClone(entries), anchor: entries[0].id, cut, revision, classRevision: draft.classRevision ?? 0, origin: originOf(store) };
    event.clipboardData.setData(mime, pending.current.token);
    event.clipboardData.setData('text/plain', entries.map(p => `${p.name}\t${p.day}\t${timeLabel(p.start)}\t${p.teacher}`).join('\n'));
    announce(`${entries.length}개 수업 ${cut ? '잘라내기 준비' : '복사'}. 빈 시간대를 누르고 Ctrl+V로 놓으세요.`);
  };
  const paste = (event: ClipboardEvent) => {
    event.preventDefault(); const data = pending.current;
    if (!data || event.clipboardData.getData(mime) !== data.token) { announce('이 시간표에서 복사한 수업을 붙여넣을 수 있습니다. 기존 시간표는 상단에서 불러오세요.'); return; }
    if (!position) { announce('먼저 붙여넣을 강사의 빈 시간대를 눌러 주세요.'); return; }
    const current = store.getSnapshot();
    if (data.origin !== originOf(store)) { pending.current = null; announce('새 시간표를 불러왔습니다. 복사할 수업을 다시 선택해 주세요.'); return; }
    if (data.classRevision !== (current.draft.classRevision ?? 0)) { pending.current = null; announce('반 이름이나 학생 배정이 바뀌었습니다. 바뀐 수업을 다시 복사해 주세요.'); return; }
    if (data.cut && current.revision !== data.revision) { announce('잘라낸 뒤 시간표가 변경되었습니다. 수업을 다시 선택하세요. 원본은 유지됩니다.'); return; }
    try {
      const next = data.cut ? moveBlocks(current.draft, data.entries.map(p => p.id), data.anchor, position) : copyBlocks(current.draft, data.entries, data.anchor, position);
      store.commit(data.cut ? '수업 이동' : '수업 복사', next);
      if (data.cut) pending.current = null;
      announce(`${data.entries.length}개 수업을 놓았습니다. 충돌 표시를 확인하세요.`);
    } catch (error) { announce(reasonOf(error, '붙여넣을 위치를 확인하세요.')); }
  };
  return { copy, paste, cancel: () => { pending.current = null; } };
}
