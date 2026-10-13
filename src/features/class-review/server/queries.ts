import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeObserverLimit } from "../observer-count";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import type { SystemRole } from "@/lib/permissions";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  averageTotals,
  CHECKLIST_AREAS,
  computeTotals,
  sanitizeAreas,
  type ChecklistArea,
  type ScoreSheet,
  type SheetTotals,
} from "../checklist";
import { canSeePortfolio } from "../faces";
import { normalizeClassReviewFilter, type ClassReviewFilter } from "../list-filter";
import { isOwnReview, isSelfOnlyReviewer, redactForSelfOnly } from "../self-only";

// 수업 평가(참관) 저장 = academy_documents 행(kind='form', form_type='class_review') 재사용 — 새 테이블·SQL 0.
// staff_user_id = 평가 대상 강사(직원 연결이라 /documents 표면에선 자동 제외, #77 벽 공유), restricted=true.
// 게이트는 앱(canAccessTenant "class_review", 개인 예외 반영) + admin client + tenant 명시 필터(계약서 파일과 동일 규약).

export const CLASS_REVIEW_FORM_TYPE = "class_review";
/** 문항 커스텀 템플릿(원장·예외 인원이 편집) — 테넌트당 1행. */
export const CLASS_REVIEW_TEMPLATE_FORM_TYPE = "class_review_template";

export type ReviewEvaluator = {
  /** users.id — 자유 입력 참관자는 null(이름만). */
  id: string | null;
  name: string;
  kind: "observer" | "self";
};

export type ReviewHeader = {
  date: string; // 참관일 YYYY-MM-DD
  teacherId: string;
  teacherName: string;
  subject: string; // 과목 key(설정 단일 소스) — 표시할 땐 labelOf
  className: string;
  session: string;
  classTime: string;
  studentCount: string;
  /** 참관자 방식 — assigned: 생성 시 지정 / open: 선착순(정원은 observerLimit). 구버전 문서는 assigned 취급. */
  observerMode?: "assigned" | "open";
  /**
   * 평가자 정원(지정 슬롯 수 / 선착순 마감 수) — 생성 시 고른 값을 **문서에 동결**한다.
   * 없으면 3(구버전 문서가 실제로 돌던 값). 기본값이 바뀌어도 옛 평가의 정원은 안 흔들린다.
   */
  observerLimit?: number;
};

export type ReviewDoc = {
  id: string;
  createdAt: string;
  header: ReviewHeader;
  evaluators: ReviewEvaluator[];
  /** 평가자 키(관찰자=users.id, 본인='self') → 채점 한 장 */
  submissions: Record<string, ScoreSheet>;
  /**
   * 생성 시점의 문항 스냅샷(2026-08-05 문항 세트 복수화) — 이후 세트를 고쳐도 이 평가지는 안 흔들린다.
   * 없으면(구버전 문서) 테넌트 기본 세트로 폴백.
   */
  areas?: ChecklistArea[];
  /** 사용한 문항 세트 이름(표시용 스냅샷). */
  templateName?: string;
  /**
   * 최종 총평 — 평가지당 하나, 사무실(원장·지정 인원)이 채점을 다 본 뒤 쓴다(원장 2026-09-29
   * "코멘트 말고도 총평란이 또 있어야할듯"). 평가자별 코멘트(submissions[].comment)와 **다른 칸**이다.
   * 강사(자기 평가 전용)에겐 조회 초크포인트에서 잘린다(redactForSelfOnly).
   */
  finalReview?: FinalReview;
};

export type FinalReview = { text: string; updatedAt: string; by: { id: string; name: string } };

function parseFinalReview(raw: unknown): FinalReview | undefined {
  const f = raw as Partial<FinalReview> | null | undefined;
  if (!f || typeof f.text !== "string" || !f.text.trim()) return undefined;
  return {
    text: f.text,
    updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : "",
    by: { id: String(f.by?.id ?? ""), name: String(f.by?.name ?? "") },
  };
}

export type ReviewListRow = ReviewDoc & {
  submittedCount: number;
  observerSlots: number;
  averages: SheetTotals | null;
};

/**
 * 이 평가의 평가자 정원. 🔴 **고정 상수를 다시 쓰지 말 것** — 인원이 생성 시 선택값이 된 뒤로는
 * (원장 지시 2026-08-18) 문서마다 다르다. 상수로 판정하면 정원 5명짜리가 3명에서 마감되고,
 * 이미 채점한 4·5번째가 화면에서 사라진다.
 */
export function observerLimitOf(doc: { header?: ReviewHeader }): number {
  // header가 없는 raw 문서(파싱 전 form_data)에서도 부른다 — 옵셔널 체이닝 유지.
  return normalizeObserverLimit(doc.header?.observerLimit);
}

function parseDoc(r: { id: string; created_at: string; form_data: unknown }): ReviewDoc {
  const d = (r.form_data ?? {}) as Partial<ReviewDoc> & { header?: ReviewHeader };
  return {
    id: r.id,
    createdAt: r.created_at,
    header: {
      date: d.header?.date ?? "",
      teacherId: d.header?.teacherId ?? "",
      teacherName: d.header?.teacherName ?? "",
      subject: d.header?.subject ?? "",
      className: d.header?.className ?? "",
      session: d.header?.session ?? "",
      classTime: d.header?.classTime ?? "",
      studentCount: d.header?.studentCount ?? "",
      observerMode: d.header?.observerMode === "open" ? "open" : "assigned",
      observerLimit: normalizeObserverLimit(d.header?.observerLimit),
    },
    evaluators: Array.isArray(d.evaluators) ? (d.evaluators as ReviewEvaluator[]) : [],
    submissions: (d.submissions ?? {}) as Record<string, ScoreSheet>,
    areas: sanitizeAreas(d.areas) ?? undefined,
    templateName: typeof d.templateName === "string" && d.templateName ? d.templateName : undefined,
    finalReview: parseFinalReview(d.finalReview),
  };
}

/** 선착순(open) 모드의 관찰자 슬롯 = 본인 제외 제출들(제출 순서). 지정 모드는 evaluators 그대로. */
export function observerColumns(doc: ReviewDoc): { slot: string; name: string }[] {
  if (doc.header.observerMode === "open") {
    return Object.entries(doc.submissions)
      .filter(([slot]) => slot !== "self")
      .sort((a, b) => String(a[1].submittedAt ?? "").localeCompare(String(b[1].submittedAt ?? "")))
      .slice(0, observerLimitOf(doc))
      .map(([slot, sheet]) => ({ slot, name: sheet.by?.name ?? "평가자" }));
  }
  return doc.evaluators
    .filter((e) => e.kind === "observer")
    .map((e) => ({ slot: e.id ?? e.name, name: e.name }));
}

/**
 * 내 채점 자격 — 본인('self') / 지정 관찰자 / 선착순(마감 전 또는 이미 내 장 있음).
 * 반환: 슬롯 키 + 이미 제출했는지(수정하기/평가하기 버튼 분기). 자격 없으면 null.
 */
export function myScoreSlot(
  doc: ReviewDoc,
  viewerId: string,
): { slot: string; submitted: boolean } | null {
  const isSelf = doc.header.teacherId === viewerId;
  if (isSelf) {
    const sheet = doc.submissions["self"];
    return { slot: "self", submitted: !!sheet?.scores?.some((v) => v > 0) };
  }
  const openMode = doc.header.observerMode === "open";
  const observers = observerColumns(doc);
  const mineSheet = doc.submissions[viewerId];
  if (openMode) {
    const seated = observers.some((o) => o.slot === viewerId) || !!mineSheet;
    if (!seated && observers.length >= observerLimitOf(doc)) return null;
    return { slot: viewerId, submitted: !!mineSheet?.scores?.some((v) => v > 0) };
  }
  const assigned = doc.evaluators.some((e) => e.id === viewerId && e.kind === "observer");
  if (!assigned) return null;
  return { slot: viewerId, submitted: !!mineSheet?.scores?.some((v) => v > 0) };
}

async function requireRead() {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canAccessTenant(user.systemRole, "class_review"))) {
    throw new Error("직원 평가를 열람할 권한이 없습니다");
  }
  return user;
}

/**
 * 이 화면을 **누구의 눈으로** 보는가 — 목록·상세·자격·채점 판정의 단일 소스.
 *
 * 🔴 **'다른 강사 뷰'(열람 전용)면 대상 강사의 눈으로 본다**(원장 제보 2026-08-19:
 *    *"다른 강사뷰 기능에서 보이는 게 실제 보이는 뷰 아님?"* — 그 뷰의 존재 이유가 "그 사람이 보는
 *    화면 그대로"인데, 뷰어의 실 역할로 판정하니 관리자에겐 남의 점수·평가자 이름이 그대로 보였다).
 *    쓰기는 이 판정과 무관하게 perm-matrix 쓰기 캡이 이미 막는다(열람 전용).
 * ⚠️ 대상 역할을 모르면 **가장 좁게(강사)** 잡는다 — 모를 때 넓히면 그게 누수다.
 * ⚠️ 겸직 본인 강사뷰(view=teacher, 대상 없음)는 여기 안 걸린다 — 뷰 토글로 관리자의 열람 범위가
 *    바뀌면 "뷰 전환은 권한을 바꾸지 않는다"(결정 로그)가 깨진다.
 */
export type ReviewViewer = {
  /** 평가지 소유·채점 슬롯 판정에 쓸 id(= 보고 있는 사람) */
  id: string;
  role: SystemRole;
  /** 자기 평가 전용 — 본인 평가지의 본인 채점 한 장만 */
  selfOnly: boolean;
  /** '다른 강사 뷰'(열람 전용)로 보는 중 */
  viewAs: boolean;
};

export const getReviewViewer = cache(async (): Promise<ReviewViewer> => {
  const user = await getCurrentUser({ teacherView: true });
  // 비로그인은 requireRead가 먼저 막는다 — 여기 값은 안전한 최소치.
  if (!user) return { id: "", role: "teacher", selfOnly: true, viewAs: false };
  const target = await viewAsTeacher();
  if (!target) {
    return {
      id: user.id,
      role: user.systemRole,
      selfOnly: isSelfOnlyReviewer(user.systemRole),
      viewAs: false,
    };
  }
  const { data } = await createAdminClient()
    .from("users")
    .select("system_role")
    .eq("id", target.id)
    .eq("tenant_id", user.tenantId) // admin은 RLS 우회 — tenant 명시([[#104]])
    .maybeSingle();
  const role = ((data?.system_role as SystemRole | undefined) ?? "teacher") as SystemRole;
  return { id: target.id, role, selfOnly: isSelfOnlyReviewer(role), viewAs: true };
});

/**
 * 실명 열람·문항 편집 자격 — **원장(master) + class_review 개인 예외 인원**(원장 지시 2026-08-04).
 * 그 외(강사 등)는 평가자 이름이 '평가자 A/B/C'로 익명화된다.
 * 판정 주체는 `getReviewViewer()` — '다른 강사 뷰'에선 **대상 강사의 자격**이 그대로 재현된다.
 */
export async function getReviewPrivileges(): Promise<{
  seeNames: boolean;
  editTemplate: boolean;
  /** 최종 총평 작성 — 실명 열람과 같은 사람들(평가자 전원을 보고 종합하는 자리라서). */
  writeFinalReview: boolean;
  /**
   * 직원 포트폴리오(내부 탭) — 전 강사의 월간 점수와 담당 매출이 한 화면에 실린다.
   * 🔴 원장 역할만 본다. 직원 평가 개인 예외로는 열리지 않는다 — 평가를 맡겼다고 매출·전원 점수까지 열리면 안 된다.
   */
  seePortfolio: boolean;
}> {
  const v = await getReviewViewer();
  // 포트폴리오는 역할보다 '누구의 눈인가'가 먼저다 — 판정은 faces.ts 한 곳(canSeePortfolio).
  const seePortfolio = canSeePortfolio(v, !v.viewAs && !v.selfOnly && (await isCurrentUserSuperAdmin()));
  // 강사 직급 = 자기 평가 전용(원장 2026-08-19) — 개인 예외로 full을 받아도 실명·문항 편집은 없다.
  if (v.selfOnly) return { seeNames: false, editTemplate: false, writeFinalReview: false, seePortfolio };
  if (v.role === "master") return { seeNames: true, editTemplate: true, writeFinalReview: true, seePortfolio };
  try {
    const settings = await getTenantSettings();
    const mine = settings.permissions.userOverrides?.some(
      (o) => o.userId === v.id && o.menu === "class_review" && o.access !== "none",
    );
    return { seeNames: !!mine, editTemplate: !!mine, writeFinalReview: !!mine, seePortfolio };
  } catch {
    return { seeNames: false, editTemplate: false, writeFinalReview: false, seePortfolio };
  }
}

/**
 * 목록 보기 필터 — 계정 귀속(users.ui_prefs.classReview.listFilter, 뷰 세팅 계정 귀속 원칙).
 * 조회 실패·깨진 값은 기본값(전체)으로 — 설정 하나 때문에 목록이 안 열리면 안 된다.
 */
export async function getMyClassReviewFilter(user: CurrentUser): Promise<ClassReviewFilter> {
  const { data } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null;
  const ns = raw?.classReview;
  const listFilter =
    ns && typeof ns === "object" && !Array.isArray(ns)
      ? (ns as Record<string, unknown>).listFilter
      : undefined;
  return normalizeClassReviewFilter(listFilter);
}

/** 문항 세트 하나(2026-08-05 복수화) — academy_documents 행 1개 = 세트 1개. */
export type ChecklistTemplate = { id: string; name: string; areas: ChecklistArea[] };

/**
 * 테넌트의 문항 세트 전부(만든 순서) — 이름이 비어 있으면 "N번 문항 세트"로 표시.
 * 깨진 행(areas 검증 실패)은 목록에서 제외한다(선택지로 내밀면 안 되는 값).
 */
export async function getChecklistTemplates(tenantId: string): Promise<ChecklistTemplate[]> {
  const { data } = await createAdminClient()
    .from("academy_documents")
    .select("id, form_data, created_at")
    .eq("tenant_id", tenantId)
    .eq("form_type", CLASS_REVIEW_TEMPLATE_FORM_TYPE)
    .order("created_at", { ascending: true })
    .limit(50);
  const out: ChecklistTemplate[] = [];
  for (const r of data ?? []) {
    const fd = (r.form_data ?? {}) as { name?: unknown; areas?: unknown };
    const areas = sanitizeAreas(fd.areas);
    if (!areas) continue;
    const name =
      typeof fd.name === "string" && fd.name.trim() ? fd.name.trim() : `${out.length + 1}번 문항 세트`;
    out.push({ id: r.id, name, areas });
  }
  return out;
}

/** 기본 문항 세트 — 첫 세트가 있으면 그것, 없으면 내장 문항(구버전 문서·세트 미선택 폴백). */
export async function getChecklistAreas(tenantId: string): Promise<ChecklistArea[]> {
  const templates = await getChecklistTemplates(tenantId);
  return templates[0]?.areas ?? CHECKLIST_AREAS;
}

export async function listClassReviews(): Promise<{ rows: ReviewListRow[]; areas: ChecklistArea[] }> {
  const user = await requireRead();
  const [{ data, error }, areas] = await Promise.all([
    createAdminClient()
      .from("academy_documents")
      .select("id, created_at, form_data")
      .eq("tenant_id", user.tenantId)
      .eq("form_type", CLASS_REVIEW_FORM_TYPE)
      .order("created_at", { ascending: false })
      .limit(200),
    getChecklistAreas(user.tenantId),
  ]);
  if (error) throw new Error(`직원 평가 목록 조회 실패: ${error.message}`);
  // 강사 직급 = 본인 평가지만, 그것도 본인 채점 한 장만(조회 초크포인트에서 자른다 — 화면 조건 아님, #77).
  // 판정 주체는 getReviewViewer — '다른 강사 뷰'면 그 강사가 보는 목록이 그대로 재현된다.
  const { id: viewerId, selfOnly } = await getReviewViewer();
  const rows = (data ?? []).map(parseDoc)
    .filter((doc) => !selfOnly || isOwnReview(doc, viewerId))
    .map((doc) => (selfOnly ? redactForSelfOnly(doc) : doc))
    .map((doc) => {
    const rowAreas = doc.areas ?? areas; // 스냅샷 우선(세트 복수화) — 구버전 문서만 테넌트 기본 세트
    const sheets = Object.values(doc.submissions);
    const observers = observerColumns(doc);
    return {
      ...doc,
      submittedCount: sheets.filter((s) => computeTotals(s, rowAreas).answered > 0).length,
      observerSlots:
        (doc.header.observerMode === "open" ? observerLimitOf(doc) : observers.length) + 1, // +본인
      averages: averageTotals(sheets, rowAreas),
    };
  });
  return { rows, areas };
}

export async function getClassReview(
  id: string,
): Promise<{ doc: ReviewDoc; areas: ChecklistArea[] } | null> {
  const user = await requireRead();
  const [{ data, error }, areas] = await Promise.all([
    createAdminClient()
      .from("academy_documents")
      .select("id, created_at, form_data")
      .eq("tenant_id", user.tenantId)
      .eq("form_type", CLASS_REVIEW_FORM_TYPE)
      .eq("id", id)
      .maybeSingle(),
    getChecklistAreas(user.tenantId),
  ]);
  if (error) throw new Error(`직원 평가 조회 실패: ${error.message}`);
  if (!data) return null;
  const doc = parseDoc(data);
  // 강사 직급은 **본인 평가지만** 존재한다 — 남의 건 id를 직접 쳐도 없는 것으로(강제 URL 차단, #77).
  const viewer = await getReviewViewer();
  if (viewer.selfOnly) {
    if (!isOwnReview(doc, viewer.id)) return null;
    return { doc: redactForSelfOnly(doc), areas: doc.areas ?? areas };
  }
  // 반환 areas = 이 평가지의 유효 문항(스냅샷 우선) — 상세·채점이 그대로 쓴다.
  return { doc, areas: doc.areas ?? areas };
}
