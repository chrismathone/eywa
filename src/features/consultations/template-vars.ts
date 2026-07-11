// 상담 양식 치환 태그 — 양식 본문의 {{날짜}}·{{담당}} 등을 실제 값으로 채운다(순수 함수, 서버/클라 공용 + Vitest).
// 양식 적용 시점(상담 등록 폼)에 1회 치환 = 이후엔 일반 편집 텍스트(메이크에듀와 동일: 날짜·상담사 자동 삽입).

export type TemplateVars = {
  date?: string; // 상담 일자 표시 문자열(예: "2026년 07월 11일")
  counselor?: string; // 담당(상담사) 이름
  student?: string; // 학생 이름
  grade?: string; // 학년
};

// 태그 별칭 → 값 키. 같은 값을 여러 한글 표현으로 쓸 수 있게(오타보다 자연어 우선).
const ALIASES: Record<string, keyof TemplateVars> = {
  날짜: "date",
  오늘: "date",
  일자: "date",
  담당: "counselor",
  담당자: "counselor",
  상담사: "counselor",
  학생: "student",
  학생명: "student",
  이름: "student",
  학년: "grade",
};

/** 지원 태그 목록(편집기 힌트·문서용) — 대표 별칭만. */
export const TEMPLATE_VAR_HINTS = ["{{날짜}}", "{{담당}}", "{{학생}}", "{{학년}}"] as const;

/**
 * 본문의 `{{태그}}`를 vars 값으로 치환.
 * - 알려진 태그 + 값 있음 → 값으로 교체
 * - 알려진 태그 + 값 없음(미선택 등) → 빈 문자열로 제거
 * - 알 수 없는 태그 → 원문 그대로 유지(오타를 사용자가 인지하도록)
 */
export function fillTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, rawKey: string) => {
    const key = ALIASES[rawKey.trim()];
    if (!key) return whole; // 미지원 태그는 건드리지 않음
    const val = vars[key];
    return val != null && val !== "" ? val : "";
  });
}

/** 상담 일자 표시 문자열 — "2026년 07월 11일"(메이크에듀 표기 준용). 유효하지 않은 날짜는 빈 문자열. */
export function formatConsultDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}년 ${pad(d.getMonth() + 1)}월 ${pad(d.getDate())}일`;
}
