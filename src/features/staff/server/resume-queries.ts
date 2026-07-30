import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeResume, RESUME_FORM_TYPE, type StaffResumeData } from "../resume";

// 직원 이력서 조회 — tenant 스코프는 RLS, restricted 행 열람은 RLS restrictive(0072a)가
// DB 레벨에서 사무실 역할로 한정(비-사무실 역할은 행 자체가 안 보임).

export type ResumeListRow = {
  id: string;
  name: string;
  department: string;
  startDate: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  uploadedBy: string | null; // 작성자 user id — 목록에서 부서·입사일 마스킹 판정에 사용
};

// PostgREST to-one 임베딩을 supabase-js가 배열로 타이핑하는 경우 대비.
function authorNameOf(u: unknown): string | null {
  const o = Array.isArray(u) ? u[0] : u;
  return (o as { display_name?: string } | null | undefined)?.display_name ?? null;
}

/**
 * 이력서 한 페이지(최신순) + 총건수.
 * - **B2**: 총건수는 `count: "exact"`(무페이징 select 결과의 `.length`가 아님 — 1000행 silent 절단),
 *   페이지는 `.range()`로 **DB에서** 자른다(전 이력서의 form_data=전 직원 PII를 매번 끌어오지 않게).
 * - **B3**: error를 삼키지 말 것(`data ?? []`) — 조회 실패가 "작성된 이력서가 없습니다"로 위장돼
 *   인사 문서가 없다고 단언하는 false-negative가 된다. throw하면 error.tsx가 잡는다.
 */
export async function getStaffResumes(
  page = 1,
  pageSize = 50,
): Promise<{ rows: ResumeListRow[]; total: number }> {
  const supabase = await createClient();
  const from = Math.max(0, (page - 1) * pageSize);
  const { data, error, count } = await supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploaded_by, uploader:uploaded_by(display_name)", {
      count: "exact",
    })
    .eq("form_type", RESUME_FORM_TYPE)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error(`이력서 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []).map((r) => {
    const d = normalizeResume(r.form_data);
    return {
      id: r.id,
      name: d.personal.name || "(이름 미입력)",
      department: d.contract.division, // 2026-07-28 부서 통합 — 근무부서 단일 칸(division)이 부서의 진실

      startDate: d.contract.startDate,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      authorName: authorNameOf(r.uploader),
      uploadedBy: (r.uploaded_by as string | null) ?? null,
    };
  });
  return { rows, total: count ?? rows.length };
}

export type ResumeDetail = {
  id: string;
  data: StaffResumeData;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  uploadedBy: string | null; // 작성자 user id — 열람 게이트(작성 본인 = 무비밀번호)에서 사용
  /** 연결된 직원(users.id) — 열람 게이트 `canViewResume(user, staffUserId)`의 '본인' 판정 기준. */
  staffUserId: string | null;
};

const DETAIL_COLS =
  "id, form_data, created_at, updated_at, uploaded_by, staff_user_id, uploader:uploaded_by(display_name)";

type DetailRow = {
  id: string;
  form_data: unknown;
  created_at: string;
  updated_at: string;
  uploaded_by: string | null;
  staff_user_id: string | null;
  uploader: unknown;
};

function toDetail(r: DetailRow): ResumeDetail {
  return {
    id: r.id,
    data: normalizeResume(r.form_data),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorName: authorNameOf(r.uploader),
    uploadedBy: r.uploaded_by ?? null,
    staffUserId: r.staff_user_id ?? null,
  };
}

/**
 * 직원에게 연결된 이력서(최신 1건) — 직원 상세 '기본정보' 탭이 이력서 내용을 함께 보여줄 때 사용.
 * ⚠️ 호출부가 canViewResume(원장·관리자) 게이트를 먼저 통과해야 한다(민감 정보 — restricted RLS도 이중 방어).
 */
export async function getResumeByStaffUser(userId: string): Promise<ResumeDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .select(DETAIL_COLS)
    .eq("form_type", RESUME_FORM_TYPE)
    .eq("staff_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`이력서 조회 실패: ${error.message}`);
  return data ? toDetail(data as unknown as DetailRow) : null;
}

/** ⚠️ error를 삼키면 조회 실패가 notFound()로 둔갑한다 — 없는 것과 못 읽은 것은 다르다. */
export async function getStaffResumeById(id: string): Promise<ResumeDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .select(DETAIL_COLS)
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .maybeSingle();
  if (error) throw new Error(`이력서 조회 실패: ${error.message}`);
  return data ? toDetail(data as unknown as DetailRow) : null;
}
