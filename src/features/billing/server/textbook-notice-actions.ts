"use server";

/**
 * 교재요청 → 학부모 ClassNote 발송(1단계, 텍스트).
 *
 * 강사가 요청서를 만든 그 자리에서 학부모에게 바로 보낸다(지금은 PNG를 내려받아 사람이 손으로 올리는 중).
 * 발송 레일은 **기존 공지 레일 재사용** — [`sendOnescreenNotice`](../../onescreen/server/notice-actions.ts)가
 * 강사 스코프·재원생 필터·학원 전체 동명이인 가드·발송 킬스위치(dry-run)·큐 적재를 이미 전부 갖고 있다.
 * 여기서는 **무슨 글자를 어떤 보드로 보낼지**만 정하고 그 액션을 호출한다(레일 수정 없음).
 *
 * ⚠️ 수업보고서 레일(lesson_reports)은 건드리지 않는다 — 유니크 키 때문에 진짜 보고서를 덮어쓴다.
 * ⚠️ textbook_orders.notes(사무실 내부 메모)는 학부모에게 나가지 않는다(본문 조립 함수 입력에 아예 없음).
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accountForTarget } from "@/features/owner/settings-types";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { sendOnescreenNotice } from "@/features/onescreen/server/notice-actions";
import {
  DEFAULT_TEXTBOOK_MENT,
  textbookNoticeCommon,
  textbookNoticeIndividual,
} from "../textbook-notice";

const MENT_MAX = 2000;

export type TextbookNoticeOrder = {
  id: string;
  studentId: string | null;
  studentName: string | null;
  bookName: string;
  bookDetail: string | null;
  price: number;
  requestDate: string | null;
  /** 발송 가능 과목 키(보드 prefix가 있는 것만). 1개=자동 확정, 2개+=선택, 0개=발송 불가. */
  subjects: string[];
};

export type TextbookNoticeSkip = {
  name: string;
  reason: "no_subject" | "no_student" | "subject_off" | "name_collision" | "no_name";
};

export type PreparedTextbookNotice = {
  ok: boolean;
  error?: string;
  orders?: TextbookNoticeOrder[];
  /** 저장된 내 멘트 ?? 기본 템플릿 */
  ment?: string;
  account?: { bank: string; holder: string; number: string };
  /** 학원설정 'ClassNote 실제 발송' 스위치 — off면 dry-run(보내지 않음)임을 화면이 미리 알린다. */
  sendEnabled?: boolean;
};

export type SendTextbookNoticeResult = {
  ok: boolean;
  error?: string;
  queued?: number;
  dryRun?: boolean;
  skipped?: TextbookNoticeSkip[];
};

type OrderRow = {
  id: string;
  student_id: string | null;
  student_name: string | null;
  book_name: string;
  book_detail: string | null;
  price: string | number;
  request_date: string | null;
};

/** 로그인 강사가 저장해 둔 멘트(없으면 null). 읽기는 본인 users 행 self-select(기존 RLS). */
export async function getMyTextbookMent(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("textbook_notice_ment")
    .eq("id", user.id)
    .maybeSingle();
  const v = (data?.textbook_notice_ment as string | null) ?? null;
  return v && v.trim() ? v : null;
}

/**
 * 내 멘트 저장(0129a) — 본인 행만(admin client + id·tenant_id 스코프, 0104a setMyNoticeMode 선례).
 * "중간저장" 용도라 실패해도 발송·입력을 막지 않는다(조용히 ok:false).
 */
export async function saveMyTextbookMent(text: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  const value = (text ?? "").trim().slice(0, MENT_MAX) || null;
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ textbook_notice_ment: value })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  return { ok: !error };
}

/**
 * 학생별 **발송 가능 과목 키** — textbook_orders엔 과목 컬럼이 없어 활성 수강(enrollments)에서 도출한다.
 * 활성 = end_date null 또는 미래(KST 오늘 기준). 보드 prefix가 없는 과목은 게시 대상이 아니라 제외.
 * 같은 보드로 가는 키(math·subject_1 → "(수학)")는 하나만 남긴다(고를 이유가 없는 선택지 제거).
 */
export async function getStudentBoardSubjects(studentIds: string[]): Promise<Record<string, string[]>> {
  const user = await getCurrentUser();
  if (!user) return {};
  const ids = [...new Set((studentIds ?? []).filter(Boolean))];
  if (!ids.length) return {};
  const supabase = await createClient();
  const today = kstToday();
  // 대량 id는 청크 분할(B3) — 헬퍼가 error를 삼키지 않고 throw.
  const rows = await fetchInChunks<{
    student_id: string;
    class: { subject?: string | null } | { subject?: string | null }[] | null;
  }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class:class_id!inner ( subject )")
      .in("student_id", chunk)
      .or(`end_date.is.null,end_date.gte.${today}`),
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const klass = Array.isArray(r.class) ? r.class[0] : r.class;
    const subject = (klass?.subject ?? "").trim();
    if (!subject || !BOARD_PREFIX[subject]) continue;
    const list = (out[r.student_id] ??= []);
    if (list.some((s) => BOARD_PREFIX[s] === BOARD_PREFIX[subject])) continue;
    list.push(subject);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** orderIds → 요청 행. 강사(겸직-강사뷰 포함)는 본인 담당 학생 요청만(하나라도 밖이면 전체 거부). */
async function loadScopedOrders(orderIds: string[]): Promise<{ error: string } | { rows: OrderRow[] }> {
  const supabase = await createClient();
  const rows = await fetchInChunks<OrderRow>(orderIds, (chunk) =>
    supabase
      .from("textbook_orders")
      .select("id, student_id, student_name, book_name, book_detail, price, request_date")
      .in("id", chunk),
  );
  if (!rows.length) return { error: "교재 요청을 찾을 수 없습니다" };
  const teacherId = await effectiveTeacherId();
  if (teacherId) {
    const { studentIds } = await getTeacherScope(teacherId);
    const scoped = new Set(studentIds);
    if (!rows.every((r) => r.student_id && scoped.has(r.student_id)))
      return { error: "담당 학생의 요청만 학부모에게 보낼 수 있습니다" };
  }
  return { rows };
}

/** 발송 다이얼로그 진입 — 요청 행 + 학생별 발송 가능 과목 + 내 멘트 + 계좌 + 발송 스위치를 한 번에. */
export async function prepareTextbookNotice(orderIds: string[]): Promise<PreparedTextbookNotice> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests")))
    return { ok: false, error: "교재 요청 권한이 없습니다" };
  const ids = [...new Set((orderIds ?? []).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "발송할 교재 요청이 없습니다" };

  const loaded = await loadScopedOrders(ids);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const studentIds = loaded.rows.map((r) => r.student_id).filter(Boolean) as string[];
  // 서로 독립인 조회 3건 — 직렬 워터폴 금지(B4).
  const [subjects, savedMent, settings] = await Promise.all([
    getStudentBoardSubjects(studentIds),
    getMyTextbookMent(),
    getTenantSettings(),
  ]);
  const acc = accountForTarget(settings.billing, "textbook");
  return {
    ok: true,
    orders: loaded.rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      bookName: r.book_name,
      bookDetail: r.book_detail,
      price: Number(r.price),
      requestDate: r.request_date,
      subjects: (r.student_id ? subjects[r.student_id] : undefined) ?? [],
    })),
    ment: savedMent ?? DEFAULT_TEXTBOOK_MENT,
    account: { bank: acc.bank, holder: acc.holder, number: acc.number },
    sendEnabled: settings.report.classnoteSendEnabled,
  };
}

/**
 * 실제 발송 — 학생별 본문을 조립해 공지 레일에 넘긴다.
 * 학생마다 교재·금액이 다르므로 **반드시 individualBody로 분기**(공통 body는 멘트/머리말).
 * 성공하면 멘트를 다음 기본값으로 저장(원장 요구). dryRun·skipped는 그대로 실어 화면이 정직하게 표시한다.
 */
export async function sendTextbookNotice(input: {
  orderIds: string[];
  ment: string;
  /** studentId → 보낼 보드 과목 키(화면에서 확정/선택). 없으면 그 학생은 제외된다. */
  subjectByStudent: Record<string, string>;
  /**
   * 테스트 발송 — 실 학부모 대신 테스트 학생 '학원이' 보드 1곳으로만 보낸다(개발 중 실발송 금지 규칙).
   *
   * 🔴 **여기에 함정이 있다**: `sendOnescreenNotice`는 test 모드에서 개별 내용(individualBody) 병합을
   * **건너뛴다**(notice-actions.ts `if (!input.test) { …indiv… }`). 교재 정보를 individualBody에 담는
   * 이 경로를 그대로 test로 보내면 **머리말만 가고 교재명·금액·계좌가 통째로 빠져** 통과해도 아무것도
   * 증명하지 못한다. 그래서 테스트일 때는 **합본(공통+개별)을 `body`에 통째로** 실어 보낸다.
   */
  test?: boolean;
}): Promise<SendTextbookNoticeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests")))
    return { ok: false, error: "교재 요청 권한이 없습니다" };
  const ids = [...new Set((input.orderIds ?? []).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "발송할 교재 요청이 없습니다" };

  const loaded = await loadScopedOrders(ids);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const settings = await getTenantSettings();
  const account = accountForTarget(settings.billing, "textbook");
  const ment = (input.ment ?? "").trim().slice(0, MENT_MAX);

  // 같은 학생의 요청이 여러 건이면 한 보드에 한 글로 합친다(보드 중복 → 조용한 누락 방지).
  const skipped: TextbookNoticeSkip[] = [];
  const byStudent = new Map<string, { name: string | null; blocks: string[] }>();
  for (const r of loaded.rows) {
    if (!r.student_id) {
      skipped.push({ name: r.student_name ?? "이름 없음", reason: "no_student" });
      continue;
    }
    const g = byStudent.get(r.student_id) ?? { name: r.student_name, blocks: [] };
    g.blocks.push(
      textbookNoticeIndividual(g.blocks.length === 0 ? ment : "", {
        studentName: r.student_name,
        bookName: r.book_name,
        bookDetail: r.book_detail,
        price: Number(r.price),
        requestDate: r.request_date,
        account,
      }),
    );
    byStudent.set(r.student_id, g);
  }

  const students: { studentId: string; subject: string; individualBody: string }[] = [];
  for (const [studentId, g] of byStudent) {
    const subject = (input.subjectByStudent?.[studentId] ?? "").trim();
    if (!subject || !BOARD_PREFIX[subject]) {
      skipped.push({ name: g.name ?? "이름 없음", reason: "no_subject" });
      continue;
    }
    students.push({ studentId, subject, individualBody: g.blocks.join("\n\n") });
  }
  if (!students.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // 테스트 발송: 학원이 보드 1곳이므로 첫 학생 글을 합본으로 만들어 body에 통째로 싣는다(위 함정 주석).
  const res = input.test
    ? await sendOnescreenNotice({
        body: [textbookNoticeCommon(ment), students[0]!.individualBody].filter(Boolean).join("\n\n"),
        students: [],
        test: true,
      })
    : await sendOnescreenNotice({ body: textbookNoticeCommon(ment), students });
  const merged: TextbookNoticeSkip[] = [
    ...skipped,
    ...(res.skipped ?? []).map((s) => ({ name: s.name, reason: s.reason })),
  ];
  if (!res.ok) return { ok: false, error: res.error, skipped: merged };
  // 다음 발송의 기본값으로 남긴다(중간저장) — best-effort라 실패해도 발송 결과엔 영향 없음.
  await saveMyTextbookMent(ment);
  return { ok: true, queued: res.queued ?? 0, dryRun: res.dryRun, skipped: merged };
}
