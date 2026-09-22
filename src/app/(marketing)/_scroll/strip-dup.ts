/**
 * 화면 스트립 무한 루프용 **두 번째 벌** 표식. 띠는 같은 카드 두 벌을 이어 붙이고 반만큼 밀어 끊김 없이 돈다.
 * 두 번째 벌은 읽기 도구에 두 번 읽히지 않게 `aria-hidden`이고, 움직임이 없을 때(JS 전·움직임 줄이기)는 CSS가 감춘다.
 */
export function dupProps(dup: boolean) {
  return dup ? { "aria-hidden": true as const, "data-dup": "" } : {};
}
