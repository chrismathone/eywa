/**
 * 회차 미룸·당김 버튼을 **세울 칸인가** — 순수(Vitest). 주간 시트 표·월간 달력 칸이 같은 함수를 탄다.
 *
 * 원장 2026-10-19 *"계획만 있으면 버튼 숨겨"* — 월간계획(교재 배정에서 계산한 회색 `계획`)만 있고 **실제 줄이
 * 없는 칸**에서 밀면 아직 쓰지도 않은 진도를 옮기는 꼴이다. 그래서 그 칸 **평시** 구획에 뭔가 적힌 줄이 하나라도
 * 있을 때만 세운다. 구분만 고른 빈 줄은 없는 것과 같다(`plan-compare` `hasContent`와 같은 규약).
 * 🔑 버튼은 평시 구획에만 선다(배정·표식이 평시 축뿐) — 내신 줄만 있는 칸도 안 세운다.
 */
type LineLike = {
  termMode: string;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
};

const has = (v: string | null | undefined) => String(v ?? "").trim() !== "";

export function canShiftCell(lines: readonly LineLike[]): boolean {
  return lines.some(
    (l) => l.termMode === "regular" && (has(l.textbook) || has(l.pageRange) || has(l.progress) || has(l.homework)),
  );
}
