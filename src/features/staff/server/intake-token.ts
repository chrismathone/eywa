import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SystemRole } from "@/lib/permissions";

// 직원 등록 QR 토큰(원장 지시 2026-08-07 "직원 명부만 나오는 QR로 직원 등록") — **새 테이블·SQL 0**.
// 저장은 academy_documents 재사용(kind='form', form_type='staff_intake_token') — 계약서·수업평가와 같은 규약.
//   form_data = { token, name, active, expiresAt, role, submissionCount }
//   staff_user_id = 만든 사람  → /documents 표면에서 자동 제외(#77 벽 공유), restricted=true
// ⚠️ 학부모 접수(intake_tokens)와 **다른 테이블**을 쓰는 이유: intake_tokens엔 용도(purpose) 컬럼이 없어
//    한 테이블에 섞으면 학부모 폼이 직원 토큰을 열어버린다(컬럼 추가 = SQL, 원장 접근 불가라 보류 중).

export const STAFF_INTAKE_FORM_TYPE = "staff_intake_token";

/** QR로 만들어지는 계정의 역할 — 고정. 다른 역할이 필요하면 등록 뒤 직원 상세에서 바꾼다(권한 상승 통로 차단). */
export const STAFF_INTAKE_ROLE: SystemRole = "teacher";

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
  // 🔴 역할은 행에 적힌 값을 **믿지 않고 고정값으로 덮는다**. 이 행이 사는 academy_documents는 학원 구성원이
  //    PostgREST로 직접 insert할 수 있는 표라, 강사·학생이 `{form_type:'staff_intake_token', role:'master'}` 행을
  //    스스로 만들어 원장 계정을 찍어낼 수 있었다(보안 감사 2026-09-29). 만든 사람·restricted 같은 칸도 행에
  //    적힌 값이라 방어가 못 된다 — 역할 고정이 유일한 방어다. (위조 토큰으로는 이제 강사 계정만 생긴다 —
  //    그 표에 대한 insert 자체를 막는 건 RLS 몫.)
  const parsed = parseIntakeToken(data.id as string, data.created_at as string, data.form_data);
  return parsed ? { ...parsed, role: STAFF_INTAKE_ROLE, tenantId: data.tenant_id as string } : null;
}

/**
 * 이 학원의 직원 등록 QR 전부(만든 순). 🔴 인자 tenantId를 그대로 믿으므로 게이트를 지난 서버 코드에서만 부른다.
 * (예전엔 `"use server"` 파일에서 export돼, 액션 ID만 알면 아무 학원의 토큰을 받아 갈 수 있는 모양이었다.)
 */
export async function listStaffIntakeTokens(tenantId: string): Promise<StaffIntakeToken[]> {
  const { data } = await createAdminClient()
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", tenantId)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .order("created_at", { ascending: false })
    .limit(50);
  // 역할은 공개 제출과 같은 고정값으로 보여준다 — 예전에 역할을 골라 만든 QR(매니저 등)도 이제 강사 계정만
  // 만들므로, 행에 적힌 옛 역할을 그대로 띄우면 화면이 거짓말을 한다.
  return (data ?? [])
    .map((r) => parseIntakeToken(r.id as string, r.created_at as string, r.form_data))
    .filter((t): t is StaffIntakeToken => t !== null)
    .map((t) => ({ ...t, role: STAFF_INTAKE_ROLE }));
}
