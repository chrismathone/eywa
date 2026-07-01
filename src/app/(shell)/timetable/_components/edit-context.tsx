"use client";

import { createContext, useContext } from "react";

/** 셀 → 보드로 흐르는 편집 상태. 보드(client)가 제공, ClassCell(client)이 소비. */
export type PendingTarget = { toClassId: string; toClassName: string };

/** 도착 셀에 미리 그릴 전입 예정 학생 1명(출발 반 이름·목적지 등원 요일까지 보여 어디서/어느 요일로 오는지 표시). */
export type IncomingStudent = {
  enrollmentId: string;
  name: string;
  fromClassName: string;
  /** 목적지 등원 요일(드롭한 요일 존) — 전입 예정 미리보기에 [목] 같은 라벨. []=전 요일. */
  attendanceDays?: string[];
};

export interface TimetableEditState {
  editing: boolean;
  /** 편집 모드 토글(툴바 컨트롤이 호출). */
  setEditing: (v: boolean) => void;
  /** enrollmentId → 이 학생이 어디로 이동 예정인지(없으면 이동 없음). 출발 셀이 취소선+→대상 표시에 사용. */
  pending: Map<string, PendingTarget>;
  /** toSlotId(=도착 셀 slot.id, 스케줄 id) → 그 셀로 전입 예정인 학생들. 도착 셀이 초록 미리보기 행으로 표시. */
  incoming: Map<string, IncomingStudent[]>;
  /**
   * 편집 모드에서 학생을 셀(또는 요일 존)로 드롭했을 때 호출(보드의 델타 버퍼에 누적).
   * ⚠️ fromClassId/toClassId는 **실제 반 id**(스케줄 id 아님). toSlotId는 도착 셀 slot.id(마커 키).
   * toDays는 드롭한 요일 존의 등원 요일([]=공통 존=전 요일).
   */
  queueMove: (move: {
    enrollmentId: string;
    fromClassId: string;
    fromClassName: string;
    toClassId: string;
    toClassName: string;
    name: string;
    toSlotId?: string;
    toDays?: string[];
  }) => void;
  /** 압축된 이동 대기 건수. */
  pendingCount: number;
  save: () => void;
  cancel: () => void;
  saving: boolean;
  error: string | null;
  failed: string[];
  /** 이동 적용일(YYYY-MM-DD) — 사용자가 편집 바에서 정한 날짜(예정일). null이면 기본(오늘/조회 주). */
  scheduledDate: string | null;
  setScheduledDate: (d: string | null) => void;
  /** 적용일 입력의 기본·최소값(= 조회 주 기준일 ?? 오늘). 편집 바가 date input 기본값으로 사용. */
  dateFloor: string;
}

const noop = () => {};
export const TimetableEditContext = createContext<TimetableEditState>({
  editing: false,
  setEditing: noop,
  pending: new Map(),
  incoming: new Map(),
  queueMove: noop,
  pendingCount: 0,
  save: noop,
  cancel: noop,
  saving: false,
  error: null,
  failed: [],
  scheduledDate: null,
  setScheduledDate: noop,
  dateFloor: "",
});

export function useTimetableEdit(): TimetableEditState {
  return useContext(TimetableEditContext);
}
