import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { AssignedBook } from "../math-assignment";
import type { TextbookTableStatus } from "../types";

/**
 * 수학 교재 배정 조회 — **admin + `tenant_id` 명시 필터**(교재목록 조회와 같은 경로).
 * 🔴 게이트는 호출부가 먼저 통과시킨다(MCS 화면 = `getMathSheetMonth` 안의 `requireMcsClassAccess`).
 * ⚠️ 표가 아직 없으면(마이그레이션 미적용) `missing-table`로 돌려준다 — 화면은 살고 배정 칸만 잠긴다([[#95]]).
 */

export type MathTextbookChoice = { id: string; title: string };

export type MathClassTextbooks = {
  status: TextbookTableStatus;
  classBook: AssignedBook | null;
  byStudent: Record<string, AssignedBook>;
  /** 교재목록의 수학 교재(고르는 목록 + "같은 교재" 확인의 기준). */
  choices: MathTextbookChoice[];
};

/**
 * 이 표가 아직 없다(마이그레이션 미적용) — 코드(42P01/PGRST205) 또는 문구로 판정한다.
 * ⚠️ 배치 헬퍼는 error를 `Error(message)`로 다시 던져 code가 사라지므로 문구도 본다.
 */
function isMissingAssignTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = error.message ?? "";
  return msg.includes("math_textbook_assignments") && /not find|does not exist|schema cache/i.test(msg);
}

type AssignmentRow = { student_id: string | null; textbook_id: string; textbooks: { title: string } | null };

export async function getMathClassTextbooks(tenantId: string, classId: string): Promise<MathClassTextbooks> {
  const admin = createAdminClient();
  const [assignRes, choices] = await Promise.all([
    admin
      .from("math_textbook_assignments")
      .select("student_id, textbook_id, textbooks!math_textbook_assignments_textbook_fkey(title)")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    getMathTextbookChoices(tenantId),
  ]);
  const empty = { classBook: null, byStudent: {}, choices: choices ?? [] };
  if (assignRes.error) {
    return { ...empty, status: isMissingAssignTable(assignRes.error) ? "missing-table" : "failed" };
  }
  if (choices === null) return { ...empty, status: "failed" };

  let classBook: AssignedBook | null = null;
  const byStudent: Record<string, AssignedBook> = {};
  for (const r of (assignRes.data ?? []) as unknown as AssignmentRow[]) {
    const book = { textbookId: r.textbook_id, title: r.textbooks?.title ?? "(지워진 교재)" };
    if (r.student_id) byStudent[r.student_id] = book;
    else classBook = book;
  }
  return { status: "ok", classBook, byStudent, choices };
}

/** 교재목록의 활성 수학 교재. 실패면 null(빈 목록은 "교재가 없다"는 거짓말이다). */
export async function getMathTextbookChoices(tenantId: string): Promise<MathTextbookChoice[] | null> {
  const admin = createAdminClient();
  try {
    const rows = await fetchAllPaged<{ id: string; title: string }>((from, to) =>
      admin
        .from("textbooks")
        .select("id, title")
        .eq("tenant_id", tenantId)
        .eq("subject", "math")
        .eq("is_active", true)
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => ({ id: r.id, title: r.title }));
  } catch {
    return null;
  }
}

export type MathAssignmentListRow = {
  id: string;
  classId: string;
  className: string;
  studentName: string | null;
  title: string;
  updatedAt: string;
};

/** 교재목록 '반 배정' 면(수학) — 읽기 전용 목록. 배정은 수학 강사 시트에서 한다. */
export async function getMathAssignmentList(
  tenantId: string,
): Promise<{ status: TextbookTableStatus; rows: MathAssignmentListRow[] }> {
  const admin = createAdminClient();
  try {
    type ListRow = {
      id: string;
      class_id: string;
      updated_at: string;
      classes: { class_name: string } | null;
      students: { name: string } | null;
      textbooks: { title: string } | null;
    };
    const raw = await fetchAllPaged<Record<string, unknown>>((from, to) =>
      admin
        .from("math_textbook_assignments")
        .select(
          "id, class_id, updated_at, classes!math_textbook_assignments_class_fk(class_name), students!math_textbook_assignments_student_id_fkey(name), textbooks!math_textbook_assignments_textbook_fkey(title)",
        )
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    );
    const rows = raw as unknown as ListRow[];
    return {
      status: "ok",
      rows: rows.map((r) => ({
        id: r.id,
        classId: r.class_id,
        className: r.classes?.class_name ?? "—",
        studentName: r.students?.name ?? null,
        title: r.textbooks?.title ?? "—",
        updatedAt: r.updated_at,
      })),
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { status: isMissingAssignTable(err) ? "missing-table" : "failed", rows: [] };
  }
}
