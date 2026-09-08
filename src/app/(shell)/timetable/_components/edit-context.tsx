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

/**
 * 대기 중인 **반 블록 이동** 한 건 — 반 이름 머리를 끌어 격자 칸에 놓았을 때 쌓인다.
 * 🔴 학생 이동과 **같은 규약**: 화면에 표식만 남고, 반영은 '저장'을 눌러야 일어난다(서버 `moveClassSlots`).
 */
export type QueuedClassMove = {
  /** 블록의 기준 배치(스케줄) id — 큐·머리 표식의 키. */
  slotId: string;
  classId: string;
  className: string;
  fromDay: string;
  fromStart: string;
  /**
   * 이 블록이 **함께 옮기는** 배치들과 각자의 도착 자리 — 화면의 한 블록이 실제로는 배치 여러 줄이다
   * (연속 교시·월목 병합). 저장은 이 목록을 그대로 서버에 넘긴다.
   * 🔴 기준 줄만 옮기면 화면은 통째로 간 것처럼 보이는데 나머지 줄이 제자리에 남는다(적대 리뷰 2026-09-04).
   */
  moves: { slotId: string; toDay: string; toStart: string }[];
  /** 기준 줄의 도착 요일(머리 표식용). */
  toDay: string;
  /** 기준 줄의 도착 시작시각(`HH:MM:SS`) — 끝시각은 원래 길이로 서버가 계산한다(시수 보존). */
  toStart: string;
  /** 이 블록이 가는 요일들(중복 없이, 표식이 `→ 화·금 16:20`으로 적는다). */
  toDays: string[];
  /**
   * 큐잉 시점의 적용 **의도**(학생 이동 큐와 같은 앵커) — `null` = 즉시, `'YYYY-MM-DD'` = 그 주 예약.
   * 🔴 없으면 미래 주에서 반만 옮겼을 때 화면은 그 주를 적용일로 보여 주는데 저장은 오늘로 나간다(F2).
   */
  effectiveOn: string | null;
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
  /**
   * 드래그로 옮길 수 있는가 = **편집 권한 + 이번/미래 주**(과거 주는 조회 전용). 옛 '편집 모드' 토글을 대신한다
   * (원장 2026-09-04 *"편집모드 없이 바로 드래그 되도록 하자. 대신 저장을 눌러야 반영"*) — 켜고 끄는 상태가
   * 아니라 **권한의 다른 이름**이라, 화면에 토글이 없다. 반영은 여전히 '저장'을 눌러야 한다(큐 → RPC).
   */
  canDrag: boolean;
  /**
   * 🔴 "지금 끌고 있나"는 **여기 없다** — [`drag-flag.ts`](./drag-flag.ts)의 모듈 플래그 + `body.tt-dragging`
   *    클래스가 나른다. 이 컨텍스트에 넣었더니 집는 **그 순간** 소비처(셀 59 + 줄 350)가 통째로 다시 그려져
   *    **픽업이 멈칫**했다(원장 제보 2026-09-04, CPU 프로파일로 확인 — 상위가 전부 React 커밋이었다).
   */
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
  /** 압축된 이동 대기 건수(학생 + 반). */
  pendingCount: number;
  /** slotId → 그 배치가 갈 곳(대기 중). 셀 머리가 `→ 화 3교시` 표식을 그린다. */
  classMoves: Map<string, QueuedClassMove>;
  /** 반 블록을 격자 칸에 놓았을 때(보드가 호출). 같은 배치를 다시 놓으면 마지막 것만 남는다. */
  queueClassMove: (move: QueuedClassMove) => void;
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
   * 대기 배치의 적용 **앵커**(큐잉 시점 의도). 저장은 "지금 보는 주"가 아니라 이 값을 쓴다 —
   * 큐가 주 이동을 넘어 유지되므로, 저장 시점 화면 기준으로 묶으면 미래주 예약이 오늘자로 적용되거나
   * 즉시 이동이 미래로 예약되는 뒤바뀜이 생긴다(2026-07-17 적대 감사 F2).
   * `null` = 대기 배치 없음 **또는 즉시(이번 주) 의도**(즉시는 날짜로 얼리지 않는다 — 자정을 넘겨
   * 저장해도 서버 current_date로 이동해야 하므로). 구분은 weekMismatch/pendingCount와 함께 읽는다.
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
  canDrag: false,
  classMoves: new Map(),
  queueClassMove: noop,
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
