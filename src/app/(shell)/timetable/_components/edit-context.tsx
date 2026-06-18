"use client";

import { createContext, useContext } from "react";

/** 셀 → 보드로 흐르는 편집 상태. 보드(client)가 제공, ClassCell(client)이 소비. */
export type PendingTarget = { toClassId: string; toClassName: string };

export interface TimetableEditState {
  editing: boolean;
  /** 편집 모드 토글(툴바 컨트롤이 호출). */
  setEditing: (v: boolean) => void;
  /** enrollmentId → 이 학생이 어디로 이동 예정인지(없으면 이동 없음). */
  pending: Map<string, PendingTarget>;
  /** 편집 모드에서 학생을 셀로 드롭했을 때 호출(보드의 델타 버퍼에 누적). */
  queueMove: (move: {
    enrollmentId: string;
    fromClassId: string;
    toClassId: string;
    toClassName: string;
    name: string;
  }) => void;
  /** 압축된 이동 대기 건수. */
  pendingCount: number;
  save: () => void;
  cancel: () => void;
  saving: boolean;
  error: string | null;
  failed: string[];
}

const noop = () => {};
export const TimetableEditContext = createContext<TimetableEditState>({
  editing: false,
  setEditing: noop,
  pending: new Map(),
  queueMove: noop,
  pendingCount: 0,
  save: noop,
  cancel: noop,
  saving: false,
  error: null,
  failed: [],
});

export function useTimetableEdit(): TimetableEditState {
  return useContext(TimetableEditContext);
}
