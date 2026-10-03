/**
 * 화면에 보일 실패 이유. 편집 명령이 일부러 던진 한국어 문장만 그대로 보이고,
 * 그 밖의 오류(네트워크·예상하지 못한 버그의 영문 원문)는 준비한 안내 문구로 바꾼다.
 */
export function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && /[가-힣]/.test(error.message) ? error.message : fallback;
}
