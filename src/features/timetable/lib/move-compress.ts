// 보류 이동(pending moves) 압축 — 순수 함수. ijw `useStudentDragDrop.ts`의 finalMoves 로직 이식.
// 편집 모드에서 학생(=enrollment)을 여러 번 끌면 A→B→C가 쌓인다. 저장 시 최종 결과만 커밋하도록
// enrollment 단위로 압축한다: 최초 출발지 유지 + 마지막 목적지 채택, 원점 복귀(A→B→A)는 제거.
// aywa의 draggable은 student:enrollmentId 이므로 studentId가 아니라 enrollmentId로 키잉한다.

import { sameDaySet } from "./split-attendance";

export interface PendingMove {
  enrollmentId: string;
  /** 실제 반 id(출발) — no-op(같은 반) 판정용. ⚠️ 스케줄 id 아님(그건 마커 키 toSlotId). */
  fromClassId: string;
  /** 실제 반 id(목적지) — 서버 RPC newClassId. 같은 반이면 요일만 편집(same-class). */
  toClassId: string;
  /** 목적지 셀 slot.id(스케줄 id) — 도착 셀 '전입 예정' 마커 키(incoming). 마커는 셀 단위라 반 id 아님. */
  toSlotId?: string;
  /** 목적지 등원 요일(분리등원) — 요일 존=[그 요일], 공통 존=[](전 요일). */
  toDays?: string[];
  /** 출발 시점 등원 요일 — 같은 반 요일 편집의 no-op(변경 없음) 판정용. */
  fromDays?: string[];
  studentId?: string; // 표시용(서버 RPC가 enrollment에서 직접 도출하므로 로직엔 불필요)
}

/**
 * enrollment별로 순서대로 누적된 이동을 net 이동 하나로 압축.
 * - 최초 fromClassId·fromDays 유지, 마지막 목적지(toClassId·toSlotId·toDays) 채택.
 * - 원점 복귀 제거: 같은 반 **그리고** 같은 요일이면(=변경 없음) 커밋 불필요. ⚠️ 실제 반 id로 비교.
 *   (같은 반이라도 요일이 바뀌면[2일↔1일] 유지 — 같은 반 요일 편집.)
 * 입력 순서를 보존한 배열을 반환한다(결정적).
 */
export function compressMoves(moves: PendingMove[]): PendingMove[] {
  const net = new Map<string, PendingMove>();
  const order: string[] = [];
  for (const m of moves) {
    const existing = net.get(m.enrollmentId);
    if (existing) {
      // 출발지는 최초 유지, 목적지(반·셀·요일)만 마지막 값으로 갱신.
      existing.toClassId = m.toClassId;
      existing.toSlotId = m.toSlotId;
      existing.toDays = m.toDays;
    } else {
      net.set(m.enrollmentId, { ...m });
      order.push(m.enrollmentId);
    }
  }
  return order
    .map((id) => net.get(id)!)
    .filter((m) => m.fromClassId !== m.toClassId || !sameDaySet(m.fromDays, m.toDays));
}
