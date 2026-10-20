/**
 * 학생 병합 때 **메이크에듀 원생 번호**(`students.makeedu_id`)를 어떻게 할지 — 순수 판정(Vitest).
 *
 * 🔴 배경(2026-10-20 권민서·김지유): 동기화가 같은 학생을 다른 이름(`권민서B`)으로 한 번 더 만들었고, 데이터 정리에서
 *    `권민서A`(남김) ← `권민서B`(진 쪽)로 병합했다. 그런데 병합이 번호를 옮기지 않아 메이크에듀 연결이 **퇴원 처리된 빈 행**에만
 *    남았다 → 남은 학생은 "메이크에듀 원생 아님"으로 보였다(콜&상담 표식 · 역동기화 대상 판정 · 수납 매칭이 모두 이 번호를 본다).
 *
 *  · `move`     남는 쪽이 비어 있으면 진 쪽 번호를 옮긴다(진 쪽은 비운다 — 번호는 지점 안에서 하나만 쥘 수 있다).
 *  · `keep`     진 쪽에 번호가 없다 — 할 일 없음.
 *  · `conflict` 둘 다 서로 다른 번호 — 메이크에듀에서도 두 원생이다. 옮기지 않고(진 쪽에 남겨 동기화가 다시 만들지 않게)
 *               사람에게 알린다.
 */
export type MakeeduCarry = { kind: "move"; makeeduId: string } | { kind: "keep" } | { kind: "conflict"; mergeeMakeeduId: string };

export function planMakeeduCarry(keeperMakeeduId: string | null | undefined, mergeeMakeeduId: string | null | undefined): MakeeduCarry {
  const k = keeperMakeeduId?.trim() || null;
  const m = mergeeMakeeduId?.trim() || null;
  if (!m || m === k) return { kind: "keep" };
  if (!k) return { kind: "move", makeeduId: m };
  return { kind: "conflict", mergeeMakeeduId: m };
}
