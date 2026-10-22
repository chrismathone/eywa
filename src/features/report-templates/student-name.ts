import { givenNameOf } from "./name-mention";

/** 학부모용 표기만 정리한다. 학생 ID·원본 이름·ClassNote 대상 매칭에는 쓰지 않는다. */
export function parentStudentName(name: string): string {
  return name.trim().replace(/([가-힣])\s*[A-Z]$/, "$1");
}

/** 성을 확실히 분리할 수 있는 한글 이름만 줄인다. 영문·모호한 이름은 전체 이름을 유지한다. */
export function parentStudentGivenName(name: string): string {
  const full = parentStudentName(name);
  return givenNameOf(full) ?? full;
}
