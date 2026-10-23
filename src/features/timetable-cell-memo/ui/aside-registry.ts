import type { HoverAside } from "../placement";

/**
 * 시간표 hover 카드 → 칸 메모 레이어 **연결 자리**(문서마다 하나 — 창(iframe)마다 별개다, drag-flag.ts와 같은 이유).
 *
 * 🔑 왜 컨텍스트가 아닌가: 레이어는 표를 감싸지 않고 표 **옆에** 선다(서버가 그린 수천 칸을 클라 경계 안으로 넣지 않으려고).
 *    그래서 칩(`TeacherChip`)은 레이어의 자손이 아니다. 칩은 늘 이 함수를 카드에 넘기고, 레이어가 서 있을 때만 메모가 붙는다 —
 *    레이어가 없는 화면(다른 과목·강사 화면)에선 null이라 카드는 종전 그대로다.
 */
type Provider = (trigger: HTMLElement) => HoverAside | null;
let provider: Provider | null = null;

export function setCellMemoAsideProvider(next: Provider | null, prev?: Provider): void {
  // 내 것을 걷을 때만 걷는다 — 새 레이어가 먼저 자리를 잡았으면 그대로 둔다.
  if (next === null && prev !== undefined && provider !== prev) return;
  provider = next;
}

export function cellMemoAside(trigger: HTMLElement): HoverAside | null {
  return provider ? provider(trigger) : null;
}
