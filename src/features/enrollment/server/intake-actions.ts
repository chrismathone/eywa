"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generatePrepBriefOnIntake } from "@/features/enrollment/server/prep-generate";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { parseIntakeChecklist } from "@/features/enrollment/intake-checklist-parse";
import { parseForwardedFor } from "@/features/attendance/kiosk/device-info";
import {
  GENDER_OPTIONS,
  BLOOD_OPTIONS,
  RELATION_OPTIONS,
  CONSULTATION_PATHS,
} from "@/features/enrollment/form-config";

// ───────────────────────── 토큰 관리 (직원, 인증) ─────────────────────────

async function requireIntakeAdmin() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "enrollment");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "등록상담 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

export type IntakeTokenState = { error?: string; ok?: boolean } | undefined;

/** 공개 접수 토큰 생성 — 랜덤 시크릿(URL에 노출되는 공유키). */
export async function createIntakeToken(
  _prev: IntakeTokenState,
  formData: FormData,
): Promise<IntakeTokenState> {
  const { user, error } = await requireIntakeAdmin();
  if (error || !user) return { error };
  const name = String(formData.get("name") ?? "").trim() || "공개 접수";
  const expiresRaw = String(formData.get("expiresAt") ?? "").trim();

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("intake_tokens").insert({
    tenant_id: user.tenantId,
    token: randomBytes(16).toString("hex"),
    name: name.slice(0, 80),
    // 미입력 시 영구 유효 대신 기본 90일 만료(방치된 공개 링크 방지). 학원장이 폼에서 직접 지정 가능.
    expires_at: expiresRaw
      ? new Date(expiresRaw).toISOString()
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    created_by: user.id,
  });
  if (insErr) return { error: insErr.message };

  await logAction({ action: "intake_token_create", targetType: "intake_token", targetLabel: name });
  revalidatePath("/enrollment");
  return { ok: true };
}

/** 토큰 활성/비활성 토글 또는 삭제. */
export async function setIntakeTokenActive(
  _prev: IntakeTokenState,
  formData: FormData,
): Promise<IntakeTokenState> {
  const { user, error } = await requireIntakeAdmin();
  if (error || !user) return { error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "토큰 ID가 누락되었습니다" };
  const action = String(formData.get("action") ?? "toggle");

  const supabase = await createClient();
  if (action === "delete") {
    const { error: delErr } = await supabase.from("intake_tokens").delete().eq("id", id);
    if (delErr) return { error: delErr.message };
  } else {
    const active = String(formData.get("active") ?? "false") === "true";
    const { error: updErr } = await supabase
      .from("intake_tokens")
      .update({ is_active: active })
      .eq("id", id);
    if (updErr) return { error: updErr.message };
  }
  revalidatePath("/enrollment");
  return { ok: true };
}

// ───────────────────────── 공개 제출 (비인증, admin client) ─────────────────────────

export type PublicIntakeState =
  | { error?: string; ok?: boolean }
  | undefined;

const clip = (v: FormDataEntryValue | null, max: number): string =>
  String(v ?? "").trim().slice(0, max);

// 봇/스팸 방어 상수 — 합법 버스트(오픈하우스: 한 QR로 다수 학부모, 같은 NAT) 우선.
// 실제 봇 방어는 캡차가 담당하고 레이트리밋은 단일/소수 IP 백스톱. 튜닝 용이하게 한곳에.
const MIN_FILL_MS = 3000; // 폼 로드 후 최소 작성 시간(미만=봇)
const IP_LIMIT = 15; // 동일 IP 시간당 시도
const TENANT_LIMIT = 200; // 테넌트 전역 시간당 시도
const TOKEN_LIMIT = 60; // 단일 토큰 시간당 시도

/** Cloudflare Turnstile 검증. 키(env) 없으면 스킵(데모). 활성 시 검증 실패는 fail-closed. */
async function verifyTurnstile(responseToken: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // 캡차 미설정 = 통과(데모 무중단)
  if (!responseToken) return false;
  try {
    const body = new URLSearchParams({ secret, response: responseToken });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false; // 네트워크 등 실패 시 거부(캡차 활성 시 fail-closed)
  }
}

/**
 * 학부모 공개 접수 제출 — 비인증. 토큰으로 테넌트 해석 → 검증 → 레이트리밋 → enrollment_consultations(pending).
 * admin client(service_role)로 RLS 우회하되, tenant_id는 검증된 토큰에서만 취한다(조작 불가).
 */
export async function submitPublicIntake(
  _prev: PublicIntakeState,
  formData: FormData,
): Promise<PublicIntakeState> {
  const token = clip(formData.get("token"), 64);
  // 봇 허니팟 — 사람은 비워두는 숨김 필드. 채워졌으면 성공인 척 조용히 무시.
  if (clip(formData.get("company"), 100)) return { ok: true };

  // time-trap — 폼 렌더 후 너무 빨리 제출되면 봇(클라가 보낸 mount 시각). DB·토큰 조회 전 차단.
  const renderedAt = Number(formData.get("renderedAt") ?? 0);
  if (!renderedAt || Date.now() - renderedAt < MIN_FILL_MS) {
    return { error: "잠시 후 다시 시도해주세요" };
  }

  const prospectName = clip(formData.get("prospectName"), 60);
  const privacy = String(formData.get("privacyAgreement") ?? "") === "true";
  if (!token) return { error: "잘못된 접근입니다" };
  if (!prospectName) return { error: "학생 이름을 입력해주세요" };
  if (!privacy) return { error: "개인정보 수집·이용에 동의해주세요" };

  const admin = createAdminClient();
  const { data: tok } = await admin
    .from("intake_tokens")
    .select("id, tenant_id, is_active, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok || !tok.is_active) return { error: "사용할 수 없는 접수 링크입니다" };
  if (tok.expires_at && new Date(tok.expires_at as string) < new Date()) {
    return { error: "만료된 접수 링크입니다" };
  }

  // ── 봇/스팸 방어 (A) ── IP 해시(원본 미저장, 테넌트별 salt) → 캡차 → 시도 기반 다층 레이트리밋.
  const hdrs = await headers();
  const ipRaw = parseForwardedFor(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));
  const ipHash = createHash("sha256").update(`${ipRaw ?? "unknown"}:${tok.tenant_id}`).digest("hex");

  if (!(await verifyTurnstile(clip(formData.get("cf-turnstile-response"), 4000), ipRaw))) {
    return { error: "사람인지 확인에 실패했습니다. 잠시 후 다시 시도해주세요" };
  }

  // 시도 1건 기록(거부건 포함) 후 슬라이딩 1시간 윈도우로 per-IP/per-tenant/per-token 카운트.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: attempt } = await admin
    .from("intake_attempts")
    .insert({ tenant_id: tok.tenant_id, intake_token_id: tok.id, ip_hash: ipHash, ok: false })
    .select("id")
    .single();
  const [ipC, tenantC, tokenC] = await Promise.all([
    admin.from("intake_attempts").select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("created_at", hourAgo),
    admin.from("intake_attempts").select("id", { count: "exact", head: true })
      .eq("tenant_id", tok.tenant_id).gte("created_at", hourAgo),
    admin.from("intake_attempts").select("id", { count: "exact", head: true })
      .eq("intake_token_id", tok.id).gte("created_at", hourAgo),
  ]);
  if ((ipC.count ?? 0) > IP_LIMIT || (tenantC.count ?? 0) > TENANT_LIMIT || (tokenC.count ?? 0) > TOKEN_LIMIT) {
    return { error: "접수가 많아 잠시 후 다시 시도해주세요" };
  }
  // 오래된 시도 기회적 정리(cron 불요).
  await admin
    .from("intake_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // 필수·화이트리스트 검증 — 비인증 직접 POST가 설정 밖 값/빈 필수필드를 넣지 못하게 막는다.
  // 과목·학년은 운영 enum 단일소스(토큰 테넌트의 학원설정)와 대조. <select>는 클라 가드일 뿐이라 서버에서 재검증.
  const settings = await getTenantSettingsByTenantId(tok.tenant_id as string);
  // 공개 접수에서 숨긴 과목(hiddenFromIntake)은 서버에서도 거부 — 폼에 없다고 위조 POST가 못 넣는 건 아니다.
  const allowedSubjects = new Set(
    buildSubjectMaps(settings.operations.subjects.filter((s) => !s.hiddenFromIntake)).options.map(
      (o) => o.value,
    ),
  );
  const allowedGrades = new Set(settings.operations.gradeLevels);
  const has = (arr: readonly string[], v: string) => arr.includes(v);

  const prospectGrade = clip(formData.get("prospectGrade"), 20);
  const prospectSchool = clip(formData.get("prospectSchool"), 40);
  const gender = clip(formData.get("gender"), 10);
  const parentName = clip(formData.get("parentName"), 40);
  const parentPhone = clip(formData.get("parentPhone"), 20);
  const parentRelation = clip(formData.get("parentRelation"), 10);
  const consultationPath = clip(formData.get("consultationPath"), 40);

  if (!prospectSchool) return { error: "학교를 입력해주세요" };
  if (!parentName) return { error: "보호자 이름을 입력해주세요" };
  if (!parentPhone) return { error: "보호자 연락처를 입력해주세요" };
  if (!has(GENDER_OPTIONS.map((o) => o.value), gender)) return { error: "성별을 선택해주세요" };
  if (!has(RELATION_OPTIONS, parentRelation)) return { error: "보호자와의 관계를 선택해주세요" };
  if (!has(CONSULTATION_PATHS, consultationPath)) return { error: "상담 경로를 선택해주세요" };
  if (!allowedGrades.has(prospectGrade)) return { error: "학년을 선택해주세요" };

  // 선택 입력 — 화이트리스트 밖이면 조용히 버린다(null).
  const bloodRaw = clip(formData.get("bloodType"), 4);
  const bloodType = has(BLOOD_OPTIONS, bloodRaw) ? bloodRaw : null;
  // siblings는 운영 enum이 아니라 자유 라벨(폼 "있음"/"없음(외동)") — 화이트리스트 없이 clip만.
  const siblings = clip(formData.get("siblings"), 40) || null;
  const subjects = formData.getAll("subjects").map((s) => String(s)).filter(Boolean);
  const subject = subjects.find((s) => allowedSubjects.has(s)) ?? null;
  // 과목은 사전 체크리스트의 과목별 문항 노출을 가르므로 필수(폼 가드와 이중 방어).
  if (!subject) return { error: "상담 희망 과목을 선택해주세요" };

  // 사전 체크리스트(2단계) — 화이트리스트·최대개수·범위를 순수함수가 재검증. 미작성이면 null.
  const checklist = parseIntakeChecklist(formData);
  if (!checklist || checklist.goals.length === 0) {
    return { error: "학습 상담을 통해 가장 알고 싶은 문제를 1개 이상 선택해주세요" };
  }

  // 🔴 QR 접수는 **학생 행을 만들지 않는다**(상담만 접수) — 동명이인 접미사·중복 경고를 여기에 붙이지 말 것
  // (원장 지시 2026-07-29: "QR로 학부모가 등록할 때는 예외 — 학부모에게는 의미없음").
  // 학부모는 자기 아이 이름을 그대로 적으면 되고, 동명이인 판단은 **직원이 상담을 학생으로 전환할 때**
  // convertConsultationToStudent가 접미사를 붙이며 그 자리에서 알린다. 이름을 학부모 화면에서 고쳐
  // 보여주면 "내 아이 이름이 왜 바뀌지?"가 되고, 접수 자체를 막으면 상담 유입이 끊긴다.
  const { data: inserted, error: insErr } = await admin.from("enrollment_consultations").insert({
    tenant_id: tok.tenant_id,
    prospect_name: prospectName,
    prospect_grade: prospectGrade,
    prospect_school: prospectSchool,
    gender,
    blood_type: bloodType,
    student_phone: clip(formData.get("studentPhone"), 20) || null,
    parent_name: parentName,
    parent_phone: parentPhone,
    parent_relation: parentRelation,
    address: clip(formData.get("address"), 120) || null,
    consultation_path: consultationPath,
    career_goal: clip(formData.get("careerGoal"), 60) || null,
    siblings,
    subject,
    intake_checklist: checklist,
    parent_request: clip(formData.get("parentRequest"), 2000) || null,
    shuttle_bus_request: String(formData.get("shuttleBusRequest") ?? "") === "true",
    privacy_agreement: true,
    installment_agreement: String(formData.get("installmentAgreement") ?? "") === "true",
    outcome: "pending",
    from_public_intake: true,
    intake_token_id: tok.id,
    consultant_id: null,
  }).select("id").single();
  if (insErr) return { error: "제출에 실패했습니다. 잠시 후 다시 시도해주세요" };

  // 상담 준비 브리프 **자동 생성**(원장 지시 2026-07-29) — 학부모가 제출한 순간 상담지가 만들어져
  // 있어야 상담사가 버튼을 누르러 들어올 필요가 없다. 백그라운드(after)라 학부모 화면은 즉시 완료되고,
  // 실패해도 접수는 이미 저장돼 있으므로 학부모에겐 아무 영향이 없다(상세에서 수기 재생성 가능).
  if (inserted?.id) {
    const consultationId = inserted.id as string;
    const tenantId = tok.tenant_id as string;
    after(() => generatePrepBriefOnIntake(consultationId, tenantId));
  }

  // 시도 로그를 성공으로 마킹(모니터링: 차단/실패 vs 성공 구분).
  if (attempt) await admin.from("intake_attempts").update({ ok: true }).eq("id", attempt.id);

  // 제출수 증가(현재값 읽어 +1 — 동시성은 데모 규모 무시). 조회수(usage_count)는 공개 폼 노출에서 집계.
  const { data: cur } = await admin
    .from("intake_tokens")
    .select("submission_count")
    .eq("id", tok.id)
    .maybeSingle();
  await admin
    .from("intake_tokens")
    .update({ submission_count: ((cur?.submission_count as number) ?? 0) + 1 })
    .eq("id", tok.id);

  return { ok: true };
}
