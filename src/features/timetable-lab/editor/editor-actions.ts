import type { Draft } from './model';

export type AddKind = 'lesson' | 'class' | 'block' | 'teacher' | 'student';
/** 추가 창을 어디서 열었는지 — 고른 자리·반을 미리 채운다. */
export type AddSeed = { kind?: AddKind; day?: string; teacher?: string; start?: number; end?: number; classId?: string };
export type ManageTab = 'teachers' | 'students' | 'classes' | 'rooms';
/** `null`은 구분선. */
export type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean; hint?: string } | null;
export type MenuPoint = { clientX: number; clientY: number; preventDefault: () => void };

/** 화면 어디서든 같은 방식으로 편집하게 하는 동작 묶음. App이 만들어 두 뷰·확인 패널·창에 내려 준다. */
export type EditorActions = {
  announce: (text: string) => void;
  /** 변경을 한 번의 되돌리기 단위로 적용한다. 실패하면 이유를 알리고 false. */
  run: (label: string, change: (draft: Draft) => Draft, done?: string) => boolean;
  openAdd: (seed?: AddSeed) => void;
  openManage: (tab: ManageTab) => void;
  openMenu: (at: MenuPoint, title: string, items: MenuItem[]) => void;
  /** 한 학생의 주간 동선을 두 뷰에서 강조한다. null이면 해제. */
  focusStudent: (id: string | null) => void;
  select: (ids: string[]) => void;
  details: () => void;
};
