import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import type { AssignedBook } from "../math-assignment";
import { bookPosition, inferBookFromReports, type BookPosition, type CatalogBook, type ReportLine } from "../math-book-match";
import { latestOrderedBook, type BookOrder } from "../book-window";
import { SENT_REPORT_OR } from "@/features/math-sheets/lib/sent-reports";
import type { TextbookTableStatus } from "../types";
import { isMissingGradeTermColumn } from "./access";

/**
 * 수학 교재 배정 조회 — **admin + `tenant_id` 명시 필터**(교재목록 조회와 같은 경로).
 * 🔴 게이트는 호출부가 먼저 통과시킨다(MCS 화면 = `getMathSheetMonth` 안의 `requireMcsClassAccess`).
 * ⚠️ 표가 아직 없으면(마이그레이션 미적용) `missing-table`로 돌려준다 — 화면은 살고 배정 칸만 잠긴다([[#95]]).
 */

/** `gradeTerm` = 학년·학기(`고1-1`) — 진도 카드 줄 세우기 재료. SQL 적용 전이면 null. */
export type MathTextbookChoice = { id: string; title: string; gradeTerm?: string | null };

/**
 * 학생의 지금 교재 + 그 교재에서의 차수. 출처: 학생 배정 > **교재 주문** > 반 배정 > 보고서 기록에서 추정.
 * (원장 2026-10-19 *"교재 주문 시 해당 학생의 교재로 교재 등록"* — 주문은 그 학생만의 사실이라 반 교재보다 앞선다.)
 */
export type StudentBookNow = {
  book: AssignedBook;
  source: "student" | "order" | "class" | "report";
  /** 보고서 진도가 그 교재 차수에 걸린 가장 최근 기록. 못 찾으면 null. */
  position: BookPosition | null;
};

export type MathClassTextbooks = {
  status: TextbookTableStatus;
  classBook: AssignedBook | null;
  byStudent: Record<string, AssignedBook>;
  /** 교재목록의 수학 교재(고르는 목록 + "같은 교재" 확인의 기준). */
  choices: MathTextbookChoice[];
  /** 학생별 지금 교재·차수 — 배정이 없어도 보고서 기록에서 교재를 읽어 채운다(원장 2026-10-19 "매핑만 하면"). */
  now: Record<string, StudentBookNow>;
  /**
   * 3개월 창 계산 재료(서버 전용 — 클라에 넘기지 말 것). 창은 수업일(학습 맥락)이 있어야 해서 페이지가 마저 계산한다.
   */
  sources: { catalog: CatalogBook[]; orders: Map<string, BookOrder[]>; reports: Map<string, ReportLine[]> };
};

/** 교재를 읽을 보고서 기간 — 한 학기(교재 한 권을 넘기는 시간)면 충분하다. */
const REPORT_LOOKBACK_DAYS = 180;

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

export async function getMathClassTextbooks(
  tenantId: string,
  classId: string,
  studentIds: string[],
): Promise<MathClassTextbooks> {
  const admin = createAdminClient();
  const [assignRes, catalog, reports, orders] = await Promise.all([
    admin
      .from("math_textbook_assignments")
      .select("student_id, textbook_id, textbooks!math_textbook_assignments_textbook_fkey(title)")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    getMathCatalogBooks(tenantId),
    getClassReportLines(tenantId, classId, studentIds),
    getStudentBookOrders(tenantId, studentIds),
  ]);
  const choices = catalog?.map((b) => ({ id: b.id, title: b.title })) ?? [];
  const books = catalog ?? [];

  let status: TextbookTableStatus = "ok";
  let classBook: AssignedBook | null = null;
  const byStudent: Record<string, AssignedBook> = {};
  if (assignRes.error) status = isMissingAssignTable(assignRes.error) ? "missing-table" : "failed";
  else if (catalog === null) status = "failed";
  else {
    for (const r of (assignRes.data ?? []) as unknown as AssignmentRow[]) {
      const book = { textbookId: r.textbook_id, title: r.textbooks?.title ?? "(지워진 교재)" };
      if (r.student_id) byStudent[r.student_id] = book;
      else classBook = book;
    }
  }

  // 🔑 배정 표가 없거나(적용 전) 실패해도 **기록에서 읽은 교재·차수는 보여준다** — 그건 배정 표와 무관한 사실이다.
  const now: Record<string, StudentBookNow> = {};
  for (const sid of studentIds) {
    const lines = reports?.get(sid) ?? [];
    const ordered = latestOrderedBook(orders?.get(sid) ?? [], books);
    const assigned = byStudent[sid] ? { book: byStudent[sid]!, source: "student" as const }
      : ordered ? { book: { textbookId: ordered.book.id, title: ordered.book.title }, source: "order" as const }
      : classBook ? { book: classBook, source: "class" as const } : null;
    if (assigned) {
      const cat = books.find((b) => b.id === assigned.book.textbookId);
      now[sid] = { ...assigned, position: cat ? bookPosition(cat, lines, books) : null };
      continue;
    }
    const inferred = inferBookFromReports(lines, books);
    if (inferred) {
      now[sid] = {
        book: { textbookId: inferred.id, title: inferred.title },
        source: "report",
        // 추정한 교재면 교재 칸까지 그 교재인 기록만 센다 — 다른 책 진도가 차수로 둔갑하지 않게.
        position: bookPosition(inferred, lines, books, true),
      };
    }
  }
  return {
    status, classBook, byStudent, choices, now,
    sources: { catalog: books, orders: orders ?? new Map(), reports: reports ?? new Map() },
  };
}

/** 교재목록의 수학 교재 + 차수(소단원). 실패면 null. */
export async function getMathCatalogBooks(tenantId: string): Promise<CatalogBook[] | null> {
  const choices = await getMathTextbookChoices(tenantId);
  if (choices === null) return null;
  if (choices.length === 0) return [];
  const admin = createAdminClient();
  try {
    const lessons = await fetchAllPagedInChunks<{ textbook_id: string; lesson_no: number; progress: string | null }>(
      choices.map((c) => c.id),
      (chunk, from, to) =>
        admin
          .from("textbook_lessons")
          .select("textbook_id, lesson_no, progress")
          .eq("tenant_id", tenantId)
          .in("textbook_id", chunk)
          .order("textbook_id", { ascending: true })
          .order("lesson_no", { ascending: true })
          .range(from, to),
    );
    const byBook = new Map<string, CatalogBook["lessons"]>();
    for (const l of lessons) {
      const list = byBook.get(l.textbook_id) ?? [];
      list.push({ lessonNo: l.lesson_no, progress: l.progress });
      byBook.set(l.textbook_id, list);
    }
    return choices.map((c) => ({ ...c, lessons: byBook.get(c.id) ?? [] }));
  } catch {
    return null;
  }
}

/**
 * 학생들의 교재 주문(교재 신청) — 날짜 = **주문 체크한 날**(KST), 아직 주문 전이면 요청일.
 * 실패면 null(주문 갈래만 빠지고 화면은 산다).
 */
export async function getStudentBookOrders(tenantId: string, studentIds: string[]): Promise<Map<string, BookOrder[]> | null> {
  if (studentIds.length === 0) return new Map();
  const admin = createAdminClient();
  try {
    const rows = await fetchAllPagedInChunks<{ student_id: string; book_name: string; request_date: string | null; ordered_at: string | null; created_at: string }>(
      studentIds,
      (chunk, from, to) =>
        admin
          .from("textbook_orders")
          .select("id, student_id, book_name, request_date, ordered_at, created_at")
          .eq("tenant_id", tenantId)
          .in("student_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
    const out = new Map<string, BookOrder[]>();
    for (const r of rows) {
      const date = r.ordered_at ? kstToday(new Date(r.ordered_at)) : (r.request_date ?? kstToday(new Date(r.created_at)));
      const list = out.get(r.student_id) ?? [];
      list.push({ bookName: r.book_name, date });
      out.set(r.student_id, list);
    }
    return out;
  } catch {
    return null;
  }
}

/** 이 반 학생들의 최근 보고서(교재·진도) — 학생별. 실패면 null(추정만 빠지고 화면은 산다). */
async function getClassReportLines(
  tenantId: string,
  classId: string,
  studentIds: string[],
): Promise<Map<string, ReportLine[]> | null> {
  if (studentIds.length === 0) return new Map();
  const admin = createAdminClient();
  const since = addDays(kstToday(), -REPORT_LOOKBACK_DAYS);
  try {
    const rows = await fetchAllPagedInChunks<{ student_id: string; report_date: string; textbook: string | null; progress: string | null }>(
      studentIds,
      (chunk, from, to) =>
        admin
          .from("lesson_reports")
          .select("id, student_id, report_date, textbook, progress")
          .eq("tenant_id", tenantId)
          .eq("class_id", classId)
          .in("student_id", chunk)
          // 진도 레일과 같은 기록만 — 클래스노트로 실제 나간 보고서(초안·회수분 제외).
          .or(SENT_REPORT_OR)
          .is("revoked_at", null)
          .gte("report_date", since)
          .order("id", { ascending: true })
          .range(from, to),
    );
    const out = new Map<string, ReportLine[]>();
    for (const r of rows) {
      const list = out.get(r.student_id) ?? [];
      list.push({ date: r.report_date, textbook: r.textbook, progress: r.progress });
      out.set(r.student_id, list);
    }
    return out;
  } catch {
    return null;
  }
}

/** 교재목록의 활성 수학 교재. 실패면 null(빈 목록은 "교재가 없다"는 거짓말이다). */
export async function getMathTextbookChoices(tenantId: string): Promise<MathTextbookChoice[] | null> {
  const admin = createAdminClient();
  type Row = { id: string; title: string; grade_term?: string | null };
  const read = (cols: string) =>
    fetchAllPaged<Row>((from, to) =>
      admin
        .from("textbooks")
        .select(cols)
        .eq("tenant_id", tenantId)
        .eq("subject", "math")
        .eq("is_active", true)
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Row[]>(),
    );
  try {
    // 🔑 강사가 매일 여는 수학 시트 경로다 — `grade_term`(20261022120000) 적용 전이면 그 칸만 빼고 다시 읽는다([[#95]]).
    const rows = await read("id, title, grade_term").catch((e: unknown) => {
      if (isMissingGradeTermColumn(e as { code?: string; message?: string })) return read("id, title");
      throw e;
    });
    return rows.map((r) => ({ id: r.id, title: r.title, gradeTerm: r.grade_term ?? null }));
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
