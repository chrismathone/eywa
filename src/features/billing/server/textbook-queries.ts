import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";

// 교재신청(textbook_orders) — 수납관리 창의 '교재' 책갈피 면. tenant 스코프는 RLS가 강제.
export type TextbookOrderRow = {
  id: string;
  bookName: string;
  bookDetail: string | null;
  studentId: string | null;
  studentName: string | null;
  teacherName: string | null;
  price: number;
  status: string; // 파생: paid>ordered>requested
  requestDate: string | null;
  notes: string | null; // 내부 메모(다이얼로그 입력) — 목록에 표시
  // ijw식 3개 독립 체크 + 도달 시각(체크 hover에 표시).
  registered: boolean;
  ordered: boolean;
  paid: boolean;
  registeredAt: string | null;
  orderedAt: string | null;
  paidAt: string | null;
  statusByName: string | null; // 마지막 변경자
  statusAt: string | null; // 마지막 변경 시각
  createdAt: string; // 행 생성 시각 — 데이터베이스 연동 폴더의 등록일 폴백(request_date null 대비)
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
      "id, book_name, book_detail, student_id, student_name, teacher_name, price, status, request_date, notes, registered_at, ordered_at, paid_at, status_by_name, status_at, created_at",
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
    notes: r.notes,
    registered: !!r.registered_at,
    ordered: !!r.ordered_at,
    paid: !!r.paid_at,
    registeredAt: r.registered_at,
    orderedAt: r.ordered_at,
    paidAt: r.paid_at,
    statusByName: r.status_by_name,
    statusAt: r.status_at,
    createdAt: r.created_at,
  }));
  return { rows, total: count ?? rows.length };
}

// 교재요청서(인쇄·PNG)용 단건 조회. RLS가 테넌트 격리. 학생 학년·학교는 카드 부제로 노출.
export type TextbookOrderDetail = {
  id: string;
  bookName: string;
  bookDetail: string | null;
  studentId: string | null; // 강사 스코프 검증용(프린트 라우트) — 본인 담당 학생 요청서만 열람.
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
    studentId: data.student_id,
    studentName: data.student_name,
    studentGrade: student?.grade ?? null,
    studentSchool: student?.school ?? null,
    teacherName: data.teacher_name,
    price: Number(data.price),
    status: data.status,
    requestDate: data.request_date,
  };
}

// 강사 교재 요청 면 — 본인 담당 학생(studentIds)의 교재 요청만. 대량 .in()은 청크(#53), 요청일 최신순.
export async function getTextbookOrdersForStudents(studentIds: string[]): Promise<TextbookOrderRow[]> {
  if (studentIds.length === 0) return [];
  const supabase = await createClient();
  type Raw = {
    id: string; book_name: string; book_detail: string | null; student_id: string | null;
    student_name: string | null; teacher_name: string | null; price: number; status: string;
    request_date: string | null; notes: string | null; registered_at: string | null;
    ordered_at: string | null; paid_at: string | null; status_by_name: string | null; status_at: string | null;
    created_at: string;
  };
  const data = await fetchInChunks<Raw>(studentIds, (chunk) =>
    supabase
      .from("textbook_orders")
      .select(
        "id, book_name, book_detail, student_id, student_name, teacher_name, price, status, request_date, notes, registered_at, ordered_at, paid_at, status_by_name, status_at, created_at",
      )
      .in("student_id", chunk),
  );
  return data
    .map((r) => ({
      id: r.id,
      bookName: r.book_name,
      bookDetail: r.book_detail,
      studentId: r.student_id,
      studentName: r.student_name,
      teacherName: r.teacher_name,
      price: Number(r.price),
      status: r.status,
      requestDate: r.request_date,
      notes: r.notes,
      registered: !!r.registered_at,
      ordered: !!r.ordered_at,
      paid: !!r.paid_at,
      registeredAt: r.registered_at,
      orderedAt: r.ordered_at,
      paidAt: r.paid_at,
      statusByName: r.status_by_name,
      statusAt: r.status_at,
      createdAt: r.created_at,
    }))
    .sort((a, b) => (b.requestDate ?? "").localeCompare(a.requestDate ?? ""));
}

// 강사 교재 요청 폼의 학생 picker — 본인 담당 학생(studentIds)만, 재원·휴원(퇴원 제외), 이름순.
export async function getStudentOptionsForIds(studentIds: string[]): Promise<StudentOption[]> {
  if (studentIds.length === 0) return [];
  const supabase = await createClient();
  type Raw = { id: string; name: string; grade: string | null; status: string };
  const data = await fetchInChunks<Raw>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade, status").in("id", chunk).neq("status", "withdrawn"),
  );
  return data
    .map((s) => ({ id: s.id, name: s.name, grade: s.grade }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
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
    if (r.status === "requested" || r.status === "ordered") pending++;
  }
  return { total: rows.length, byStatus, totalAmount, unpaidAmount, pending };
}
