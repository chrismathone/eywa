/**
 * 전체 목표 막대 안의 내신기간 조각(원장 2026-10-20 시안 A안 채택 — *"빗금 말고 우리 색깔로 하고 |내신| 이렇게"*).
 * 내신기간 하나를 막대의 세 구간에서 잘라 조각마다 모양을 정한다(순수 함수 — 화면은 그리기만):
 *  · `filled` = 나간 진도(네이비) 위 → 색 없이 흰 `| 내신기간 |`
 *  · `late`   = 밀린 구간(빨강) 위 → 흰 `| 내신기간 |`
 *  · `open`   = 아직 안 온 곳 → 연보라 칠 + 보라 글자
 * 좌표는 막대 %(0~100). 글자는 칸 폭에 맞춰 `내신기간` → `내신` → 없음.
 */
export type ExamBarPart = { left: number; width: number; kind: "filled" | "late" | "open"; label: string };

export function examBarParts(
  exams: readonly { from: string; to: string }[],
  x: (date: string) => number,
  doneX: number | null,
  lateTo: number | null,
): ExamBarPart[] {
  const d = doneX ?? 0;
  const l = lateTo != null && lateTo > d ? lateTo : d;
  const cuts: [number, number, ExamBarPart["kind"]][] = [[0, d, "filled"], [d, l, "late"], [l, 100, "open"]];
  const out: ExamBarPart[] = [];
  for (const p of exams) {
    const a = x(p.from), b = x(p.to);
    for (const [cl, cr, kind] of cuts) {
      const L = Math.max(a, cl), R = Math.min(b, cr);
      if (R - L > 0.15) out.push({ left: L, width: R - L, kind, label: R - L > 4.2 ? "내신기간" : R - L > 2.2 ? "내신" : "" });
    }
  }
  return out;
}
