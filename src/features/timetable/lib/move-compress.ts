// 보류 이동(pending moves) 압축 — 순수 함수. ijw `useStudentDragDrop.ts`의 finalMoves 로직 이식.
// 편집 모드에서 학생(=enrollment)을 여러 번 끌면 A→B→C가 쌓인다. 저장 시 최종 결과만 커밋하도록
// enrollment 단위로 압축한다: 최초 출발지 유지 + 마지막 목적지 채택, 원점 복귀(A→B→A)는 제거.
// eywa의 draggable은 student:enrollmentId 이므로 studentId가 아니라 enrollmentId로 키잉한다.

export interface PendingMove {
  enrollmentId: string;
  fromClassId: string;
  toClassId: string;
  studentId?: string; // 표시용(서버 RPC가 enrollment에서 직접 도출하므로 로직엔 불필요)
}

/**
 * enrollment별로 순서대로 누적된 이동을 net 이동 하나로 압축.
 * - 최초 fromClassId 유지, 마지막 toClassId 채택.
 * - fromClassId === toClassId(원점 복귀)는 제거(커밋 불필요).
 * 입력 순서를 보존한 배열을 반환한다(결정적).
 */
export function compressMoves(moves: PendingMove[]): PendingMove[] {
  const net = new Map<string, PendingMove>();
  const order: string[] = [];
  for (const m of moves) {
    const existing = net.get(m.enrollmentId);
    if (existing) {
      existing.toClassId = m.toClassId; // 출발지는 최초 유지, 목적지만 갱신
    } else {
      net.set(m.enrollmentId, { ...m });
      order.push(m.enrollmentId);
    }
  }
  return order
    .map((id) => net.get(id)!)
    .filter((m) => m.fromClassId !== m.toClassId);
}
