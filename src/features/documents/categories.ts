// 데이터베이스(서식 저장소) 공유 상수 — 클라/서버 공용, ⚠️ server-only 금지 [[#61]].
// 분류는 DB enum(academy_document_category, 0067a)과 1:1 — 시스템 분류(운영 enum 아님·코드 고정).

export const DOCUMENT_CATEGORIES = [
  "enrollment",
  "billing",
  "consultation",
  "hr",
  "class",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  enrollment: "등록·입학",
  billing: "수납·결제",
  consultation: "상담",
  hr: "인사·직원",
  class: "수업",
  other: "기타",
};

export type DocumentKind = "file" | "text" | "form";

/** 폼 문서(form_type) → 표시 라벨. 새 폼 종류를 추가하면 여기에 등록. */
export const FORM_TYPE_LABEL: Record<string, string> = {
  staff_resume: "이력서",
  refund_request: "환불 요청서",
};

/** 폼 문서 전용 뷰 라우트 — 탐색기(목록·상세)가 폼 행을 이 경로로 연다. 새 폼 종류 추가 시 등록. */
export function formViewHref(formType: string | null | undefined, id: string): string {
  if (formType === "refund_request") return `/billing/refunds/${id}`;
  return `/staff/resumes/${id}`; // staff_resume + 미등록 폴백(기존 동작 보존)
}

/** 파일 확장자 → 표시용 종류 라벨(탐색기 '유형' 컬럼). */
export function fileTypeLabel(
  kind: DocumentKind,
  fileName: string | null,
  mimeType: string | null,
  formType?: string | null,
): string {
  if (kind === "form") return FORM_TYPE_LABEL[formType ?? ""] ?? "작성 서식";
  if (kind === "text") return "문서";
  const ext = (fileName?.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "doc" || ext === "docx") return "Word";
  if (ext === "xls" || ext === "xlsx") return "Excel";
  if (ext === "hwp" || ext === "hwpx") return "한글";
  if (mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "이미지";
  return ext ? ext.toUpperCase() : "파일";
}

/** 웹 미리보기 가능 유형 — 이미지/PDF=브라우저 네이티브, Word/Excel=MS Office 온라인 뷰어. HWP·기타=불가. */
export function isPreviewableType(typeLabel: string): boolean {
  return typeLabel === "이미지" || typeLabel === "PDF" || typeLabel === "Word" || typeLabel === "Excel";
}

/** 바이트 → 탐색기식 크기 표기("12.3KB"·"1.2MB"). */
export function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
