"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { phoneLabel } from "@/lib/format/phone";
import { autoStaffEmail, EMAIL_RE } from "@/features/staff/email";
import { subjectsFromDepartment } from "../../department/department-subjects";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { INITIAL_STAFF_PASSWORD, parseResumeForm, resumeTitle, RESUME_FORM_TYPE } from "../../resume/resume";
import { findIntakeTokenByToken, isTokenOpen, STAFF_INTAKE_FORM_TYPE } from "./intake-token";
import { logDbError } from "@/lib/supabase/db-error";

// 직원 등록 QR 공개 제출(원장 지시 2026-08-07) — **비인증**. 게이트는 오직 토큰이다:
// 유효·활성·미만료 토큰이어야 하고, 역할은 토큰에 박힌 값을 쓴다(신청자가 못 고른다 = 권한 상승 차단).
// 원장 결정: **제출 즉시 계정까지 생성**(대기 승인 없음). 그래서 토큰은 쓸 때만 열고 끄는 운영이 전제다.
//
// ⚠️ 로그인 세션이 없으므로 createClient(RLS)를 못 쓴다 — admin client + **행마다 tenant_id 명시**가 격리의 전부.
// ⚠️ 남용 방어: 토큰당 제출 상한(MAX_SUBMISSIONS) + 같은 이름 재제출 차단(중복 계정 폭탄 방지).

const MAX_SUBMISSIONS = 100;

// 반환 타입은 **ResumeActionState와 호환**이어야 한다 — 같은 서식(ResumeSheet)에 액션만 갈아끼우기 때문.
// (nonce = 성공 1회 확정 신호. 이게 없으면 서식이 완료 처리를 못 한다.)
export type PublicStaffIntakeState =
  | { ok?: boolean; error?: string; nonce?: number; notice?: string }
  | undefined;

export async function submitPublicStaffIntake(
  _prev: PublicStaffIntakeState,
  formData: FormData,
): Promise<PublicStaffIntakeState> {
  const token = String(formData.get("intake_token") ?? "").trim();
  const tok = await findIntakeTokenByToken(token);
  if (!tok) return { error: "유효하지 않은 등록 링크입니다" };
  if (!isTokenOpen(tok)) return { error: "종료되었거나 기간이 만료된 등록 링크입니다" };
  if (tok.submissionCount >= MAX_SUBMISSIONS) {
    return { error: "이 링크의 등록 한도를 넘었습니다 — 학원에 문의해 주세요" };
  }

  const data = parseResumeForm(formData);
  if (!data.personal.name) return { error: "성명을 입력하세요" };
  // 공개 폼이라 사진 첨부는 받지 않는다(티켓 발급이 인증 경로) — 넘어온 경로가 있어도 버린다.
  data.photos = [];

  const admin = createAdminClient();

  // 같은 이름이 이미 재직 중이면 중단 — 공개 링크로 같은 사람이 여러 번 눌러 계정이 쌓이는 것을 막는다.
  // (동명이인은 사무실이 직원관리에서 직접 등록 — 공개 경로에서 자동 판별할 방법이 없다.)
  const { data: sameName } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tok.tenantId)
    .eq("display_name", data.personal.name)
    .neq("status", "inactive")
    .maybeSingle();
  if (sameName) {
    return { error: "이미 등록된 이름입니다 — 학원에 문의해 주세요" };
  }

  // 로그인 이메일 — 적었으면 그것, 없으면 이름 이니셜로 자동 생성(원장 지시: 이메일·비번 자동).
  let email = data.personal.email.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    const taken = new Set<string>();
    const { data: rows } = await admin.from("users").select("email").eq("tenant_id", tok.tenantId).limit(2000);
    for (const u of rows ?? []) if (u.email) taken.add(String(u.email).toLowerCase());
    for (let page = 1; page <= 10; page++) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const users = list?.users ?? [];
      for (const u of users) if (u.email) taken.add(u.email.toLowerCase());
      if (users.length < 200) break;
    }
    const made = autoStaffEmail(data.personal.name, taken);
    if (!made) return { error: "등록 처리에 실패했습니다 — 학원에 문의해 주세요" };
    email = made;
    data.personal.email = made;
  }

  // 1) 이력서 문서 저장(restricted — 사무실 전용 열람)
  const { data: doc, error: docErr } = await admin
    .from("academy_documents")
    .insert({
      tenant_id: tok.tenantId,
      title: resumeTitle(data),
      category: "hr",
      kind: "form",
      form_type: RESUME_FORM_TYPE,
      form_data: data,
      restricted: true,
      description: `직원 등록 QR (${tok.name})`,
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    logDbError(docErr, "staff.submitPublicStaffIntake");
    return { error: "등록 처리에 실패했습니다 — 학원에 문의해 주세요" };
  }

  // 2) 계정 생성(auth → users 보강). 실패하면 이력서만 남기고 안내(사무실이 직원관리에서 마무리 가능).
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: INITIAL_STAFF_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tok.tenantId, system_role: tok.role },
  });
  if (authErr || !authData?.user) {
    logDbError(authErr, "staff.submitPublicStaffIntake");
    await bumpSubmission(tok.id, tok.submissionCount);
    return { error: "이미 등록된 이메일이거나 계정 생성에 실패했습니다 — 학원에 문의해 주세요" };
  }

  const settings = await getTenantSettingsByTenantId(tok.tenantId);
  const subjects = subjectsFromDepartment(
    data.contract.division,
    buildSubjectMaps(settings.operations.subjects).options,
  );
  const { error: dbErr } = await admin
    .from("users")
    .update({
      display_name: data.personal.name,
      system_role: tok.role,
      status: "active",
      phone: phoneLabel(data.personal.phone),
      hire_date: data.contract.startDate || null,
      department: data.contract.division || null,
      employment_type: data.contract.employmentType || null,
      job_title: data.contract.jobTitle || null,
      subjects,
    })
    .eq("id", authData.user.id);
  if (dbErr) {
    logDbError(dbErr, "staff.submitPublicStaffIntake");
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("users").delete().eq("id", authData.user.id);
    await bumpSubmission(tok.id, tok.submissionCount);
    return { error: "등록 처리에 실패했습니다 — 학원에 문의해 주세요" };
  }

  await admin.from("academy_documents").update({ staff_user_id: authData.user.id }).eq("id", doc.id);
  await bumpSubmission(tok.id, tok.submissionCount);
  // 감사 로그 — ⚠️ 공용 logAction은 **세션이 없으면 조용히 반환**한다(비인증 경로). 공개 등록이야말로
  // "누가 언제 들어왔나"가 남아야 하므로 admin client로 직접 적는다(actor_id=null, 이름에 QR 표시).
  await admin.from("audit_logs").insert({
    tenant_id: tok.tenantId,
    actor_id: null,
    actor_name: `QR 등록(${tok.name})`,
    action: "staff_create_from_intake",
    target_type: "user",
    target_label: data.personal.name,
    metadata: { tokenName: tok.name, userId: authData.user.id, role: tok.role, email, resumeId: doc.id },
  });

  // 아이디·초기 비밀번호는 완료 화면이 보여준다(본인이 로그인할 유일한 단서).
  return {
    ok: true,
    nonce: Date.now(),
    notice: `${email}|${INITIAL_STAFF_PASSWORD}`,
  };
}

/** 제출 수 +1 — 상한 판정의 근거이자 운영 지표. 실패해도 등록 자체는 유효(best-effort). */
async function bumpSubmission(id: string, current: number): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("academy_documents")
    .select("form_data")
    .eq("id", id)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .maybeSingle();
  if (!data) return;
  await admin
    .from("academy_documents")
    .update({ form_data: { ...(data.form_data as object), submissionCount: current + 1 } })
    .eq("id", id);
}
