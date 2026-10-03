/** 면 탭이 넘칠 때 어느 쪽으로 더 있는지. 넘침 여부는 스크롤 위치와 따로 둔다. */
export function faceTabOverflow(scrollWidth: number, clientWidth: number, scrollLeft: number) {
  const overflow = scrollWidth > clientWidth + 1;
  return {
    overflow,
    left: overflow && scrollLeft > 1,
    right: overflow && scrollLeft + clientWidth < scrollWidth - 1,
  };
}

/** 한 번 누를 때 옮길 위치. 끝에서는 더 가지 않는다. */
export function faceTabScrollTo(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  direction: -1 | 1,
) {
  const max = Math.max(0, scrollWidth - clientWidth);
  const step = Math.max(48, clientWidth - 40);
  return Math.min(max, Math.max(0, scrollLeft + direction * step));
}
