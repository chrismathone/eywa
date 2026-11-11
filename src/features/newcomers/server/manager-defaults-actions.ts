"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { explainDbError } from "@/lib/supabase/db-error";
import { foldedReason } from "@/lib/folded-read";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isSubjectKey } from "../subject-rows";
import { managerDefaultSubjects, NEWCOMER_MANAGER_ROLES } from "../manager-defaults";
import { followupAccess } from "./followup-query";

/**
 * 신규생 **과목 기본 담당** 지정·교체(2026-11-11 · Claude·Codex 합의안 — 원장 위임).
 *
 * 과목 기본 담당은 직접 지정하지 않은 학생 전체의 관리 담당을 한 줄로 바꾼다. 전에는 화면이 없어 DB에 직접 넣었다.
 *  · 자격 = 학생별 담당 배정과 같은 `canManage`(신규생 관리 '전체' · 담당 범위 아님 — `followupAccess`). 역할을 직접 비교하지 않는다.
 *    지점 보기 · 읽기 강사뷰에서는 저장하지 않는다(기존 쓰기 차단 그대로 · 관리 클라이언트의 쓰기 가드와 이중).
 *  · 지정·교체만 — 해제·삭제·일괄 재배정은 없다(표의 담당자 칸은 비울 수 없다).
 *  · 과목 = 지금 과목(학원 설정) + 이미 줄이 있는 EiE(`managerDefaultSubjects` — 화면이 세우는 줄과 같은 판정).
 *  · 동시 저장 = 화면이 연 때의 `updated_at`이 그대로일 때만 고친다(줄이 없으면 새로 넣는다). 0행·중복 키(23505)는 충돌로 알린다.
 *  · 기록 = 이 액션이 따로 남기지 않는다 — **DB 트리거**(s2_0066 `onboarding_default_manager_audit`)가 같은 거래에서 감사로그에 남긴다
 *    (`logAction`은 실패를 삼켜 기록 없이 바뀔 수 있다 · 가드 audit-coverage.test.ts의 예외 목록에 그 까닭과 함께 올렸다).
 */
const TABLE = "student_onboarding_manager_defaults";
const CONFLICT = "다른 사람이 먼저 바꿨습니다. 최신 값을 불러왔으니 확인한 뒤 다시 저장해 주세요.";
const FAILED = "기본 담당을 저장하지 못했습니다. 다시 시도해 주세요.";

/** 화면이 실어 보내는 기준 값 — DB가 준 `updated_at` 글자 그대로(마이크로초까지 · Date로 바꾸지 않는다). 줄이 없으면 null. */
const stampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/);
const inputSchema = z.object({
  subject: z.string().refine(isSubjectKey),
  managerId: z.uuid(),
  expectedUpdatedAt: stampSchema.nullable(),
}).strict();

export type ManagerDefaultSaveResult = { ok: true; error?: never; conflict?: never } | { ok: false; error: string; conflict?: boolean };

export async function saveNewcomerDefaultManager(input: unknown): Promise<ManagerDefaultSaveResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "과목과 담당자를 확인해 주세요" };
  const { subject, managerId, expectedUpdatedAt } = parsed.data;
  try {
    const access = await followupAccess();
    if (access.user.tenantView || (await readonlyTeacherViewError())) return { ok: false, error: "현재 보기에서는 기록을 변경할 수 없습니다" };
    if (!access.canManage) return { ok: false, error: "과목 기본 담당을 바꿀 권한이 없습니다" };
    // 기록의 '누가' = 실제 로그인 계정(강사뷰여도 — followup-actions.ts writeAccess와 같다).
    const actor = await getCurrentUser();
    if (!actor || actor.tenantId !== access.user.tenantId) return { ok: false, error: "로그인 정보를 확인해 주세요" };
    const tenant = access.user.tenantId;
    const db = createAdminClient();

    // 과목 · 그 과목의 줄 · 담당자 확인 — 서로 독립이라 함께 읽는다(B4). 줄 조회는 그 과목 한 줄뿐이다(키 조회).
    const [settings, row, person] = await Promise.all([
      getTenantSettings(),
      db.from(TABLE).select("subject").eq("tenant_id", tenant).eq("subject", subject).maybeSingle(),
      db.from("users").select("id").eq("tenant_id", tenant).eq("id", managerId).eq("status", "active").in("system_role", [...NEWCOMER_MANAGER_ROLES]).maybeSingle(),
    ]);
    // 학원 설정을 못 읽어 기본값으로 접힌 값이면 과목 목록을 믿을 수 없다 — 저장하지 않는다.
    if (foldedReason(settings) || row.error) {
      if (row.error) explainDbError(row.error, { scope: "newcomers.saveDefaultManager.row", fallback: "" });
      return { ok: false, error: "과목 목록을 확인하지 못해 저장하지 않았습니다. 잠시 뒤 다시 시도해 주세요." };
    }
    const allowed = managerDefaultSubjects(settings.operations.subjects.map((s) => s.key), row.data ? [subject] : [], isModuleEnabled(settings.modules.disabled, "eie"));
    if (!allowed.includes(subject)) return { ok: false, error: "지금 쓰는 과목에만 기본 담당을 지정할 수 있습니다" };
    if (person.error || !person.data) {
      if (person.error) explainDbError(person.error, { scope: "newcomers.saveDefaultManager.manager", fallback: "" });
      return { ok: false, error: "현재 학원의 관리 담당자를 선택해 주세요" };
    }

    // 줄이 있으면 연 때의 값 그대로일 때만 고치고(0행 = 그사이 바뀜), 없으면 새로 넣는다(중복 키 = 그사이 생김).
    const values = { manager_id: managerId, updated_by: actor.id };
    const saved = expectedUpdatedAt === null
      ? await db.from(TABLE).insert({ tenant_id: tenant, subject, ...values }).select("subject").maybeSingle()
      : await db.from(TABLE).update(values).eq("tenant_id", tenant).eq("subject", subject).eq("updated_at", expectedUpdatedAt).select("subject").maybeSingle();
    if (saved.error?.code === "23505" || (!saved.error && !saved.data)) {
      revalidatePath("/newcomers");
      return { ok: false, error: CONFLICT, conflict: true };
    }
    if (saved.error) {
      return { ok: false, error: explainDbError(saved.error, { scope: "newcomers.saveDefaultManager", fallback: FAILED, context: { subject } }).message };
    }
    revalidatePath("/newcomers");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    // 이 기능이 던진 한글 사유만 화면에 낸다 — 조회 도우미의 영문 원문은 로그로(followup-actions.ts errorResult와 같은 규약).
    const message = e instanceof Error ? e.message : "";
    if (/[가-힣]/.test(message)) return { ok: false, error: message };
    console.error("[newcomers.saveDefaultManager]", e);
    return { ok: false, error: FAILED };
  }
}
