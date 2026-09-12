/** Keep mouse double-click editing; touch, pen, and keyboard activation open the editor once. */
export function isDirectEditClick(event: { detail: number; nativeEvent: Event }): boolean {
  if (event.detail === 0) return true;
  const pointer = (event.nativeEvent as PointerEvent).pointerType;
  if (pointer) return pointer === "touch" || pointer === "pen";
  // Older mobile browsers dispatch MouseEvent for click after a touch.
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
