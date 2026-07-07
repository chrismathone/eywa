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

/** 이력서 전건(최신순) — 직원 규모 수준이라 소량, 페이지네이션은 호출부 메모리 슬라이스(staff 패턴). */
export async function getStaffResumes(): Promise<ResumeListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploaded_by, uploader:uploaded_by(display_name)")
    .eq("form_type", RESUME_FORM_TYPE)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const d = normalizeResume(r.form_data);
    return {
      id: r.id,
      name: d.personal.name || "(이름 미입력)",
      department: d.contract.department,
      startDate: d.contract.startDate,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      authorName: authorNameOf(r.uploader),
      uploadedBy: (r.uploaded_by as string | null) ?? null,
    };
  });
}

export type ResumeDetail = {
  id: string;
  data: StaffResumeData;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  uploadedBy: string | null; // 작성자 user id — 열람 게이트(작성 본인 = 무비밀번호)에서 사용
};

export async function getStaffResumeById(id: string): Promise<ResumeDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("academy_documents")
    .select("id, form_data, created_at, updated_at, uploaded_by, uploader:uploaded_by(display_name)")
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    data: normalizeResume(data.form_data),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    authorName: authorNameOf(data.uploader),
    uploadedBy: (data.uploaded_by as string | null) ?? null,
  };
}
