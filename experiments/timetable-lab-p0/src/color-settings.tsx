import { useSyncExternalStore } from 'react';
import { appearanceOf, setPracticeColor, subjectTone, teacherTone } from './appearance';
import type { Lesson } from './model';
import type { DraftStore } from './store';
function colorInputValue(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{8}$/i.test(value)) {
    const alpha = parseInt(value.slice(7), 16) / 255;
    return '#' + [1, 3, 5].map(at => Math.round(parseInt(value.slice(at, at + 2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  }
  return '#ffffff';
}
export function ColorSettings({ store, item, announce }: { store: DraftStore; item: Lesson; announce: (message: string) => void }) {
  const { draft, revision } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const colors = [teacherTone(draft, item.teacher), draft.classes?.[item.classId]?.color ?? subjectTone(draft)];
  return <details className="practice-colors"><summary>색상 설정</summary>
    <p className="subtle">연습안의 두 뷰에 함께 적용됩니다.</p>
    {(['teacher', 'class'] as const).filter(target => target === 'teacher' ? item.kind !== 'seat' : !!item.classId).map(target => {
      const color = colors[target === 'teacher' ? 0 : 1];
      return <form key={`${target}-${revision}`} aria-label={`${target === 'teacher' ? '강사' : '수업'} 색상`} onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget);
        store.commit('연습 색상 변경', setPracticeColor(draft, target, target === 'teacher' ? item.teacher : item.classId,
          { bg: String(values.get('bg')), text: String(values.get('text')) })); announce('연습 색상을 바꿨습니다. Ctrl+Z로 되돌릴 수 있습니다.');
      }}><b>{target === 'teacher' ? `${item.teacher} 강사색` : '수업명 색상'}</b>
        <label>배경<input type="color" name="bg" defaultValue={colorInputValue(color.bg)} /></label>
        <label>글자<input type="color" name="text" defaultValue={colorInputValue(color.text)} /></label><button>색상 적용</button>
      </form>;
    })}
    {appearanceOf(draft).hideStudents && <p className="subtle">불러온 보기 설정에서 학생 명단이 접혀 있습니다.</p>}
  </details>;
}
