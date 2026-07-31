import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentKind } from "../categories";
import { documentOrderSpecs, type DocumentSort } from "../document-sort";

// 데이터베이스(서식 저장소) 조회 — tenant 스코프는 RLS가 강제.

export type DocumentRow = {
  id: string;
  /** `document_categories.key` — 0161a부터 학원장이 관리하는 값이라 닫힌 enum이 아니다. */
  category: string;
  title: string;
  kind: DocumentKind;
  formType: string | null; // kind='form'일 때 폼 종류(staff_resume 등)
  description: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  linkUrl: string | null; // kind='link'일 때 외부 문서 주소(구글드라이브 등)
  uploaderName: string | null;
  createdAt: string;
  pinned: boolean;
};

const PAGE = 50;
const sanitize = (q: string) => q.replace(/[%,()*\\]/g, " ").trim();

// PostgREST to-one 임베딩을 supabase-js가 배열로 타이핑하는 경우 대비 — 객체/배열 양쪽 형태 안전 해석.
function uploaderNameOf(u: unknown): string | null {
  const o = Array.isArray(u) ? u[0] : u;
  return (o as { display_name?: string } | null | undefined)?.display_name ?? null;
}

export async function getDocumentsPage(
  opts: { category?: string; q?: string; sort?: DocumentSort } = {},
  page = 1,
  pageSize = PAGE,
): Promise<{ rows: DocumentRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let qb = supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_name, file_size, mime_type, link_url, pinned, created_at, uploader:uploaded_by(display_name)",
      { count: "exact" },
    );
  // 분류 화이트리스트 검증은 호출부(페이지)가 담당 — 분류가 테넌트 데이터라 여기서 닫힌 목록으로
  // 못 거른다. 키가 존재하지 않으면 결과가 0건일 뿐 누출은 없다(RLS가 테넌트 격리).
  if (opts.category) qb = qb.eq("category", opts.category);
  const term = opts.q ? sanitize(opts.q) : "";
  if (term) qb = qb.or(`title.ilike.%${term}%,description.ilike.%${term}%,file_name.ilike.%${term}%`);
  // 정렬은 **서버에서** — 페이지로 끊겨 오므로 화면 정렬은 그 페이지 안에서만 맞는 거짓말이 된다.
  // 기본(정렬 해제)은 고정(자주 쓰는 서식) 먼저 → 최신순. 순서·tiebreak 규칙은 documentOrderSpecs(순수).
  for (const o of documentOrderSpecs(opts.sort ?? null)) {
    qb = qb.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  }
  qb = qb.range(from, from + pageSize - 1);
  const { data, count } = await qb;
  const rows: DocumentRow[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category as string,
    kind: r.kind as DocumentKind,
    formType: r.form_type,
    description: r.description,
    fileName: r.file_name,
    fileSize: r.file_size,
    mimeType: r.mime_type,
    linkUrl: r.link_url,
    uploaderName: uploaderNameOf(r.uploader),
    createdAt: r.created_at,
    pinned: !!r.pinned,
  }));
  return { rows, total: count ?? rows.length };
}

/**
 * 폴더 팬 카운트 — 분류별 + 전체. 분류가 동적이 되면서(0161a) "분류마다 head count"는 N+1이라
 * group-by RPC 1쿼리로(B2, 0039a/0040a 패턴). 문서가 없는 분류는 RPC가 행을 안 주므로 호출부가 0으로 읽는다.
 */
export async function getDocumentCategoryCounts(): Promise<Record<string, number> & { all: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("document_category_counts");
  if (error) {
    // 카운트 실패가 목록 자체를 못 열게 만들면 안 된다 — 0으로 폴백하되 로그는 남긴다.
    console.error("[documents/queries] document_category_counts RPC 오류", error);
    return { all: 0 };
  }
  const out: Record<string, number> & { all: number } = { all: 0 };
  for (const r of (data ?? []) as { category: string; count: number }[]) {
    const n = Number(r.count) || 0;
    out[r.category] = n;
    out.all += n;
  }
  return out;
}

export type DocumentDetail = DocumentRow & { body: string | null; filePath: string | null };

export async function getDocumentById(id: string): Promise<DocumentDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_path, file_name, file_size, mime_type, link_url, body, pinned, created_at, uploader:uploaded_by(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    category: data.category as string,
    kind: data.kind as DocumentKind,
    formType: data.form_type,
    description: data.description,
    fileName: data.file_name,
    fileSize: data.file_size,
    mimeType: data.mime_type,
    linkUrl: data.link_url,
    uploaderName: uploaderNameOf(data.uploader),
    createdAt: data.created_at,
    pinned: !!data.pinned,
    body: data.body,
    filePath: data.file_path,
  };
}
