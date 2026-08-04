"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { itemCountOf, normalizeScore, sanitizeAreas } from "../checklist";
import {
  CLASS_REVIEW_FORM_TYPE,
  CLASS_REVIEW_TEMPLATE_FORM_TYPE,
  getChecklistAreas,
  getReviewPrivileges,
  OPEN_MODE_OBSERVER_LIMIT,
  observerColumns,
  type ReviewDoc,
  type ReviewEvaluator,
} from "./queries";

// 수업 평가(참관) 쓰기 — 생성·채점 제출·삭제·문항 템플릿 저장. 게이트 = class_review 쓰기(개인 예외 반영) + admin client.
// ⚠️ 한 참관 문서에 여러 사람의 채점이 담긴다(submissions) — 제출은 **자기 슬롯만** 갈아끼우는
//    read-modify-write라 동시 제출이 서로를 지울 수 있는 창이 이론상 있다(초안 트레이드오프,
//    테스트 단계(1인)라 감수. 확대 시 채점을 평가자별 문서로 분리).

export type ReviewActionState = { ok?: true; error?: string; notice?: string } | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function requireWrite() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "class_review"))) {
    return { error: "수업 평가를 작성할 권한이 없습니다" as const };
  }
  return { user };
}

/** 새 참관 건 — 참관일·강사(필수) + 과목(선택) + 참관자 방식(지정/선착순 3명). */
export async function createClassReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };

  const date = String(formData.get("date") ?? "").trim();
  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const observerMode = String(formData.get("observerMode") ?? "") === "open" ? "open" : "assigned";
  if (!YMD.test(date)) return { error: "참관일을 입력하세요" };
  if (!teacherId) return { error: "평가 대상 강사를 선택하세요" };

  const admin = createAdminClient();
  const { data: teacher } = await admin
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher || teacher.tenant_id !== gate.user.tenantId) return { error: "강사를 찾을 수 없습니다" };

  // 지정 모드: 참관자(선택 최대 3명). 선착순 모드: 지정 없이 본인 슬롯만 — 권한자 먼저 채점 3명이 참관자.
  const evaluators: ReviewEvaluator[] = [];
  if (observerMode === "assigned") {
    for (const key of ["observer1", "observer2", "observer3"]) {
      const id = String(formData.get(key) ?? "").trim();
      if (!id) continue;
      if (evaluators.some((e) => e.id === id) || id === teacherId) continue; // 중복·본인 겸직 방지
      const { data: u } = await admin.from("users").select("id, display_name, tenant_id").eq("id", id).maybeSingle();
      if (u && u.tenant_id === gate.user.tenantId) {
        evaluators.push({ id: u.id, name: u.display_name, kind: "observer" });
      }
    }
  }
  evaluators.push({ id: teacher.id, name: teacher.display_name, kind: "self" });

  const doc: Omit<ReviewDoc, "id" | "createdAt"> = {
    header: {
      date,
      teacherId: teacher.id,
      teacherName: teacher.display_name,
      subject,
      className: "",
      session: "",
      classTime: "",
      studentCount: "",
      observerMode,
    },
    evaluators,
    submissions: {},
  };
  const { data: row, error } = await admin
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: `수업평가 — ${teacher.display_name} ${date}`,
      category: "hr",
      kind: "form",
      form_type: CLASS_REVIEW_FORM_TYPE,
      form_data: doc,
      restricted: true, // 강사 평가 점수 = 인사 민감 — 사무실 백스톱 RLS
      staff_user_id: teacher.id, // 직원 연결 → /documents 표면 자동 제외(#77 벽 공유)
      uploaded_by: gate.user.id,
    })
    .select("id")
    .single();
  if (error || !row) return { error: humanizeDbError(error?.message ?? "unknown", "저장") };

  await logAction({
    action: "class_review_create",
    targetType: "user",
    targetLabel: teacher.display_name,
    metadata: { date, observerMode, assigned: evaluators.length - 1 },
  });
  revalidatePath("/class-review");
  redirect(`/class-review/${row.id}`);
}

/**
 * 채점 제출 — 지정 모드: 지정된 평가자(관찰자=자기 userId 슬롯, 대상 강사='self')만.
 * 선착순 모드: 대상 강사='self', 그 외 권한자는 **먼저 제출한 3명까지** 자기 userId 슬롯.
 */
export async function submitClassReviewScores(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };

  const docId = String(formData.get("docId") ?? "").trim();
  if (!docId) return { error: "평가 건을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const [{ data: row, error: readErr }, areas] = await Promise.all([
    admin
      .from("academy_documents")
      .select("id, form_data")
      .eq("tenant_id", gate.user.tenantId)
      .eq("form_type", CLASS_REVIEW_FORM_TYPE)
      .eq("id", docId)
      .maybeSingle(),
    getChecklistAreas(gate.user.tenantId),
  ]);
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "평가 건을 찾을 수 없습니다" };

  const total = itemCountOf(areas);
  const scores: number[] = [];
  for (let i = 0; i < total; i++) scores.push(normalizeScore(formData.get(`q${i}`)));
  const comment = String(formData.get("comment") ?? "").trim();

  const doc = (row.form_data ?? {}) as ReviewDoc;
  const evaluators: ReviewEvaluator[] = Array.isArray(doc.evaluators) ? doc.evaluators : [];
  const isSelf = doc.header?.teacherId === gate.user.id;
  const openMode = doc.header?.observerMode === "open";

  let slot: string;
  if (isSelf) slot = "self";
  else if (openMode) {
    // 선착순 — 이미 내 장이 있으면 갱신, 없으면 남은 슬롯이 있어야 새로 차지.
    const observers = observerColumns({ ...doc, id: docId, createdAt: "" });
    const mineAlready = observers.some((o) => o.slot === gate.user.id) || !!doc.submissions?.[gate.user.id];
    if (!mineAlready && observers.length >= OPEN_MODE_OBSERVER_LIMIT) {
      return { error: `참관자 ${OPEN_MODE_OBSERVER_LIMIT}명이 이미 채점을 마쳤습니다 (선착순 마감)` };
    }
    slot = gate.user.id;
  } else {
    const mine = evaluators.find((e) => e.id === gate.user.id && e.kind === "observer");
    if (!mine) return { error: "이 참관 건의 평가자로 지정되어 있지 않습니다" };
    slot = gate.user.id;
  }

  const submissions = { ...(doc.submissions ?? {}) };
  submissions[slot] = {
    scores,
    comment,
    submittedAt: new Date().toISOString(),
    by: { id: gate.user.id, name: gate.user.displayName },
  };
  const { error } = await admin
    .from("academy_documents")
    .update({ form_data: { ...doc, submissions }, updated_at: new Date().toISOString() })
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", docId);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "class_review_submit",
    targetType: "user",
    targetLabel: doc.header?.teacherName ?? null,
    metadata: { docId, slot: slot === "self" ? "self" : "observer", answered: scores.filter((v) => v > 0).length },
  });
  revalidatePath(`/class-review/${docId}`);
  revalidatePath("/class-review");
  return { ok: true, notice: "채점을 저장했습니다" };
}

/** 참관 건 삭제 — 잘못 만든 건 정리(초안: 쓰기 권한자 누구나). */
export async function deleteClassReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  const docId = String(formData.get("docId") ?? "").trim();
  if (!docId) return { error: "삭제할 건을 찾을 수 없습니다" };

  const { error, data: deleted } = await createAdminClient()
    .from("academy_documents")
    .delete()
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", CLASS_REVIEW_FORM_TYPE)
    .eq("id", docId)
    .select("id");
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "이미 삭제된 건입니다" };

  await logAction({ action: "class_review_delete", targetType: "document", metadata: { docId } });
  revalidatePath("/class-review");
  return { ok: true, notice: "삭제했습니다" };
}

/**
 * 문항 템플릿 저장 — **원장 + class_review 개인 예외 인원만**(원장 지시 2026-08-04).
 * ⚠️ 문항 수·순서를 바꾸면 기존 채점의 문항 매칭이 어긋난다 — 새 참관부터 적용 권장(편집 화면에 경고).
 */
export async function saveChecklistTemplate(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  const priv = await getReviewPrivileges(gate.user);
  if (!priv.editTemplate) return { error: "문항 편집은 원장·지정 인원만 가능합니다" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("areasJson") ?? "[]"));
  } catch {
    return { error: "문항 형식이 올바르지 않습니다" };
  }
  const areas = sanitizeAreas(parsed);
  if (!areas) return { error: "문항 형식이 올바르지 않습니다 — 영역 제목과 문항을 확인하세요(영역당 1~20문항)" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("academy_documents")
    .select("id")
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", CLASS_REVIEW_TEMPLATE_FORM_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    tenant_id: gate.user.tenantId,
    title: "수업 평가 문항 템플릿",
    category: "hr",
    kind: "form",
    form_type: CLASS_REVIEW_TEMPLATE_FORM_TYPE,
    form_data: { areas },
    restricted: true,
    // 직원 연결(#77 벽)로 /documents 표면에서 제외 — 대상 직원이 없어 편집자 본인에게 건다(내부 전용 행).
    staff_user_id: gate.user.id,
    uploaded_by: gate.user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await admin.from("academy_documents").update(payload).eq("tenant_id", gate.user.tenantId).eq("id", existing.id)
    : await admin.from("academy_documents").insert(payload);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "class_review_template_save",
    targetType: "document",
    metadata: { areas: areas.length, items: areas.reduce((n, a) => n + a.items.length, 0) },
  });
  revalidatePath("/class-review");
  revalidatePath("/class-review/template");
  return { ok: true, notice: "문항을 저장했습니다 — 새 채점부터 적용됩니다" };
}
