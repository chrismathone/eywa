import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DocumentKind } from "../categories";
import { documentOrderSpecs, type DocumentSort } from "../document-sort";
import { hideRestrictedDocuments } from "./restricted";

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
  updatedAt: string;
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
): Promise<{ rows: DocumentRow[]; total: number; /** 조회 실패 — '0건'과 구분해 화면이 알린다(전수 점검 E6). */ failed: boolean }> {
  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  const from = (page - 1) * pageSize;
  let qb = supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_name, file_path, file_size, mime_type, link_url, pinned, created_at, updated_at, uploader:uploaded_by(display_name)",
      { count: "exact" },
    )
    // 직원 연결 문서(이력서·계약서, staff_user_id 有)는 직원관리(4인 게이트) 전용 — 이 탐색기(사무실
    // 전역)에 뜨면 직원관리 잠금이 우회된다(#77, 2026-08-03). 열람·관리는 /staff 상세·이력서 탭에서.
    .is("staff_user_id", null);
  // 제한 문서(환불요청서 계좌 등)는 행위자 역할로 한 번 더 — DB는 실제 로그인 계정 역할로만 거른다(restricted.ts).
  if (hideRestricted) qb = qb.eq("restricted", false);
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
  const { data, count, error } = await qb;
  if (error) {
    console.error("[documents/queries] 문서 목록 조회 실패", error);
    return { rows: [], total: 0, failed: true };
  }
  const rows: DocumentRow[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category as string,
    kind: r.kind as DocumentKind,
    formType: r.form_type,
    description: r.description,
    fileName: r.file_name ?? r.file_path?.split("/").pop() ?? null,
    fileSize: r.file_size,
    mimeType: r.mime_type,
    linkUrl: r.link_url,
    uploaderName: uploaderNameOf(r.uploader),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pinned: !!r.pinned,
  }));
  return { rows, total: count ?? rows.length, failed: false };
}

/**
 * 폴더 건수는 탐색기와 동일한 공개 범위로 집계한다. 분류별 N+1 조회 없이 분류만 페이지 단위로 읽는다.
 * 조회 실패는 null로 반환해 빈 분류(0)와 구분한다.
 */
export async function getDocumentCategoryCounts(): Promise<(Record<string, number> & { all: number }) | null> {
  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  const out: Record<string, number> & { all: number } = { all: 0 };
  // 옛 RPC는 직원 전용 문서를 포함한다. 목록과 같은 RLS·제외 조건으로 분류만 읽는다.
  // PostgREST 반환 상한 때문에 나눠 읽고, 중간 실패 시 부분 합계를 전체처럼 표시하지 않는다.
  const batch = 1000;
  for (let offset = 0; ; offset += batch) {
    // 목록과 같은 공개 범위 — 제한 문서를 목록에서 빼면 폴더 수에서도 뺀다(안 그러면 '3건'인데 2건만 보인다).
    let qb = supabase.from("academy_documents").select("category").is("staff_user_id", null);
    if (hideRestricted) qb = qb.eq("restricted", false);
    const { data, error } = await qb.order("id").range(offset, offset + batch - 1);
    if (error) {
      console.error("[documents/queries] 문서 분류 집계 실패", error);
      return null;
    }
    for (const row of data ?? []) {
      out[row.category] = (out[row.category] ?? 0) + 1;
      out.all++;
    }
    if (!data || data.length < batch) return out;
  }
}

export type DocumentDetail = DocumentRow & { body: string | null; filePath: string | null };

export async function getDocumentById(id: string): Promise<DocumentDetail | null> {
  const [supabase, hideRestricted] = await Promise.all([createClient(), hideRestrictedDocuments()]);
  let qb = supabase
    .from("academy_documents")
    .select(
      "id, title, category, kind, form_type, description, file_path, file_name, file_size, mime_type, link_url, body, pinned, created_at, updated_at, uploader:uploaded_by(display_name)",
    )
    .eq("id", id)
    .is("staff_user_id", null); // 직원 연결 문서는 이 표면에서 제외(#77) — 목록과 같은 벽
  // 제한 문서 — 목록에서 뺀 행은 id로 직접 열어도 없다(목록과 같은 벽, restricted.ts).
  if (hideRestricted) qb = qb.eq("restricted", false);
  const { data } = await qb.maybeSingle();
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
    updatedAt: data.updated_at,
    pinned: !!data.pinned,
    body: data.body,
    filePath: data.file_path,
  };
}
