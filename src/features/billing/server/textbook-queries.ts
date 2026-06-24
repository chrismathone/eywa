import "server-only";
import { createClient } from "@/lib/supabase/server";

// 교재신청(textbook_orders) — 수납관리 창의 '교재' 책갈피 면. tenant 스코프는 RLS가 강제.
export type TextbookOrderRow = {
  id: string;
  bookName: string;
  bookDetail: string | null;
  studentId: string | null;
  studentName: string | null;
  teacherName: string | null;
  price: number;
  status: string; // requested/ordered/delivered/billed/paid
  requestDate: string | null;
};

export type StudentOption = { id: string; name: string; grade: string | null };

export type TextbookStats = {
  total: number;
  byStatus: Record<string, number>;
  totalAmount: number;
  unpaidAmount: number; // status<>paid 합계
  pending: number; // 청구 전(requested/ordered/delivered)
};

const PAGE = 50;
function sanitize(q: string) {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

export async function getTextbookOrdersPage(
  opts: { status?: string; q?: string } = {},
  page = 1,
  pageSize = PAGE,
): Promise<{ rows: TextbookOrderRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let qb = supabase
    .from("textbook_orders")
    .select(
      "id, book_name, book_detail, student_id, student_name, teacher_name, price, status, request_date",
      { count: "exact" },
    );
  if (opts.status && opts.status !== "all") qb = qb.eq("status", opts.status);
  const term = opts.q ? sanitize(opts.q) : "";
  if (term) qb = qb.or(`book_name.ilike.%${term}%,student_name.ilike.%${term}%`);
  qb = qb.order("request_date", { ascending: false, nullsFirst: false }).range(from, from + pageSize - 1);
  const { data, count } = await qb;
  const rows: TextbookOrderRow[] = (data ?? []).map((r) => ({
    id: r.id,
    bookName: r.book_name,
    bookDetail: r.book_detail,
    studentId: r.student_id,
    studentName: r.student_name,
    teacherName: r.teacher_name,
    price: Number(r.price),
    status: r.status,
    requestDate: r.request_date,
  }));
  return { rows, total: count ?? rows.length };
}

// 교재요청서(인쇄·PNG)용 단건 조회. RLS가 테넌트 격리. 학생 학년·학교는 카드 부제로 노출.
export type TextbookOrderDetail = {
  id: string;
  bookName: string;
  bookDetail: string | null;
  studentName: string | null;
  studentGrade: string | null;
  studentSchool: string | null;
  teacherName: string | null;
  price: number;
  status: string;
  requestDate: string | null;
};

export async function getTextbookOrderById(id: string): Promise<TextbookOrderDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("textbook_orders")
    .select(
      "id, book_name, book_detail, student_id, student_name, teacher_name, price, status, request_date, student:student_id ( grade, school )",
    )
    .eq("id", id)
    .single();
  if (!data) return null;
  const student = (Array.isArray(data.student) ? data.student[0] : data.student) as
    | { grade?: string | null; school?: string | null }
    | undefined;
  return {
    id: data.id,
    bookName: data.book_name,
    bookDetail: data.book_detail,
    studentName: data.student_name,
    studentGrade: student?.grade ?? null,
    studentSchool: student?.school ?? null,
    teacherName: data.teacher_name,
    price: Number(data.price),
    status: data.status,
    requestDate: data.request_date,
  };
}

// 교재 신청 모달의 학생 SearchableSelect 옵션 — 재원·휴원 학생만(퇴원 제외), 이름순.
export async function getStudentOptions(): Promise<StudentOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, grade")
    .neq("status", "withdrawn")
    .order("name", { ascending: true })
    .limit(2000);
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, grade: s.grade }));
}

// 카드용 경량 집계 — ~350행이라 status·price만 전건 fetch 후 메모리 집계(1000행 미만).
export async function getTextbookStats(): Promise<TextbookStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("textbook_orders").select("status, price");
  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  let totalAmount = 0;
  let unpaidAmount = 0;
  let pending = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const p = Number(r.price);
    totalAmount += p;
    if (r.status !== "paid") unpaidAmount += p;
    if (r.status === "requested" || r.status === "ordered" || r.status === "delivered") pending++;
  }
  return { total: rows.length, byStatus, totalAmount, unpaidAmount, pending };
}
