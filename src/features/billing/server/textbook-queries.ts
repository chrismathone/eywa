import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { textbookOrderSettled } from "@/features/billing/textbook-progress";

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
  /** 실제 작성자 계정(0168a) — 소유 판정의 합집합 한쪽. 이름을 다르게 적어도 본인은 자기 요청을 다룬다(0174a). */
  createdBy: string | null;
  /** 학부모에게 이미 나갔는가(0174a) — 값이 있으면 재발송 차단 + 삭제 시 그 글을 되짚는다. */
  classnoteNoticeId: string | null;
};

export type StudentOption = { id: string; name: string; grade: string | null };

export type TextbookStats = {
  total: number;
  // 하단 체크(등록·납부·주문)와 라벨 일치 — "그 단계가 아직 안 된 것" 카운트 + 완료(3체크 전부).
  needReg: number; // 등록 미완(registered_at null)
  needPay: number; // 납부 미완(paid_at null)
  needOrder: number; // 주문 미완(ordered_at null)
  done: number; // 등록·납부·주문 전부 완료
  totalAmount: number;
  unpaidAmount: number; // 납부 미완(paid_at null) 합계
  pending: number; // 완료 안 된 건수(= total - done)
};

const PAGE = 50;
function sanitize(q: string) {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

const ORDER_COLS =
  "id, book_name, book_detail, student_id, student_name, teacher_name, created_by, classnote_notice_id, price, status, request_date, notes, registered_at, ordered_at, paid_at, status_by_name, status_at, created_at";

type DbOrderRow = {
  id: string;
  book_name: string;
  book_detail: string | null;
  student_id: string | null;
  student_name: string | null;
  teacher_name: string | null;
  price: string | number;
  status: string;
  request_date: string | null;
  notes: string | null;
  registered_at: string | null;
  ordered_at: string | null;
  paid_at: string | null;
  status_by_name: string | null;
  status_at: string | null;
  created_at: string;
  created_by: string | null;
  classnote_notice_id: string | null;
};

function mapOrderRow(r: DbOrderRow): TextbookOrderRow {
  return {
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
    createdBy: r.created_by ?? null,
    classnoteNoticeId: r.classnote_notice_id ?? null,
  };
}

/** 찍힌 체크 개수(0~3) — 등록·납부·주문. 0=미착수 … 3=완료(request-history isDone). 정렬 1순위. */
function checkCount(r: TextbookOrderRow): number {
  return (r.registered ? 1 : 0) + (r.paid ? 1 : 0) + (r.ordered ? 1 : 0);
}

export async function getTextbookOrdersPage(
  opts: { filter?: string; q?: string } = {},
  page = 1,
  pageSize = PAGE,
): Promise<{ rows: TextbookOrderRow[]; total: number }> {
  const supabase = await createClient();
  const term = opts.q ? sanitize(opts.q) : "";
  // 완료(3체크)를 목록 맨 아래로 내리려면 페이지 경계를 넘는 전체 정렬 필요 → 전건 fetch 후 JS 정렬·필터·페이지네이션.
  // 교재신청은 테넌트당 수백 건 수준이라 안전(B2: 무페이징 select가 아닌 fetchAllPaged). 강사 뷰(getTextbookOrdersForStudents)는 무관.
  const all = await fetchAllPaged<DbOrderRow>((from, to) => {
    let qb = supabase.from("textbook_orders").select(ORDER_COLS);
    if (term) qb = qb.or(`book_name.ilike.%${term}%,student_name.ilike.%${term}%`);
    return qb.order("request_date", { ascending: false, nullsFirst: false }).order("id").range(from, to);
  });

  // 필터 = 하단 체크와 동일 의미: 등록/납부/주문 = 그 단계 미완, done = 3체크 전부.
  let rows = all.map(mapOrderRow);
  const f = opts.filter;
  if (f === "reg") rows = rows.filter((r) => !r.registered);
  else if (f === "pay") rows = rows.filter((r) => !r.paid);
  else if (f === "order") rows = rows.filter((r) => !r.ordered);
  else if (f === "done") rows = rows.filter(textbookOrderSettled); // 완료 판정 = 단일 소스(2026-08-20)
  // 1순위: 찍힌 체크 개수 오름차순(0→1→2→3) — 손 안 댄 것(0개)이 맨 위, 완료(3개)가 맨 아래.
  // 2순위: 신청일 최신순(같은 개수 안에서, 날짜 없으면 뒤로).
  rows.sort((a, b) => {
    const c = checkCount(a) - checkCount(b);
    if (c !== 0) return c;
    return (b.requestDate ?? "").localeCompare(a.requestDate ?? "");
  });

  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length };
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
    created_at: string; created_by: string | null;
  };
  const data = await fetchInChunks<Raw>(studentIds, (chunk) =>
    supabase
      .from("textbook_orders")
      .select(
        // 🔴 **원스크린 로스터가 타는 경로다** — 여기에 새 컬럼을 넣으면 그 컬럼이 DB에 생기기 전까지
        //    강사 화면이 통째로 죽는다(fetchInChunks는 에러를 삼키지 않고 throw). 실제로 2026-08-03에
        //    `classnote_notice_id`를 넣고 마이그레이션보다 먼저 배포해 강사 원스크린이 멈췄다.
        //    이 화면은 교재 자동입력 기본값만 쓰므로 **필요한 컬럼만** 조회한다.
        "id, book_name, book_detail, student_id, student_name, teacher_name, created_by, price, status, request_date, notes, registered_at, ordered_at, paid_at, status_by_name, status_at, created_at",
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
    createdBy: r.created_by ?? null,
    // 이 경로는 위 주석대로 새 컬럼을 조회하지 않는다 — 쓰는 화면(수납 표)이 따로 읽는다.
    classnoteNoticeId: null,
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
  // B2/B3: `.limit(2000)`은 PostgREST 기본 max-rows(≈1000)에 밀려 **조용히 1000행에서 잘린다**
  // (이름 오름차순이라 뒤쪽 이름부터 통째로 사라지고, 검색해도 안 나와 "그 학생은 없다"로 오인).
  // `data ?? []`는 error까지 삼켜 장애를 '학생 없음'으로 위장한다 → fetchAllPaged(throw)로 전환.
  // 현재 퇴원 제외 409명이라 잠복 상태였다. 정렬 tie-break는 id(batch.ts 계약).
  const rows = await fetchAllPaged<{ id: string; name: string; grade: string | null }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, grade")
      .neq("status", "withdrawn")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((s) => ({ id: s.id, name: s.name, grade: s.grade }));
}

// 카드용 경량 집계 — ~350행이라 status·price만 전건 fetch 후 메모리 집계(1000행 미만).
export async function getTextbookStats(): Promise<TextbookStats> {
  const supabase = await createClient();
  // 체크(등록·납부·주문) 기반 카운트 — 전건(B2: 무페이징 select 금지 → fetchAllPaged).
  const rows = await fetchAllPaged<{
    registered_at: string | null;
    ordered_at: string | null;
    paid_at: string | null;
    price: string | number;
  }>((from, to) =>
    supabase.from("textbook_orders").select("registered_at, ordered_at, paid_at, price").range(from, to),
  );
  let needReg = 0,
    needPay = 0,
    needOrder = 0,
    done = 0,
    totalAmount = 0,
    unpaidAmount = 0;
  for (const r of rows) {
    const reg = !!r.registered_at,
      ord = !!r.ordered_at,
      paid = !!r.paid_at;
    if (!reg) needReg++;
    if (!paid) needPay++;
    if (!ord) needOrder++;
    if (reg && ord && paid) done++;
    const p = Number(r.price);
    totalAmount += p;
    if (!paid) unpaidAmount += p;
  }
  return { total: rows.length, needReg, needPay, needOrder, done, totalAmount, unpaidAmount, pending: rows.length - done };
}
