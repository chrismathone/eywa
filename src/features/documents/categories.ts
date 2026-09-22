// 데이터베이스(서식 저장소) 공유 상수 — 클라/서버 공용, ⚠️ server-only 금지 [[#61]].
//
// ⚠️ 분류는 더 이상 코드 고정이 아니다(0161a) — 학원장이 추가·이름변경·순서변경·삭제하는 **테넌트 데이터**
// (`document_categories`)다. 여기 있는 SYSTEM_* 상수는 ① 새 테넌트 시드 기본값 ② DB를 못 읽었을 때의
// 폴백 ③ 삭제된 분류 키의 표시 라벨 폴백 — 세 가지 용도뿐이다.
// 🔴 화면·필터·선택지(consumer)는 **DB에서 읽은 분류 목록**을 써야 한다. 여기 배열을 다시 선택지로 쓰면
//    학원장이 추가한 "기출시험"이 드롭다운에서 통째로 사라진다(운영 enum 하드코딩 금지와 같은 원칙).
//    서버 = `getDocumentCategories()`, 화면 = 서버가 내려준 `categories` prop.

/** 0067a 기본 분류 — 0161a가 전 테넌트에 `is_system=true`로 시드한 것과 같은 키·라벨·순서. */
export const SYSTEM_DOCUMENT_CATEGORIES = [
  { key: "enrollment", label: "등록·입학", sortOrder: 10 },
  { key: "billing", label: "수납·결제", sortOrder: 20 },
  { key: "consultation", label: "상담", sortOrder: 30 },
  { key: "hr", label: "인사·직원", sortOrder: 40 },
  { key: "class", label: "수업", sortOrder: 50 },
  { key: "other", label: "기타", sortOrder: 60 },
] as const;

/** 폴백 분류 키 — 항상 존재한다(시스템 분류라 삭제 불가). */
export const FALLBACK_CATEGORY = "other";

/** 화면이 다루는 분류 1건. DB `document_categories` 행의 표시용 투영. */
export type DocumentCategoryOption = {
  key: string;
  label: string;
  isSystem: boolean;
  /** null/미지정 = 최상위. 문서의 category 키는 위치를 바꿔도 유지한다. */
  parentKey?: string | null;
};

/** 시드/폴백용 기본 목록 — DB가 비었을 때만 쓴다. */
export const SYSTEM_CATEGORY_OPTIONS: DocumentCategoryOption[] = SYSTEM_DOCUMENT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  isSystem: true,
}));

/**
 * 분류 키 → 표시 라벨. 목록에 없는 키(삭제된 분류의 잔여 행 등)는 시스템 라벨 → 키 순으로 폴백한다.
 * ⚠️ raw 키를 그대로 화면에 흘리지 않기 위한 마지막 방어 — 알 수 없는 키는 "미분류"로 보여준다.
 */
export function categoryLabelOf(options: DocumentCategoryOption[], key: string): string {
  const hit = options.find((o) => o.key === key);
  if (hit) return hit.label;
  const sys = SYSTEM_DOCUMENT_CATEGORIES.find((c) => c.key === key);
  return sys?.label ?? "미분류";
}

/** 폼 `<select>`용 옵션 변환. */
export function categorySelectOptions(options: DocumentCategoryOption[]): { value: string; label: string }[] {
  return flattenCategories(options).map(({ category, path }) => ({ value: category.key, label: path.map((c) => c.label).join(" / ") }));
}

/** 임의 깊이의 폴더를 순회한다. 오래된 캐시나 잘못된 데이터도 무한 순회하지 않는다. */
export function flattenCategories(options: DocumentCategoryOption[]): {
  category: DocumentCategoryOption; depth: number; path: DocumentCategoryOption[];
}[] {
  const byKey = new Map(options.map((c) => [c.key, c]));
  const children = new Map<string | null, DocumentCategoryOption[]>();
  for (const category of options) {
    const parent = category.parentKey && byKey.has(category.parentKey) ? category.parentKey : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(category);
    children.set(parent, siblings);
  }
  const result: { category: DocumentCategoryOption; depth: number; path: DocumentCategoryOption[] }[] = [];
  const visited = new Set<string>();
  const append = (roots: DocumentCategoryOption[]) => {
    const stack = [...roots].reverse().map((category) => ({ category, path: [] as DocumentCategoryOption[] }));
    while (stack.length) {
      const { category, path } = stack.pop()!;
      if (visited.has(category.key)) continue;
      visited.add(category.key);
      const next = [...path, category];
      result.push({ category, depth: path.length, path: next });
      for (const child of [...(children.get(category.key) ?? [])].reverse()) stack.push({ category: child, path: next });
    }
  };
  append(children.get(null) ?? []);
  // DB 제약 도입 전 잘못된 자료도 화면에서 사라지지는 않게 한다.
  append(options.filter((c) => !visited.has(c.key)));
  return result;
}

export function categoryPath(options: DocumentCategoryOption[], key: string): DocumentCategoryOption[] {
  const byKey = new Map(options.map((c) => [c.key, c]));
  const path: DocumentCategoryOption[] = [];
  const seen = new Set<string>();
  let current = byKey.get(key);
  while (current && !seen.has(current.key)) {
    seen.add(current.key);
    path.push(current);
    current = current.parentKey ? byKey.get(current.parentKey) : undefined;
  }
  return path.reverse();
}

export function categoryPathLabel(options: DocumentCategoryOption[], key: string): string {
  return categoryPath(options, key).map((c) => c.label).join(" / ") || categoryLabelOf(options, key);
}

/** 자신과 하위 폴더를 이동 목적지에서 제외한다(서버·DB에서도 다시 검증). */
export function categoryDescendants(options: DocumentCategoryOption[], key: string): Set<string> {
  const descendants = new Set([key]);
  const children = new Map<string, string[]>();
  for (const c of options) if (c.parentKey) children.set(c.parentKey, [...(children.get(c.parentKey) ?? []), c.key]);
  const queue = [key];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
    if (!descendants.has(child)) { descendants.add(child); queue.push(child); }
  }
  return descendants;
}

export function categoryTreeCounts(options: DocumentCategoryOption[], counts: Record<string, number>): Record<string, number> {
  const totals = { ...counts };
  for (const { category } of flattenCategories(options).reverse()) {
    const parent = category.parentKey;
    if (parent && parent !== category.key) totals[parent] = (totals[parent] ?? 0) + (totals[category.key] ?? 0);
  }
  return totals;
}

/**
 * 새 사용자 분류의 내부 키를 확정한다 — 학원장은 **이름만** 입력하고 키는 앱이 정한다(과목 `subject_N` 선례).
 * 키를 사람이 편집하게 두면 이름을 바꿀 때마다 기존 문서의 category 값이 고아가 된다.
 * `cat_` 접두사는 시스템 키(enrollment…) 및 연동 폴더 키(textbooks·quotes)와의 충돌을 구조적으로 막는다 —
 * 충돌하면 같은 `?cat=` 네임스페이스에서 연동 폴더가 먼저 이겨 조용히 엉뚱한 폴더가 열린다.
 */
export function nextCategoryKey(existingKeys: string[]): string {
  const used = new Set(existingKeys);
  let n = existingKeys.length + 1;
  while (used.has(`cat_${n}`)) n += 1;
  return `cat_${n}`;
}

export type DocumentKind = "file" | "text" | "form" | "link";

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
  linkUrl?: string | null,
): string {
  if (kind === "form") return FORM_TYPE_LABEL[formType ?? ""] ?? "작성 서식";
  if (kind === "link") return linkServiceLabel(linkUrl);
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

// ── 링크 문서(kind='link', 0161a) ───────────────────────────────────────────
// 이미 구글드라이브·노션 등에 있는 문서를 **재업로드 없이** 목록에 올린다. 사본을 만들지 않으므로
// 원본이 옮겨지거나 권한이 바뀌면 링크는 대상 서비스가 판단한다(우리가 유효성을 보증하지 않는다).

/**
 * 사용자가 붙여넣은 링크를 정규화한다. 스킴이 없으면 https를 붙이고, http(s)가 아니면 거부.
 * ⚠️ `javascript:`·`data:` 스킴을 반드시 막아야 한다 — 목록의 링크는 클릭 가능한 앵커가 되므로
 *    그대로 통과시키면 저장된 XSS가 된다.
 */
export function normalizeLinkUrl(raw: string): { url: string } | { error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { error: "링크 주소를 입력하세요" };
  // 스킴이 이미 있는데 http(s)가 아니면(javascript:, data:, file: …) 여기서 잘라낸다.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    return { error: "http:// 또는 https:// 로 시작하는 주소만 등록할 수 있습니다" };
  }
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: "주소 형식이 올바르지 않습니다 — 브라우저 주소창의 링크를 그대로 붙여넣어 주세요" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "http:// 또는 https:// 로 시작하는 주소만 등록할 수 있습니다" };
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { error: "주소 형식이 올바르지 않습니다 — 브라우저 주소창의 링크를 그대로 붙여넣어 주세요" };
  }
  return { url: parsed.toString() };
}

/** 링크 대상 서비스 표시 이름(탐색기 '유형' 컬럼) — 구글드라이브 계열은 문서 종류까지 구분. */
export function linkServiceLabel(url: string | null | undefined): string {
  if (!url) return "링크";
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return "링크";
  }
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "구글 문서";
    if (path.startsWith("/spreadsheets")) return "구글 시트";
    if (path.startsWith("/presentation")) return "구글 슬라이드";
    if (path.startsWith("/forms")) return "구글 폼";
    return "구글 문서";
  }
  if (host === "drive.google.com") return "구글 드라이브";
  if (host.endsWith("sheets.google.com")) return "구글 시트";
  if (host.endsWith("notion.so") || host.endsWith("notion.site")) return "노션";
  if (host.endsWith("dropbox.com")) return "드롭박스";
  if (host.endsWith("1drv.ms") || host.endsWith("sharepoint.com") || host.endsWith("onedrive.live.com")) {
    return "원드라이브";
  }
  if (host.endsWith("naver.com")) return "네이버";
  return "웹 링크";
}

/** 링크의 사람이 읽는 위치 표기(상세 화면 보조 설명) — "drive.google.com" 같은 호스트만. */
export function linkHostLabel(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
