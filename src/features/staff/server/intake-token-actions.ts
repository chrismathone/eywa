"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import type { StaffQrView } from "../intake-view";
import { buildStaffQrView } from "./intake-qr";
import { isTokenOpen, parseIntakeToken, STAFF_INTAKE_FORM_TYPE, type StaffIntakeToken } from "./intake-token";

// 직원 등록 QR 토큰 관리 — 게이트 = 직원관리 쓰기(개인 예외 반영) + admin client + tenant 필터.
// ⚠️ 이 토큰을 아는 사람은 **로그인 없이 직원 계정을 만들 수 있다**(원장 결정 2026-08-07 '제출 즉시 생성').
//
// 원장 지시 2026-08-07(재확인): **입력칸으로 QR을 "설계"하지 않는다** — 채용 이름·역할·유효일을 묻던 폼을 없애고
// 버튼 한 번에 QR이 나오게 했다. 그래서 생성 파라미터는 전부 아래 상수로 고정한다.
//
// 🔴 **만료 없음**(원장 2026-08-07 "90일 만료 이유가 있나? 계속 쓰게 하면 안 되나"): 이 QR은 인쇄해
//    붙여두고 계속 쓰는 물건이라 기한을 걸면 어느 날 조용히 죽고, 지원자 화면엔 "종료된 링크"만 떠서
//    원장은 이유를 모른다. 위험 통제는 **기한이 아니라 직접 조작**으로 한다 — 다 쓰면 '닫기',
//    새어 나갔으면 '새 링크'(토큰 교체), 그리고 링크당 등록 상한(public-intake-actions MAX_SUBMISSIONS)과
//    동명 재등록 차단이 남용을 막는다. ⚠️ 만료를 다시 넣지 말 것(되돌리면 같은 함정).

/** QR로 만들어지는 계정의 역할 — 고정. 다른 역할이 필요하면 등록 뒤 직원 상세에서 바꾼다(권한 상승 통로 차단). */
const DEFAULT_ROLE: SystemRole = "teacher";
const TOKEN_NAME = "직원 등록";

export type IntakeTokenActionState =
  | { ok?: true; error?: string; notice?: string; view?: StaffQrView }
  | undefined;

async function requireStaffWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "staff"))) {
    return { error: "직원 등록 QR을 관리할 권한이 없습니다" as const };
  }
  return { user };
}

/** 이 학원의 직원 등록 QR 전부(만든 순). */
export async function listStaffIntakeTokens(tenantId: string): Promise<StaffIntakeToken[]> {
  const { data } = await createAdminClient()
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", tenantId)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? [])
    .map((r) => parseIntakeToken(r.id as string, r.created_at as string, r.form_data))
    .filter((t): t is StaffIntakeToken => t !== null);
}

/**
 * 패널을 열 때 쓰는 QR을 **보장**한다 — 입력 0. 이미 있으면 그대로 보여주고(닫혀 있어도 그 상태로),
 * 하나도 없을 때만 기본값으로 만든다. ⚠️ 닫아 둔 QR을 여기서 자동으로 열지 않는다(원장이 닫은 건 닫힌 채로).
 */
export async function ensureStaffIntakeToken(): Promise<IntakeTokenActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const tokens = await listStaffIntakeTokens(gate.user.tenantId);
  const existing = tokens.find((t) => isTokenOpen(t)) ?? tokens[0];
  if (existing) return { ok: true, view: await buildStaffQrView(existing) };

  // 만든 사람보다 강한 역할은 QR로도 못 만든다(직접 등록과 같은 위계 — 우회 통로가 되면 안 된다).
  if (ROLE_HIERARCHY[gate.user.systemRole] >= ROLE_HIERARCHY[DEFAULT_ROLE]) {
    return { error: "본인 권한으로는 직원 등록 QR을 만들 수 없습니다" };
  }

  const { data, error } = await createAdminClient()
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: `직원 등록 QR — ${TOKEN_NAME}`,
      category: "hr",
      kind: "form",
      form_type: STAFF_INTAKE_FORM_TYPE,
      form_data: {
        token: randomBytes(16).toString("hex"),
        name: TOKEN_NAME,
        active: true,
        expiresAt: null, // 만료 없음 — 인쇄해 두고 계속 쓴다(파일 상단 주석)
        role: DEFAULT_ROLE,
        submissionCount: 0,
      },
      restricted: true,
      staff_user_id: gate.user.id, // /documents 표면 제외(#77 벽) — 내부 전용 행
      uploaded_by: gate.user.id,
    })
    .select("id, created_at, form_data")
    .single();
  if (error || !data) return { error: humanizeDbError(error?.message ?? "", "저장") };

  const created = parseIntakeToken(data.id as string, data.created_at as string, data.form_data);
  if (!created) return { error: "QR을 만들지 못했습니다" };

  await logAction({
    action: "staff_intake_token_create",
    targetType: "document",
    targetLabel: TOKEN_NAME,
    metadata: { role: DEFAULT_ROLE },
  });
  revalidatePath("/staff");
  return { ok: true, view: await buildStaffQrView(created), notice: "직원 등록 QR을 만들었습니다" };
}

/**
 * 닫기 / 다시 열기 / 새 링크(재발급) / 이전 링크 모두 닫기.
 * - `close`  : 지금 링크로는 더 못 들어온다(가장 빠른 차단).
 * - `reopen` : 같은 링크를 다시 연다(인쇄해 둔 QR을 그대로 쓰는 경우) — 기한 없이 재개.
 * - `rotate` : **같은 행의 토큰 문자열만 교체** — 옛 링크는 즉시 죽고 행이 늘지 않는다(제출 수는 새로 센다).
 * - `closeOthers` : 예전에 여러 개 만들어 둔 링크를 한 번에 닫는다(화면에 안 보이는 열린 링크 = 구멍).
 */
export async function updateStaffIntakeToken(
  _prev: IntakeTokenActionState,
  formData: FormData,
): Promise<IntakeTokenActionState> {
  const gate = await requireStaffWrite();
  if ("error" in gate) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const action = String(formData.get("action") ?? "");
  if (!id) return { error: "대상을 찾을 수 없습니다" };

  const admin = createAdminClient();

  if (action === "closeOthers") {
    const others = (await listStaffIntakeTokens(gate.user.tenantId)).filter(
      (t) => t.id !== id && isTokenOpen(t),
    );
    for (const t of others) {
      await admin
        .from("academy_documents")
        .update({ form_data: { ...rawOf(t), active: false } })
        .eq("tenant_id", gate.user.tenantId)
        .eq("id", t.id);
    }
    if (others.length) {
      await logAction({
        action: "staff_intake_token_toggle",
        targetType: "document",
        targetLabel: "이전 링크 일괄 닫기",
        metadata: { closed: others.length },
      });
      revalidatePath("/staff");
    }
    return { ok: true, notice: `이전 링크 ${others.length}개를 닫았습니다` };
  }

  const { data: row } = await admin
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", STAFF_INTAKE_FORM_TYPE)
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "이미 삭제된 QR입니다" };
  const cur = parseIntakeToken(row.id as string, row.created_at as string, row.form_data);
  if (!cur) return { error: "QR 정보를 읽을 수 없습니다" };

  const patch =
    action === "close"
      ? { active: false }
      : action === "reopen"
        ? { active: true, expiresAt: null } // 다시 열기 = 기한 없이 재개(옛 만료값도 지운다)
        : action === "rotate"
          ? {
              token: randomBytes(16).toString("hex"),
              active: true,
              expiresAt: null,
              submissionCount: 0,
            }
          : null;
  if (!patch) return { error: "알 수 없는 요청입니다" };

  const { error } = await admin
    .from("academy_documents")
    .update({ form_data: { ...(row.form_data as object), ...patch } })
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", id);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: action === "rotate" ? "staff_intake_token_create" : "staff_intake_token_toggle",
    targetType: "document",
    targetLabel: cur.name,
    metadata: { action },
  });
  revalidatePath("/staff");

  const next = parseIntakeToken(cur.id, cur.createdAt, { ...(row.form_data as object), ...patch });
  return {
    ok: true,
    view: next ? await buildStaffQrView(next) : undefined,
    notice:
      action === "close"
        ? "QR을 닫았습니다"
        : action === "rotate"
          ? "새 링크를 발급했습니다 — 옛 링크는 더 이상 열리지 않습니다"
          : "QR을 다시 열었습니다",
  };
}

/** 토큰을 저장 모양(form_data)으로 되돌린다 — 일괄 닫기에서 다른 필드를 지우지 않으려고. */
function rawOf(t: StaffIntakeToken) {
  return {
    token: t.token,
    name: t.name,
    active: t.active,
    expiresAt: t.expiresAt,
    role: t.role,
    submissionCount: t.submissionCount,
  };
}
