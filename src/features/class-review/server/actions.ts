"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { normalizeScore, TOTAL_ITEMS } from "../checklist";
import { CLASS_REVIEW_FORM_TYPE, type ReviewDoc, type ReviewEvaluator } from "./queries";

// 수업 평가(참관) 쓰기 — 생성·채점 제출·삭제. 게이트 = class_review 쓰기(개인 예외 반영) + admin client.
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

/** 새 참관 건 생성 — 헤더 + 평가자(참관자 최대 3 + 대상 강사 본인 자동). 성공 시 상세로 이동. */
export async function createClassReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };

  const date = String(formData.get("date") ?? "").trim();
  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const className = String(formData.get("className") ?? "").trim();
  const session = String(formData.get("session") ?? "").trim();
  const classTime = String(formData.get("classTime") ?? "").trim();
  const studentCount = String(formData.get("studentCount") ?? "").trim();
  if (!YMD.test(date)) return { error: "참관일을 입력하세요" };
  if (!teacherId) return { error: "평가 대상 강사를 선택하세요" };

  const admin = createAdminClient();
  const { data: teacher } = await admin
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher || teacher.tenant_id !== gate.user.tenantId) return { error: "강사를 찾을 수 없습니다" };

  // 참관자(선택 3명) — users.id 목록. 이름은 저장 시점 스냅샷(개명해도 문서는 그대로).
  const evaluators: ReviewEvaluator[] = [];
  for (const key of ["observer1", "observer2", "observer3"]) {
    const id = String(formData.get(key) ?? "").trim();
    if (!id) continue;
    if (evaluators.some((e) => e.id === id) || id === teacherId) continue; // 중복·본인 겸직 방지
    const { data: u } = await admin.from("users").select("id, display_name, tenant_id").eq("id", id).maybeSingle();
    if (u && u.tenant_id === gate.user.tenantId) {
      evaluators.push({ id: u.id, name: u.display_name, kind: "observer" });
    }
  }
  evaluators.push({ id: teacher.id, name: teacher.display_name, kind: "self" });

  const doc: Omit<ReviewDoc, "id" | "createdAt"> = {
    header: {
      date,
      teacherId: teacher.id,
      teacherName: teacher.display_name,
      subject,
      className,
      session,
      classTime,
      studentCount,
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
    metadata: { date, evaluators: evaluators.length },
  });
  revalidatePath("/class-review");
  redirect(`/class-review/${row.id}`);
}

/** 채점 제출 — 자기 평가자 슬롯만 갱신(관찰자=자기 userId 슬롯, 대상 강사 본인='self' 슬롯). */
export async function submitClassReviewScores(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };

  const docId = String(formData.get("docId") ?? "").trim();
  if (!docId) return { error: "평가 건을 찾을 수 없습니다" };
  const scores: number[] = [];
  for (let i = 0; i < TOTAL_ITEMS; i++) scores.push(normalizeScore(formData.get(`q${i}`)));
  const comment = String(formData.get("comment") ?? "").trim();

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("academy_documents")
    .select("id, form_data")
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", CLASS_REVIEW_FORM_TYPE)
    .eq("id", docId)
    .maybeSingle();
  if (readErr) return { error: humanizeDbError(readErr.message, "확인") };
  if (!row) return { error: "평가 건을 찾을 수 없습니다" };

  const doc = (row.form_data ?? {}) as ReviewDoc;
  const evaluators: ReviewEvaluator[] = Array.isArray(doc.evaluators) ? doc.evaluators : [];
  const mine = evaluators.find((e) => e.id === gate.user.id);
  if (!mine) return { error: "이 참관 건의 평가자로 지정되어 있지 않습니다" };
  const slot = mine.kind === "self" ? "self" : gate.user.id;

  const submissions = { ...(doc.submissions ?? {}) };
  submissions[slot] = { scores, comment, submittedAt: new Date().toISOString() };
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
    metadata: { docId, slot, answered: scores.filter((v) => v > 0).length },
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
