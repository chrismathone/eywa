import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeObserverLimit } from "../observer-count";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
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
import { normalizeClassReviewFilter, type ClassReviewFilter } from "../list-filter";

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
};

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
  const user = await getCurrentUser();
  if (!user || !(await canAccessTenant(user.systemRole, "class_review"))) {
    throw new Error("수업 평가를 열람할 권한이 없습니다");
  }
  return user;
}

/**
 * 실명 열람·문항 편집 자격 — **원장(master) + class_review 개인 예외 인원**(원장 지시 2026-08-04).
 * 그 외(향후 역할 개방 시 강사 등)는 평가자 이름이 '평가자 A/B/C'로 익명화된다.
 */
export async function getReviewPrivileges(user: CurrentUser): Promise<{ seeNames: boolean; editTemplate: boolean }> {
  if (user.systemRole === "master") return { seeNames: true, editTemplate: true };
  try {
    const settings = await getTenantSettings();
    const mine = settings.permissions.userOverrides?.some(
      (o) => o.userId === user.id && o.menu === "class_review" && o.access !== "none",
    );
    return { seeNames: !!mine, editTemplate: !!mine };
  } catch {
    return { seeNames: false, editTemplate: false };
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
  if (error) throw new Error(`수업 평가 목록 조회 실패: ${error.message}`);
  const rows = (data ?? []).map((r) => {
    const doc = parseDoc(r);
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
  if (error) throw new Error(`수업 평가 조회 실패: ${error.message}`);
  if (!data) return null;
  const doc = parseDoc(data);
  // 반환 areas = 이 평가지의 유효 문항(스냅샷 우선) — 상세·채점이 그대로 쓴다.
  return { doc, areas: doc.areas ?? areas };
}
