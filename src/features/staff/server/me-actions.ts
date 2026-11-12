"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { EMAIL_RE } from "@/features/staff/email";
import { EMAIL_TAKEN_MESSAGE, isEmailTakenAuthError } from "@/lib/auth/auth-email-error";
import { isLoginEmailTakenElsewhere } from "./login-email-taken";
import { REPORT_NAME_MAX } from "@/features/onescreen/report-author-name";
import { resolveReportAuthorSettings } from "@/features/onescreen/server/report-author-name";
import { authPasswordErrorMessage } from "@/lib/auth/auth-password-error";

// 본인 계정 자기관리(원장 지시 2026-07-29) — 시트에서 넘어온 임시 로그인 주소로 들어와
// **본인이 직접** 실제 이메일과 비밀번호로 갈아끼운다. 대상은 언제나 로그인한 자기 자신(auth.uid())뿐 —
// id를 폼에서 받지 않는다(받으면 그게 곧 남의 계정 탈취 통로).

export type MeAccountState = { ok?: true; error?: string; notice?: string } | undefined;

const MIN_PASSWORD = 8;

/**
 * 로그인 이메일 변경(본인). auth.users와 public.users를 함께 바꾼다.
 * ⚠️ GoTrue `updateUserById`는 어떤 갱신에서든 `raw_app_meta_data`를 재기록해 미러 트리거를 깨운다([[#70]]).
 * 0075a 하드닝이 '명시 role 없으면 보존'으로 막아주지만, 여기서는 **현재 role을 명시로 함께 넘겨** 확실히 고정한다.
 */
export async function updateMyEmail(_prev: MeAccountState, formData: FormData): Promise<MeAccountState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "이메일을 입력하세요" };
  if (!EMAIL_RE.test(email)) return { error: "이메일 형식이 올바르지 않습니다" };
  if (email === user.email.toLowerCase()) return { error: "지금 쓰는 이메일과 같습니다" };

  const admin = createAdminClient();
  // 같은 학원에 이미 쓰는 사람이 있으면 거부(auth는 전역 유니크라 어차피 실패 — 먼저 한글로 알린다).
  const { data: dup } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", user.tenantId)
    .ilike("email", email)
    .neq("id", user.id)
    .maybeSingle();
  if (dup) return { error: "이미 다른 직원이 쓰고 있는 이메일입니다" };
  // 다른 지점 계정 — 위 검사는 제 지점만 본다. Auth는 변경 경로에서 중복을 500으로만 답해 원인을 말해 주지 않는다.
  if (await isLoginEmailTakenElsewhere(admin, email, user.id)) return { error: EMAIL_TAKEN_MESSAGE };

  const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
    email,
    email_confirm: true, // 학원 내부 계정 — 확인 메일 왕복 없이 즉시 반영(발송 경로 자체가 없음).
    app_metadata: { tenant_id: user.tenantId, system_role: user.systemRole },
  });
  if (authErr) {
    const dup = isEmailTakenAuthError(authErr);
    return { error: dup ? EMAIL_TAKEN_MESSAGE : `이메일 변경 실패 — ${authErr.message}` };
  }
  const { error: dbErr } = await admin.from("users").update({ email }).eq("id", user.id);
  if (dbErr) {
    // auth는 바뀌고 users만 실패 = 로그인은 새 주소, 화면은 옛 주소. 되돌려 한쪽으로 통일한다.
    await admin.auth.admin.updateUserById(user.id, { email: user.email, email_confirm: true });
    return { error: explainDbError(dbErr, { scope: "staff.me.email", fallback: "이메일을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." }).message };
  }

  await logAction({
    action: "self_email_change",
    targetType: "user",
    targetLabel: user.displayName ?? null,
    metadata: { from: user.email, to: email },
  });
  revalidatePath("/me");
  revalidatePath("/staff");
  return { ok: true, notice: `로그인 이메일을 ${email}로 바꿨습니다 — 다음 로그인부터 새 주소를 쓰세요` };
}

/** 비밀번호 변경(본인) — 세션 클라이언트로 바꾼다(관리자 권한 불필요, 자기 세션이 곧 신원). */
export async function updateMyPassword(_prev: MeAccountState, formData: FormData): Promise<MeAccountState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("passwordConfirm") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다` };
  if (password !== confirm) return { error: "비밀번호 확인이 일치하지 않습니다" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authPasswordErrorMessage(error) ?? explainDbError(error, { scope: "staff.me-actions.updateMyPassword", fallback: "비밀번호 변경 실패 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "self_password_change",
    targetType: "user",
    targetLabel: user.displayName ?? null,
    metadata: {},
  });
  return { ok: true, notice: "비밀번호를 바꿨습니다" };
}

/**
 * 수업보고서 발송용 이름 변경(본인, 0217a users.report_display_name) — 학부모에게 나가는 수업보고서
 * (ClassNote 게시 작성자명·/r 공유 카드·인쇄·미리보기)에 실명 대신 이 이름이 표시된다. 빈 값 = 실명 그대로.
 * ⚠️ lesson_reports.teacher_name(저장·귀속 축)은 건드리지 않는다 — 표시 시점 매핑(report-author-name.ts).
 * ⚠️ 같은 표시 이름(display_name)의 직원이 2명 이상이면 매핑이 적용되지 않는다(오표시 방지) — 저장은 되므로
 *    여기서 감지해 안내만 남긴다(막지 않는다 — 동명 정리는 관리자 영역). 판정은 실제 발송이 쓰는
 *    `resolveReportAuthorSettings` **그 함수로** 한다(적대 리뷰 2026-08-18: 별도 eq 조회로 판정하면
 *    실제 매핑 규칙과 갈려 토스트가 거짓말한다 — 단일 소스만이 안 갈린다).
 */
export async function updateMyReportName(_prev: MeAccountState, formData: FormData): Promise<MeAccountState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const raw = String(formData.get("reportName") ?? "").trim();
  if (raw.length > REPORT_NAME_MAX) return { error: `발송용 이름은 ${REPORT_NAME_MAX}자 이하로 입력하세요` };
  const value = raw || null; // 빈 칸 = 해제(실명으로 발송)
  const prefix = formData.get("includeClassName");
  if (prefix !== null && prefix !== "true" && prefix !== "false") return { error: "반명 표시 설정을 확인해 주세요" };
  // 이전 화면에서 저장해도 새 옵션은 보존한다. 새 화면은 두 값을 한 번에 저장한다.
  const includeClassName = prefix === "true";

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ report_display_name: value, ...(prefix !== null ? { report_class_name_prefix: includeClassName } : {}) })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    // 0217a 미적용(컬럼 부재) — 원장이 SQL을 아직 안 돌린 간격(#95). raw 에러 대신 한글 안내.
    if (/report_display_name|report_class_name_prefix/.test(error.message))
      return { error: "이름 설정을 저장할 준비가 되지 않았습니다 — 관리자에게 문의하세요" };
    // raw 원문은 화면 금지(한글 매핑 규약) — 서버 로그로만 남긴다.
    console.warn(JSON.stringify({ level: "warn", scope: "updateMyReportName", message: error.message }));
    return { error: "저장하지 못했습니다 — 잠시 후 다시 시도하세요" };
  }

  // 감사로그와 매핑 확인은 서로 독립(B4) — 병렬. 매핑 확인 = **발송이 실제로 쓰는 해석기**로,
  // "저장은 됐는데 발송엔 안 걸리는" 상태(동명 직원·계정 이름 문제)를 저장 직후 정직하게 알린다.
  const [, resolved] = await Promise.all([
    logAction({
      action: "self_report_name_change",
      targetType: "user",
      targetLabel: user.displayName ?? null,
      metadata: { reportName: value, ...(prefix !== null ? { includeClassName } : {}) },
    }),
    value || includeClassName ? resolveReportAuthorSettings(user.tenantId, user.displayName) : Promise.resolve(null),
  ]);
  revalidatePath("/me");
  revalidatePath("/onescreen");
  const mappingBlocked = resolved && (resolved.name !== value || (includeClassName && !resolved.includeClassName));
  if (includeClassName && !mappingBlocked)
    return { ok: true, notice: "저장했습니다 — 수업의 반명 뒤에 이름이 표시됩니다" };
  if (mappingBlocked)
    return {
      ok: true,
      notice:
        "저장했습니다 — 단, 같은 이름의 직원이 있거나 계정 이름 문제로 발송에는 적용되지 않습니다(실명으로 발송). 관리자에게 문의하세요",
    };
  if (!value) return { ok: true, notice: "발송용 이름을 지웠습니다 — 이제 실명으로 발송됩니다" };
  return { ok: true, notice: `이제 수업보고서가 "${value}" 이름으로 발송됩니다` };
}
