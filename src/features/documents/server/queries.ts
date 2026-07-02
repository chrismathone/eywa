import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_CATEGORIES, type DocumentCategory, type DocumentKind } from "../categories";

// 데이터베이스(서식 저장소) 조회 — tenant 스코프는 RLS가 강제.

export type DocumentRow = {
  id: string;
  title: string;
  category: DocumentCategory;
  kind: DocumentKind;
  formType: string | null; // kind='form'일 때 폼 종류(staff_resume 등)
  description: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
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
  opts: { category?: string; q?: string } = {},
  page = 1,
  pageSize = PAGE,
): Promise<{ rows: DocumentRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let qb = supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_name, file_size, mime_type, pinned, created_at, uploader:uploaded_by(display_name)",
      { count: "exact" },
    );
  if (opts.category && (DOCUMENT_CATEGORIES as readonly string[]).includes(opts.category)) {
    qb = qb.eq("category", opts.category);
  }
  const term = opts.q ? sanitize(opts.q) : "";
  if (term) qb = qb.or(`title.ilike.%${term}%,description.ilike.%${term}%,file_name.ilike.%${term}%`);
  // 고정(pinned) 먼저 → 최신순. (탐색기 상단 고정 = 자주 쓰는 서식)
  qb = qb
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  const { data, count } = await qb;
  const rows: DocumentRow[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category as DocumentCategory,
    kind: r.kind as DocumentKind,
    formType: r.form_type,
    description: r.description,
    fileName: r.file_name,
    fileSize: r.file_size,
    mimeType: r.mime_type,
    uploaderName: uploaderNameOf(r.uploader),
    createdAt: r.created_at,
    pinned: !!r.pinned,
  }));
  return { rows, total: count ?? rows.length };
}

/** 폴더 팬 카운트 — 분류별 + 전체(행 미fetch, count head:true = B2). */
export async function getDocumentCategoryCounts(): Promise<Record<DocumentCategory | "all", number>> {
  const supabase = await createClient();
  const countFor = async (category?: DocumentCategory) => {
    let qb = supabase.from("academy_documents").select("*", { count: "exact", head: true });
    if (category) qb = qb.eq("category", category);
    const { count } = await qb;
    return count ?? 0;
  };
  const [all, ...per] = await Promise.all([countFor(), ...DOCUMENT_CATEGORIES.map((c) => countFor(c))]);
  const out = { all } as Record<DocumentCategory | "all", number>;
  DOCUMENT_CATEGORIES.forEach((c, i) => {
    out[c] = per[i];
  });
  return out;
}

export type DocumentDetail = DocumentRow & { body: string | null; filePath: string | null };

export async function getDocumentById(id: string): Promise<DocumentDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_path, file_name, file_size, mime_type, body, pinned, created_at, uploader:uploaded_by(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    category: data.category as DocumentCategory,
    kind: data.kind as DocumentKind,
    formType: data.form_type,
    description: data.description,
    fileName: data.file_name,
    fileSize: data.file_size,
    mimeType: data.mime_type,
    uploaderName: uploaderNameOf(data.uploader),
    createdAt: data.created_at,
    pinned: !!data.pinned,
    body: data.body,
    filePath: data.file_path,
  };
}
