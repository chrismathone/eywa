"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { logAction } from "@/features/audit/server/log";
import { parseResumeForm, resumeTitle, RESUME_FORM_TYPE } from "../resume";
import { canViewResume, RESUME_LOCKED_MSG } from "./resume-access";
import { getStaffResumeById } from "./resume-queries";
import { appendResumeToRoster } from "./resume-roster-sheet";
import { RESUME_VIEW_COOKIE, RESUME_VIEW_TTL_SEC, signResumeViewToken } from "./resume-view-token";

// 직원 이력서(웹 작성 폼) 변경 액션 — 게이트 2단: ① 역할(canWriteTenant("staff") = 사무실)
// ② 대상 이력서 열람 자격(canViewResume — 작성 본인·원장·재인증 토큰). ②가 없으면 화면에선 잠긴
// 이력서를 서버액션 직접 호출로 덮어쓰기·삭제할 수 있다(2026-07-15 적대검수 실적발).
// 저장소는 academy_documents(kind='form', restricted=true) — 데이터베이스 탐색기에도 같은 행이 보인다.
// restricted 행은 RLS restrictive(0072a)가 DB 레벨에서도 사무실 역할만 통과시킨다.

export type ResumeActionState =
  | {
      ok?: boolean;
      error?: string;
      detail?: string;
      id?: string;
      nonce?: number;
      redirectTo?: string;
      /** 저장은 성공했으나 부가 효과(직원명부 시트 기입)가 실패했을 때의 경고 — 토스트로만 노출. */
      warning?: string;
      /** 부가 효과 성공 안내(시트 기입 완료) — 토스트로만 노출. */
      notice?: string;
    }
  | undefined;

type Gate = { error: string; detail?: string } | { user: CurrentUser };

async function requireStaffWrite(): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" };
  }
  return { user };
}

/**
 * 역할 게이트 + **대상 이력서 열람 자격**까지 — 잠긴 이력서는 수정·삭제도 불가(화면 게이트와 동일 기준).
 * 화면의 `canWrite = canView && canWriteRole`는 렌더용일 뿐이라 서버가 같은 기준을 다시 확인해야 한다.
 */
async function requireResumeAccess(id: string): Promise<Gate> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return gate;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academy_documents")
    .select("uploaded_by")
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "확인"), detail: error.message };
  if (!data) return { error: "이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  if (!(await canViewResume(gate.user, id, (data.uploaded_by as string | null) ?? null))) {
    return { error: RESUME_LOCKED_MSG };
  }
  return { user: gate.user };
}

/** 생성/수정 겸용 — formData에 id가 있으면 해당 이력서 갱신, 없으면 신규 작성. */
export async function saveStaffResume(
  _prev: ResumeActionState,
  formData: FormData,
): Promise<ResumeActionState> {
  const id = String(formData.get("id") ?? "").trim();
  // 수정은 열람 자격까지(잠긴 이력서 덮어쓰기 차단), 생성은 역할만.
  const gate = id ? await requireResumeAccess(id) : await requireStaffWrite();
  if ("error" in gate) return { error: gate.error, detail: gate.detail };

  const data = parseResumeForm(formData);
  if (!data.personal.name) return { error: "성명을 입력하세요" };

  const supabase = await createClient();

  if (id) {
    const { data: updated, error } = await supabase
      .from("academy_documents")
      .update({
        title: resumeTitle(data),
        form_data: data,
        restricted: true, // 매 저장마다 재확인 — 어떤 경로로든 false로 뒤집힌 행이 평문 노출되지 않게.
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("form_type", RESUME_FORM_TYPE)
      .select("id"); // ⚠️ select 없으면 **0행 매칭도 error:null** → "저장됨"인데 아무것도 안 바뀜.
    if (error) return { error: humanizeDbError(error.message, "저장"), detail: error.message };
    if (!updated?.length) {
      return {
        error: "이력서를 찾을 수 없습니다 — 다른 사람이 삭제했을 수 있습니다. 입력한 내용을 복사해 두고 새로 작성하세요",
      };
    }
    revalidateResume(id);
    return { ok: true, id, nonce: Date.now(), redirectTo: `/staff/resumes/${id}` };
  }

  const { data: row, error } = await supabase
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: resumeTitle(data),
      category: "hr",
      kind: "form",
      form_type: RESUME_FORM_TYPE,
      form_data: data,
      restricted: true, // 주민번호·급여 포함 → 사무실 전용 열람
      description: "직원 이력서 (웹 작성)",
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { error: humanizeDbError(error?.message, "저장"), detail: error?.message };
  // 신규 작성만 "신규 직원명부" 구글시트에 한 행 기입(수정 저장은 재기입하지 않음 — 중복 행 방지).
  // 실패해도 이력서 저장은 유효 — 경고 토스트만(시트 공유·env 미설정 등은 운영자가 조치).
  const roster = await appendResumeToRoster(data);
  revalidateResume(row.id);
  return {
    ok: true,
    id: row.id,
    nonce: Date.now(),
    redirectTo: `/staff/resumes/${row.id}`,
    // env 미설정(의도적 비활성)은 skipped — 토스트 없음(거짓 '실패' 경고 금지).
    ...(roster.ok
      ? roster.skipped
        ? {}
        : { notice: "'신규 직원명부' 구글시트에도 기입했습니다" }
      : { warning: `이력서는 저장됐지만 직원명부 시트 기입에 실패했습니다 — ${roster.error}` }),
  };
}

export async function deleteStaffResume(
  id: string,
): Promise<{ ok?: boolean; error?: string; detail?: string }> {
  const gate = await requireResumeAccess(id); // 잠긴 이력서는 삭제도 불가
  if ("error" in gate) return { error: gate.error, detail: gate.detail };

  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("academy_documents")
    .delete()
    .eq("id", id)
    .eq("form_type", RESUME_FORM_TYPE)
    .select("id"); // ⚠️ select 없으면 0행 삭제도 성공으로 보고된다.
  if (error) return { error: humanizeDbError(error.message, "삭제"), detail: error.message };
  if (!deleted?.length) return { error: "이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  revalidateResume(id);
  return { ok: true };
}

function revalidateResume(id: string) {
  revalidatePath("/staff");
  revalidatePath(`/staff/resumes/${id}`);
  revalidatePath("/documents"); // 같은 행이 데이터베이스 탐색기에도 노출
}

export type ResumeUnlockState = { ok?: boolean; error?: string; nonce?: number } | undefined;

/**
 * 이력서 열람 잠금 해제 — 본인 재인증(step-up). 작성자·원장이 아닌 사무실 직원이 다른 사람 이력서를
 * 열람하려 할 때, **자신의 로그인 비밀번호**를 재입력해 10분 열람 창(서명 쿠키)을 얻는다.
 * ⚠️ 세션 비파괴: 쿠키를 저장하지 않는 격리 클라이언트로 signInWithPassword만 수행 → 현재 로그인
 *    세션(쿠키)은 건드리지 않는다(#10 재로그아웃 루프 회피). 성공/실패 모두 그 클라이언트는 버린다.
 */
export async function unlockResumeView(
  _prev: ResumeUnlockState,
  formData: FormData,
): Promise<ResumeUnlockState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 사무실 역할만(비-사무실은 RLS로 애초에 이력서가 안 보임 — 여기서도 이중 방어).
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원관리 권한이 없습니다" };
  }
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "비밀번호를 입력하세요" };
  const resumeId = String(formData.get("id") ?? "").trim();
  if (!resumeId) return { error: "이력서 정보가 없습니다" };
  // 감사로그에 **대상**(누구 이력서인지)을 남기기 위해 미리 조회 — 없는 id면 재인증 자체가 무의미.
  const target = await getStaffResumeById(resumeId);
  if (!target) return { error: "이력서를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };

  // 격리 클라이언트: persistSession=false → 응답 쿠키를 안 쓴다(현재 세션 무손상). anon 키로 password grant만.
  const verifier = createRawClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await verifier.auth.signInWithPassword({ email: user.email, password });
  if (error) return { error: "비밀번호가 일치하지 않습니다" };

  // 이 이력서 전용 토큰 — 다른 이력서는 다시 재인증 필요(한 번에 전 직원 PII 훑기 차단).
  const jar = await cookies();
  jar.set(RESUME_VIEW_COOKIE, signResumeViewToken(user.id, resumeId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RESUME_VIEW_TTL_SEC,
  });
  // 누가 언제 **누구** 이력서의 잠금을 풀었는지 감사로그(개인 계정 자책 방지 = 재인증의 핵심 가치).
  // ⚠️ actor(푼 사람)는 logAction이 actor_id/actor_name으로 자동 기록한다 — targetLabel엔 **대상**을 넣을 것.
  //    여기에 actor를 넣으면 "누구 이력서를 열었나"가 로그에서 통째로 사라진다(2026-07-15 실적발).
  await logAction({
    action: "resume_view_unlock",
    targetType: "staff_resume",
    targetLabel: target.data.personal.name || "(이름 미입력)",
    metadata: { resumeId },
  });
  return { ok: true, nonce: Date.now() };
}
