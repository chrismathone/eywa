"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeObserverLimit } from "../observer-count";
import { humanizeDbError, explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { kstToday } from "@/lib/date-kst";
import { CHECKLIST_AREAS, firstCompletedAt, itemCountOf, normalizeScore, sanitizeAreas } from "../checklist";
import {
  DEFAULT_CLASS_REVIEW_FILTER,
  normalizeClassReviewFilter,
  type ClassReviewFilter,
} from "../list-filter";
import { isSelfOnlyReviewer } from "../self-only";
import { planObserverReplacement } from "../observer-replace";
import {
  CLASS_REVIEW_FORM_TYPE,
  CLASS_REVIEW_TEMPLATE_FORM_TYPE,
  getChecklistAreas,
  getChecklistTemplates,
  getReviewPrivileges,
  observerLimitOf,
  observerColumns,
  type ReviewDoc,
  type ReviewEvaluator,
} from "./queries";

// 수업 평가(참관) 쓰기 — 생성·채점 제출·삭제·문항 템플릿 저장. 게이트 = class_review 쓰기(개인 예외 반영) + admin client.
// ⚠️ 한 참관 문서에 여러 사람의 채점이 담긴다(submissions) — 제출은 **자기 슬롯만** 갈아끼우는
//    read-modify-write라 동시 제출이 서로를 지울 수 있는 창이 이론상 있다(초안 트레이드오프,
//    테스트 단계(1인)라 감수. 확대 시 채점을 평가자별 문서로 분리).

export type ReviewActionState = { ok?: true; error?: string; notice?: string } | undefined;

async function requireWrite() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" as const };
  // '다른 강사 뷰'(열람 전용)는 쓰기 캡에도 걸리지만 사유가 "권한 없음"으로 뭉뚱그려진다 —
  // 그 화면은 남의 눈을 빌린 것뿐이라 정확한 문구로 돌려준다(원장 2026-08-19).
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { error: readonly };
  if (!(await canWriteTenant(user.systemRole, "class_review"))) {
    return { error: "직원 평가를 작성할 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 새 평가 건 — 강사(필수) + 과목·문항 세트(선택) + 평가자 방식(지정/선착순) + **평가자 인원**.
 * 날짜는 입력받지 않고 **생성 당일(KST)** 로 박는다(원장 지시 2026-08-05 "참관일 따로 받지 말고").
 * 문항은 선택한 세트를 **문서에 스냅샷** — 이후 세트를 고쳐도 이 평가지는 안 흔들린다.
 */
export async function createClassReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  // 강사 직급 = 자기 평가 전용(원장 2026-08-19) — 평가 건 개설은 사무실 몫(남의 건을 열 수 있으면
  // "누구를 평가하는지"부터가 인사 정보다). 화면도 같은 조건으로 '새 평가' 버튼을 감춘다(#77).
  if (isSelfOnlyReviewer(gate.user.systemRole)) {
    return { error: "평가 건 개설은 사무실에서 합니다 — 본인 평가만 작성할 수 있습니다" };
  }

  const date = kstToday();
  const teacherId = String(formData.get("teacherId") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const observerMode = String(formData.get("observerMode") ?? "") === "open" ? "open" : "assigned";
  // 평가자 정원(원장 지시 2026-08-18) — 범위 밖·빈 값은 normalize가 기본 3으로 접는다.
  const observerLimit = normalizeObserverLimit(formData.get("observerCount"));
  if (!teacherId) return { error: "평가 대상 강사를 선택하세요" };

  const admin = createAdminClient();
  const { data: teacher } = await admin
    .from("users")
    .select("id, display_name, tenant_id")
    .eq("id", teacherId)
    .maybeSingle();
  if (!teacher || teacher.tenant_id !== gate.user.tenantId) return { error: "강사를 찾을 수 없습니다" };

  // 지정 모드: 참관자(정원만큼 선택). 선착순 모드: 지정 없이 본인 슬롯만 — 권한자 중 먼저 채점한 정원만큼이 참관자.
  const evaluators: ReviewEvaluator[] = [];
  if (observerMode === "assigned") {
    // ⚠️ 폼이 정원만큼만 칸을 그리므로 루프도 정원까지 — 고정 3칸으로 되돌리면 4번째부터 조용히 버려진다.
    for (let n = 1; n <= observerLimit; n++) {
      const key = `observer${n}`;
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

  // 문항 세트 스냅샷 — 선택한 세트 > 첫 세트 > 내장 기본. 항상 문서에 동결한다.
  const templates = await getChecklistTemplates(gate.user.tenantId);
  const chosen = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;

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
      observerLimit,
    },
    evaluators,
    submissions: {},
    areas: chosen?.areas ?? CHECKLIST_AREAS,
    templateName: chosen?.name ?? "기본 문항",
  };
  const { data: row, error } = await admin
    .from("academy_documents")
    .insert({
      tenant_id: gate.user.tenantId,
      title: `직원평가 — ${teacher.display_name} ${date}`,
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
    metadata: { date, observerMode, observerLimit, assigned: evaluators.length - 1, template: doc.templateName },
  });
  revalidatePath("/class-review");
  redirect(`/class-review/${row.id}`);
}

/**
 * 채점 제출 — 지정 모드: 지정된 평가자(관찰자=자기 userId 슬롯, 대상 강사='self')만.
 * 선착순 모드: 대상 강사='self', 그 외 권한자는 **먼저 제출한 정원(observerLimitOf)까지** 자기 userId 슬롯.
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
  const [{ data: row, error: readErr }, defaultAreas] = await Promise.all([
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

  // 문항 = 문서 스냅샷 우선(세트 복수화) — 구버전 문서만 테넌트 기본 세트.
  const areas =
    sanitizeAreas((row.form_data as { areas?: unknown } | null)?.areas) ?? defaultAreas;
  const total = itemCountOf(areas);
  const scores: number[] = [];
  for (let i = 0; i < total; i++) scores.push(normalizeScore(formData.get(`q${i}`)));
  const comment = String(formData.get("comment") ?? "").trim();

  const doc = (row.form_data ?? {}) as ReviewDoc;
  const evaluators: ReviewEvaluator[] = Array.isArray(doc.evaluators) ? doc.evaluators : [];
  const isSelf = doc.header?.teacherId === gate.user.id;
  const openMode = doc.header?.observerMode === "open";

  // 강사 직급은 **본인 평가지의 본인 채점**만(원장 2026-08-19). 지정 관찰자로 박혀 있거나 선착순
  // 자리가 남아 있어도 남의 평가지엔 못 쓴다 — 조회는 이미 가려지지만 POST는 화면을 안 거친다(#77).
  if (isSelfOnlyReviewer(gate.user.systemRole) && !isSelf) {
    return { error: "본인 평가만 작성할 수 있습니다" };
  }

  let slot: string;
  if (isSelf) slot = "self";
  else if (openMode) {
    // 선착순 — 이미 내 장이 있으면 갱신, 없으면 남은 슬롯이 있어야 새로 차지.
    const observers = observerColumns({ ...doc, id: docId, createdAt: "" });
    const mineAlready = observers.some((o) => o.slot === gate.user.id) || !!doc.submissions?.[gate.user.id];
    const limit = observerLimitOf(doc);
    if (!mineAlready && observers.length >= limit) {
      return { error: `평가자 ${limit}명이 이미 채점을 마쳤습니다 (선착순 마감)` };
    }
    slot = gate.user.id;
  } else {
    const mine = evaluators.find((e) => e.id === gate.user.id && e.kind === "observer");
    if (!mine) return { error: "이 참관 건의 평가자로 지정되어 있지 않습니다" };
    slot = gate.user.id;
  }

  const submissions = { ...(doc.submissions ?? {}) };
  const now = new Date().toISOString();
  // 처음 완료된 시각은 굳힌다 — 지난달에 낸 평가를 이번 달에 고쳐도 지난달 평가로 남는다(직원 포트폴리오).
  const completedAt = firstCompletedAt(submissions[slot], scores, areas, now);
  submissions[slot] = {
    scores,
    comment,
    submittedAt: now,
    ...(completedAt ? { completedAt } : {}),
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

/**
 * 목록 보기 필터를 본인 계정에 저장 — users.ui_prefs.classReview.listFilter(뷰 세팅 계정 귀속 원칙).
 * 필터링은 클라가 즉시 하므로 revalidate 없음 — 이 저장은 다음 방문용 영속화일 뿐이다.
 * 게이트는 로그인만(개인 표시 취향 — ECS setMyEcsEnglishTrack과 같은 규약).
 * ⚠️ ui_prefs는 화면별 네임스페이스 — classReview 키만 갈아끼우고 형제 키(timetable·ecs…)는 보존한다.
 */
export async function setMyClassReviewFilter(
  filter: ClassReviewFilter,
): Promise<{ ok: boolean; error?: string }> {
  if (normalizeClassReviewFilter(filter) !== filter) return { ok: false, error: "잘못된 값입니다" };
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "class-review.actions.setMyClassReviewFilter", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw.classReview && typeof raw.classReview === "object" && !Array.isArray(raw.classReview)
      ? { ...(raw.classReview as Record<string, unknown>) }
      : {};
  // 기본값(전체)은 저장하지 않는다 — 빈 값이 쌓이지 않게(타임테이블·ECS와 같은 규약).
  if (filter === DEFAULT_CLASS_REVIEW_FILTER) delete ns.listFilter;
  else ns.listFilter = filter;

  const merged = { ...raw };
  if (Object.keys(ns).length === 0) delete merged.classReview;
  else merged.classReview = ns;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-review.actions.setMyClassReviewFilter", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/**
 * 지정(assigned) 모드 평가자 교체 — **아직 채점하지 않은** 평가자만 다른 직원으로 바꾼다
 * (원장 지시 2026-08-21: *"평가자 중에서 평가 아직 안했으면 평가자 사람 변경 가능하게"*).
 *
 * 🔴 이미 채점을 마친 평가자는 못 바꾼다 — 바꾸면 그 사람이 매긴 점수가 사라진다(불가역).
 * 🔴 선착순(open) 모드는 애초에 평가자를 지정하지 않으므로 교체 대상이 없다(먼저 채점한 N명이 평가자).
 * ⚠️ 강사 직급 불가 — 평가자 구성은 인사 결정이라 사무실 몫(자기 평가 전용, #77).
 * ⚠️ 한 문서에 여러 채점이 담긴 read-modify-write라 동시 편집 창이 이론상 있다(테스트 단계 감수,
 *    submitClassReviewScores와 같은 트레이드오프) — 그래서 바로 직전에 "미채점"을 재확인한다.
 */
export async function replaceReviewObserver(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  if (isSelfOnlyReviewer(gate.user.systemRole)) {
    return { error: "평가자 변경은 사무실에서 합니다" };
  }

  const docId = String(formData.get("docId") ?? "").trim();
  const oldId = String(formData.get("oldObserverId") ?? "").trim();
  const newId = String(formData.get("newObserverId") ?? "").trim();
  if (!docId || !oldId || !newId) return { error: "평가자 정보를 찾을 수 없습니다" };
  if (oldId === newId) return { error: "같은 사람으로는 바꿀 수 없습니다" };

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
  const target = (Array.isArray(doc.evaluators) ? doc.evaluators : []).find(
    (e) => e.id === oldId && e.kind === "observer",
  );

  // 새 평가자 검증 — 같은 테넌트·재직 중(대상 강사·중복 참여는 순수 판정이 거른다).
  const { data: u } = await admin
    .from("users")
    .select("id, display_name, tenant_id, status")
    .eq("id", newId)
    .maybeSingle();
  if (!u || u.tenant_id !== gate.user.tenantId) return { error: "직원을 찾을 수 없습니다" };
  if (u.status === "inactive") return { error: "재직 중인 직원만 평가자로 지정할 수 있습니다" };

  // 교체 가부·결과는 순수 함수가 결정(open·미발견·이미채점·대상강사·중복 전부 여기서, read-modify-write 최종 확인).
  const plan = planObserverReplacement(doc, oldId, { id: u.id, name: u.display_name });
  if ("error" in plan) return { error: plan.error };

  const { error } = await admin
    .from("academy_documents")
    .update({
      form_data: { ...doc, evaluators: plan.evaluators, submissions: plan.submissions },
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", gate.user.tenantId)
    .eq("id", docId);
  if (error) return { error: humanizeDbError(error.message, "저장") };

  await logAction({
    action: "class_review_observer_replace",
    targetType: "user",
    targetLabel: doc.header?.teacherName ?? null,
    metadata: { docId, from: target?.name ?? oldId, to: u.display_name },
  });
  revalidatePath(`/class-review/${docId}`);
  revalidatePath("/class-review");
  return { ok: true, notice: `평가자를 ${u.display_name} 님으로 변경했습니다` };
}

/** 참관 건 삭제 — 잘못 만든 건 정리(초안: 쓰기 권한자 누구나). */
export async function deleteClassReview(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  // 강사 직급 불가 — 본인 평가지라도 인사 기록이라 지울 수 없다(원장 2026-08-19). 화면도 같은 조건.
  if (isSelfOnlyReviewer(gate.user.systemRole)) {
    return { error: "평가 건 삭제는 사무실에서 합니다" };
  }
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
 * 문항 세트 저장(복수화, 원장 지시 2026-08-05 — "1번 문항세트 2번 문항세트 여러 개") —
 * **원장 + class_review 개인 예외 인원만**(원장 지시 2026-08-04).
 * templateId 있으면 그 세트 수정, 없으면 새 세트 생성(생성 후 그 세트 편집 화면으로 이동).
 * 기존 평가지는 생성 시점 스냅샷이라 세트를 고쳐도 안 흔들린다 — 새 평가부터 적용.
 */
export async function saveChecklistTemplate(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  const priv = await getReviewPrivileges();
  if (!priv.editTemplate) return { error: "문항 편집은 원장·지정 인원만 가능합니다" };

  const templateId = String(formData.get("templateId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("areasJson") ?? "[]"));
  } catch {
    return { error: "문항 형식이 올바르지 않습니다" };
  }
  const areas = sanitizeAreas(parsed);
  if (!areas) return { error: "문항 형식이 올바르지 않습니다 — 영역 제목과 문항을 확인하세요(영역당 1~20문항)" };

  const admin = createAdminClient();
  const payload = {
    tenant_id: gate.user.tenantId,
    title: `직원 평가 문항 세트${name ? ` — ${name}` : ""}`,
    category: "hr",
    kind: "form",
    form_type: CLASS_REVIEW_TEMPLATE_FORM_TYPE,
    form_data: { name, areas },
    restricted: true,
    // 직원 연결(#77 벽)로 /documents 표면에서 제외 — 대상 직원이 없어 편집자 본인에게 건다(내부 전용 행).
    staff_user_id: gate.user.id,
    uploaded_by: gate.user.id,
    updated_at: new Date().toISOString(),
  };

  let newId: string | null = null;
  if (templateId) {
    const { error, data: updated } = await admin
      .from("academy_documents")
      .update(payload)
      .eq("tenant_id", gate.user.tenantId)
      .eq("form_type", CLASS_REVIEW_TEMPLATE_FORM_TYPE)
      .eq("id", templateId)
      .select("id");
    if (error) return { error: humanizeDbError(error.message, "저장") };
    if (!updated?.length) return { error: "수정할 문항 세트를 찾을 수 없습니다" };
  } else {
    const { error, data: inserted } = await admin
      .from("academy_documents")
      .insert(payload)
      .select("id")
      .single();
    if (error || !inserted) return { error: humanizeDbError(error?.message ?? "unknown", "저장") };
    newId = inserted.id;
  }

  await logAction({
    action: "class_review_template_save",
    targetType: "document",
    targetLabel: name || null,
    metadata: { areas: areas.length, items: areas.reduce((n, a) => n + a.items.length, 0), created: !templateId },
  });
  revalidatePath("/class-review");
  revalidatePath("/class-review/template");
  if (newId) redirect(`/class-review/template?set=${newId}`);
  return { ok: true, notice: "문항 세트를 저장했습니다 — 새 평가부터 적용됩니다" };
}

/** 문항 세트 삭제 — 기존 평가지는 스냅샷이라 영향 없음. 세트가 0개가 되면 내장 기본 문항으로 동작. */
export async function deleteChecklistTemplate(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const gate = await requireWrite();
  if ("error" in gate) return { error: gate.error };
  const priv = await getReviewPrivileges();
  if (!priv.editTemplate) return { error: "문항 편집은 원장·지정 인원만 가능합니다" };

  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) return { error: "삭제할 세트를 찾을 수 없습니다" };

  const { error, data: deleted } = await createAdminClient()
    .from("academy_documents")
    .delete()
    .eq("tenant_id", gate.user.tenantId)
    .eq("form_type", CLASS_REVIEW_TEMPLATE_FORM_TYPE)
    .eq("id", templateId)
    .select("id");
  if (error) return { error: humanizeDbError(error.message, "삭제") };
  if (!deleted?.length) return { error: "이미 삭제된 세트입니다" };

  await logAction({ action: "class_review_template_delete", targetType: "document", metadata: { templateId } });
  revalidatePath("/class-review");
  revalidatePath("/class-review/template");
  redirect("/class-review/template");
}
