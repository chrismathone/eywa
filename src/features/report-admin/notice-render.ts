// 공지 개인화 태그 — 순수 모듈(NO "use server"). 서버 액션(저장 렌더)과 클라 컴포저(미리보기)가 **동시 import**하는 단일 소스.
// ⚠️ 오치환=개인정보 사고라 방어를 코드로 못박음: (1) validate/extract/render가 **하나의 토큰 정규식**을 공유(문법 drift 차단),
// (2) 치환은 **함수 replacer**라 값에 $·{{}}가 있어도 리터럴 처리(재주입·$-치환 오염 방지), (3) 미지원 태그는 원문 보존(데이터 날조 금지).
// ⚠️ per-target 렌더는 반드시 resolveNoticeTargets **이후** studentId lookup으로 붙일 것(target↔student 고정). 이 파일은 그 렌더 함수만 제공.
import { schoolGradeLabel } from "@/lib/format/school-grade";

export type NoticeStudent = { name: string; school?: string | null; grade?: string | null };

// 단일 토큰 문법 — {{ 태그 }} (양옆 공백 허용, 중괄호 미포함). extract/validate/render 전부 이 정규식만 쓴다.
const TAG_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

// 지원 태그(v1, 작게 유지 = PII 표면 축소) → resolver. 값 없으면 빈 문자열(빈칸, 날조 금지).
export const KNOWN_NOTICE_TAGS: Record<string, (s: NoticeStudent) => string> = {
  이름: (s) => s.name ?? "",
  학생이름: (s) => s.name ?? "",
  학교: (s) => s.school ?? "",
  학년: (s) => s.grade ?? "",
  학교학년: (s) => schoolGradeLabel(s.school ?? null, s.grade ?? null),
};

// 컴포저 삽입 칩(‘학생이름’은 ‘이름’ 별칭이라 칩에선 제외).
export const NOTICE_TAG_CHIPS: readonly string[] = ["이름", "학교", "학년", "학교학년"];

/** 템플릿의 모든 태그 이름 추출(공백 정규화). */
export function extractNoticeTags(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TAG_RE)) out.push(m[1]!.trim());
  return out;
}

/** 미지원 태그가 있으면 ok:false(발송 전 차단). hasTags=태그 존재 여부(Phase1 게이트·워커 지원 판정용). */
export function validateNoticeTemplate(template: string): { ok: boolean; unknown: string[]; hasTags: boolean } {
  const tags = extractNoticeTags(template);
  const unknown = [...new Set(tags.filter((t) => !(t in KNOWN_NOTICE_TAGS)))];
  return { ok: unknown.length === 0, unknown, hasTags: tags.length > 0 };
}

/**
 * 태그를 학생 값으로 치환한 본문 반환. 함수 replacer라 치환값의 $·{{}}는 리터럴(재주입·$-오염 방지),
 * 한 번만 순회하므로 값 안의 '{{이름}}'이 다시 치환되지 않는다. 미지원 태그는 원문 그대로(검증이 이미 차단).
 */
export function renderNoticeBody(template: string, student: NoticeStudent): string {
  return template.replace(TAG_RE, (whole, rawName: string) => {
    const name = String(rawName).trim();
    const resolver = KNOWN_NOTICE_TAGS[name];
    return resolver ? resolver(student) : whole;
  });
}
