/**
 * 학생상담 분류·대상 라벨 — **코드 고정 도메인 enum**(운영 enum 아님, schema 주석 참조).
 * 목록·상세(consultation-meta.ts)와 감사로그 상세(audit/describe.ts)가 같은 어휘를 쓰도록 단일 소스로 둔다.
 * (CLAUDE.md "화면 파일에 STATUS_META를 새로 만들지 말 것 — 그 축의 단일 소스에 추가한다".)
 *
 * 순수 모듈(서버/클라 공용) — server-only·클라 전용 의존 금지([[#61]]·[[#81]]).
 */
export const CONSULTATION_CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  academic: "학습",
  emotional: "정서",
  career: "진로",
  social: "교우",
  other: "기타",
};

export const CONSULTATION_AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};
