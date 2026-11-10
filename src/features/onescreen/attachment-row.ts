/**
 * 보고서 첨부의 행 판정 — 순수 함수(수정 계획 P3-O batch D, `use-report-attachments.ts`에서 옮김 · 본문 그대로).
 * 첨부는 보고서 1건(= 반 한 행)에 붙는다 — 서버 호출(발급·등록·지우기·서명)이 모두 같은 과목키·반을 싣는다.
 */
import type { OneScreenStudent } from "./types";

/** 이미지 MIME → 저장 경로 확장자(P2b 첨부). 리사이즈로 포맷 보존되니 원본 파일명 ext보다 type이 정확. */
export function extFromType(type: string): string | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

/** 첨부가 붙을 보고서의 과목 — DB 저장키(subjectKey)로 넘긴다(없으면 라벨·행 이름). */
export function subjectKeyFor(student: OneScreenStudent, subjectName: string): string | undefined {
  const su = student.subjects.find((s) => s.name === subjectName);
  return su?.subjectKey || su?.subjectLabel || su?.name || undefined;
}
// 첨부가 붙을 **행(반)** — 보고서 단위가 반이라(0134a) 과목만 넘기면 정규/특강 중 아무 행에나 붙는다.
export function classIdFor(student: OneScreenStudent, subjectName: string): string | null {
  return student.subjects.find((s) => s.name === subjectName)?.classId ?? null;
}
