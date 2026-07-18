"use client";

import { createContext, useContext } from "react";

/** 셀 → 보드로 흐르는 편집 상태. 보드(client)가 제공, ClassCell(client)이 소비. */
export type PendingTarget = {
  toClassId: string;
  toClassName: string;
  /** 목적지 등원 요일 — 같은 반 요일 편집이면 배지 표시용([]=전 요일). */
  toDays?: string[];
  /** 같은 반 요일 편집(반 이동 아님) — true면 이동 화살표 대신 "→요일" 변경 배지. */
  sameClass?: boolean;
};

/** 같은 반 요일 편집 팝오버 대상(편집 모드에서 학생 클릭 시). coveringDays=그 셀이 덮는 요일(월/목 등). */
export type DayEditTarget = {
  enrollmentId: string;
  classId: string;
  slotId: string;
  name: string;
  currentDays: string[];
  coveringDays: string[];
};

/** 마우스 오버 중인 학생(편집 모드 Delete=오늘 수강 종료용). ref로 추적해 hover마다 리렌더 안 함. */
export type HoveredStudent = { enrollmentId: string; studentId: string; name: string; className: string };

/** 합반 드롭 반+요일 선택 팝업의 반 후보(합반 구성 반 + 비활성 사유). */
export type ClassPickCandidate = {
  index: number; // 세그먼트 인덱스(1부터) — 학생 배지와 동일 번호
  classId: string;
  className: string;
  slotId: string; // 그 반 세그먼트의 스케줄 id(전입예정 배지 키)
  /** 드래그 학생이 이미 열린 수강을 가진 반 — 선택 불가("이미 소속"). */
  disabled?: boolean;
};

/** 합반 드롭 → 반+요일 선택 팝업 대상(외부 학생 어디든 / 멤버의 다른 세그먼트 드롭). */
export type ClassPickTarget = {
  enrollmentId: string;
  name: string;
  fromClassId: string;
  fromClassName: string;
  fromDays: string[];
  /** 셀이 덮는 요일(월/목 등) — 요일 토글. 2개 미만이면 요일 선택 숨김(전 요일). */
  coveringDays: string[];
  /** 세그먼트에 드롭했으면 그 반 미리 선택. */
  presetClassId?: string;
  /** 요일 존에 드롭했으면 그 요일만 미리 선택. */
  presetDay?: string;
  candidates: ClassPickCandidate[];
};

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
    fromDays?: string[];
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
  /**
   * 대기 중인 이동이 **만들어진 주**의 적용일. 저장은 "지금 보는 주"가 아니라 이 값을 쓴다 —
   * 큐가 주 이동을 넘어 유지되므로, 저장 시점 화면 기준으로 묶으면 미래주 예약이 오늘자로 적용되거나
   * 즉시 이동이 미래로 예약되는 뒤바뀜이 생긴다(2026-07-17 적대 감사 F2). 큐가 비면 null.
   */
  queueDate: string | null;
  /** 대기 이동이 만들어진 주 ≠ 지금 보는 주 — 편집 바가 경고를 띄우고 새 이동 큐잉을 막는다. */
  weekMismatch: boolean;
  /** 마우스 오버 중인 학생 등록(편집 모드 Delete=오늘 수강 종료). ref 세팅이라 리렌더 없음. null=해제. */
  setHovered: (h: HoveredStudent | null) => void;
  /** 편집 모드에서 학생 클릭 → 같은 반 요일 편집 팝오버 열기. */
  openDayEdit: (t: DayEditTarget) => void;
  /** 합반 드롭 → 반+요일 선택 팝업 열기(외부 학생 어디든 / 멤버의 다른 세그먼트). */
  openClassPick: (t: ClassPickTarget) => void;
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
  queueDate: null,
  weekMismatch: false,
  setHovered: noop,
  openDayEdit: noop,
  openClassPick: noop,
});

export function useTimetableEdit(): TimetableEditState {
  return useContext(TimetableEditContext);
}
