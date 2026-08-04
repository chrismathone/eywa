import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { averageTotals, computeTotals, type ScoreSheet, type SheetTotals } from "../checklist";

// 수업 평가(참관) 저장 = academy_documents 행(kind='form', form_type='class_review') 재사용 — 새 테이블·SQL 0.
// staff_user_id = 평가 대상 강사(직원 연결이라 /documents 표면에선 자동 제외, #77 벽 공유), restricted=true.
// 게이트는 앱(canAccessTenant "class_review", 개인 예외 반영) + admin client + tenant 명시 필터(계약서 파일과 동일 규약).

export const CLASS_REVIEW_FORM_TYPE = "class_review";

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
  session: string; // 회차
  classTime: string;
  studentCount: string;
};

export type ReviewDoc = {
  id: string;
  createdAt: string;
  header: ReviewHeader;
  evaluators: ReviewEvaluator[];
  /** 평가자 키(관찰자=users.id 또는 name, 본인='self') → 채점 한 장 */
  submissions: Record<string, ScoreSheet>;
};

export type ReviewListRow = ReviewDoc & {
  submittedCount: number;
  averages: SheetTotals | null;
};

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
    },
    evaluators: Array.isArray(d.evaluators) ? (d.evaluators as ReviewEvaluator[]) : [],
    submissions: (d.submissions ?? {}) as Record<string, ScoreSheet>,
  };
}

async function requireRead() {
  const user = await getCurrentUser();
  if (!user || !(await canAccessTenant(user.systemRole, "class_review"))) {
    throw new Error("수업 평가를 열람할 권한이 없습니다");
  }
  return user;
}

export async function listClassReviews(): Promise<ReviewListRow[]> {
  const user = await requireRead();
  const { data, error } = await createAdminClient()
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", user.tenantId)
    .eq("form_type", CLASS_REVIEW_FORM_TYPE)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`수업 평가 목록 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => {
    const doc = parseDoc(r);
    const sheets = Object.values(doc.submissions);
    return {
      ...doc,
      submittedCount: sheets.filter((s) => computeTotals(s).answered > 0).length,
      averages: averageTotals(sheets),
    };
  });
}

export async function getClassReview(id: string): Promise<ReviewDoc | null> {
  const user = await requireRead();
  const { data, error } = await createAdminClient()
    .from("academy_documents")
    .select("id, created_at, form_data")
    .eq("tenant_id", user.tenantId)
    .eq("form_type", CLASS_REVIEW_FORM_TYPE)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`수업 평가 조회 실패: ${error.message}`);
  return data ? parseDoc(data) : null;
}
