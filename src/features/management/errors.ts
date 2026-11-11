/**
 * 사람이 읽고 고칠 수 있는 입력·자료 문제(한국어 문구). 경로(route)는 이 오류의 문구만 화면에 돌려주고,
 * 그 밖의 오류(엑셀 라이브러리·DB 원문 등)는 일반 안내로 바꾼다 — 원문 영어 오류를 화면에 내보내지 않는다.
 */
export class ManagementInputError extends Error {}

export function managementErrorMessage(e: unknown, fallback: string): string {
  return e instanceof ManagementInputError ? e.message : fallback;
}
