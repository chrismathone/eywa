import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 직원 등록 QR 토큰(원장 지시 2026-08-07 "직원 명부만 나오는 QR로 직원 등록") — **새 테이블·SQL 0**.
// 저장은 academy_documents 재사용(kind='form', form_type='staff_intake_token') — 계약서·수업평가와 같은 규약.
//   form_data = { token, name, active, expiresAt, role, submissionCount }
//   staff_user_id = 만든 사람  → /documents 표면에서 자동 제외(#77 벽 공유), restricted=true
// ⚠️ 학부모 접수(intake_tokens)와 **다른 테이블**을 쓰는 이유: intake_tokens엔 용도(purpose) 컬럼이 없어
//    한 테이블에 섞으면 학부모 폼이 직원 토큰을 열어버린다(컬럼 추가 = SQL, 원장 접근 불가라 보류 중).

export const STAFF_INTAKE_FORM_TYPE = "staff_intake_token";

export type StaffIntakeToken = {
  /** academy_documents.id — 토글·삭제 대상 */
  id: string;
  /** URL에 실리는 공유키 */
  token: string;
  name: string;
  active: boolean;
  /** ISO. 없으면 무기한(생성 시 기본 90일을 넣는다). */
  expiresAt: string | null;
  /** 이 QR로 만들어지는 계정의 시스템 역할(생성 시 확정 — 공개 폼에서 신청자가 고르지 않는다). */
  role: string;
  submissionCount: number;
  createdAt: string;
};

type Raw = { token?: unknown; name?: unknown; active?: unknown; expiresAt?: unknown; role?: unknown; submissionCount?: unknown };

export function parseIntakeToken(id: string, createdAt: string, raw: unknown): StaffIntakeToken | null {
  const d = (raw ?? {}) as Raw;
  const token = typeof d.token === "string" ? d.token : "";
  if (!token) return null;
  return {
    id,
    token,
    name: typeof d.name === "string" && d.name ? d.name : "직원 등록",
    active: d.active !== false,
    expiresAt: typeof d.expiresAt === "string" && d.expiresAt ? d.expiresAt : null,
    role: typeof d.role === "string" && d.role ? d.role : "teacher",
    submissionCount: typeof d.submissionCount === "number" ? d.submissionCount : 0,
    createdAt,
  };
}

/** 만료·비활성 판정(순수) — 화면 뱃지와 공개 페이지 게이트가 같은 기준을 쓰게. */
export function isTokenOpen(t: Pick<StaffIntakeToken, "active" | "expiresAt">, now = new Date()): boolean {
  if (!t.active) return false;
  return !t.expiresAt || new Date(t.expiresAt) > now;
}

/**
 * 공개 페이지용 단건 조회 — **비인증**이라 admin client + token 일치로만 찾는다(RLS 우회, tenant는 행에서 읽음).
 * 토큰 문자열 자체가 자격증명이므로 추측 불가한 랜덤이어야 한다(생성 시 32자 hex).
 */
export async function findIntakeTokenByToken(
  token: string,
): Promise<(StaffIntakeToken & { tenantId: string }) | null> {
  if (!token || token.length < 16) return null;
  const { data } = await createAdminClient()
    .from("academy_documents")
    .select("id, tenant_id, created_at, form_data")
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .eq("form_data->>token", token)
    .maybeSingle();
  if (!data) return null;
  const parsed = parseIntakeToken(data.id as string, data.created_at as string, data.form_data);
  return parsed ? { ...parsed, tenantId: data.tenant_id as string } : null;
}
