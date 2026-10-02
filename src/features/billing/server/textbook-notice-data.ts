import "server-only";

/**
 * 교재요청 학부모 발송의 **조회 조각들** — 액션 파일(textbook-notice-actions.ts)이 얇게 유지되도록 분리.
 * 여기엔 인가·부수효과가 없는(또는 읽기 전용) 조회만 둔다. 실제 게이트·발송은 액션 파일이 책임진다.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { textbookRequestStudentIds } from "./textbook-scope";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { resolveNoticeOwners, type NoticeClassTeacher, type NoticeOwner, type OwnerAccount } from "../textbook-notice-subject";
import { ownsTextbookRequest } from "../textbook-ownership";
import { workerSupportsNoticeAttachments } from "@/features/report-admin/worker-results";

export type TextbookOrderRow = {
  id: string;
  student_id: string | null;
  student_name: string | null;
  teacher_name: string | null;
  /** 실제 작성자 계정 — 소유 판정의 **합집합 한쪽**(이름을 다르게 적어도 본인은 자기 요청을 다룬다, 0174a). */
  created_by: string | null;
  /** 이미 학부모에게 나간 공지(0174a). 값이 있으면 **재발송 차단** 표식이다. */
  classnote_notice_id: string | null;
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
 * 학생별 **발송 가능 과목 키** — textbook_orders엔 과목 컬럼이 없어 활성 수강(enrollments)에서 도출한다.
 * 활성 = end_date null 또는 미래(KST 오늘 기준). 보드 prefix가 없는 과목은 게시 대상이 아니라 제외.
 * 같은 보드로 가는 키(math·subject_1 → "(수학)")는 하나만 남긴다(고를 이유가 없는 선택지 제거).
 * `classes` = 두 과목을 다 듣는 학생의 반별 과목·담당(담임 + 오늘 유효한 교시 담당) — 알림장 기본값 판정 재료.
 */
export type StudentBoardInfo = {
  subjects: Record<string, string[]>;
  classes: Record<string, NoticeClassTeacher[]>;
};

export async function getStudentBoardSubjects(studentIds: string[]): Promise<StudentBoardInfo> {
  const empty: StudentBoardInfo = { subjects: {}, classes: {} };
  const user = await getCurrentUser();
  if (!user) return empty;
  const ids = [...new Set((studentIds ?? []).filter(Boolean))];
  if (!ids.length) return empty;
  const supabase = await createClient();
  const today = kstToday();
  type ClassRef = { id?: string | null; subject?: string | null; teacher_id?: string | null };
  // 대량 id는 청크 분할(B3) — 헬퍼가 error를 삼키지 않고 throw.
  const rows = await fetchInChunks<{ student_id: string; class: ClassRef | ClassRef[] | null }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class:class_id!inner ( id, subject, teacher_id )")
      .in("student_id", chunk)
      .or(`end_date.is.null,end_date.gte.${today}`),
  );

  const subjects: Record<string, string[]> = {};
  const classRows: Array<{ studentId: string; classId: string; subject: string; homeroom: string | null }> = [];
  for (const r of rows) {
    const klass = Array.isArray(r.class) ? r.class[0] : r.class;
    const subject = (klass?.subject ?? "").trim();
    if (!subject || !BOARD_PREFIX[subject]) continue;
    if (klass?.id) classRows.push({ studentId: r.student_id, classId: klass.id, subject, homeroom: klass.teacher_id ?? null });
    const list = (subjects[r.student_id] ??= []);
    if (list.some((s) => BOARD_PREFIX[s] === BOARD_PREFIX[subject])) continue;
    list.push(subject);
  }
  for (const list of Object.values(subjects)) list.sort();

  // 알림장 기본값(textbook-notice-subject.ts) 재료 — 두 과목을 다 듣는 학생이 있을 때만 교시 담당을 읽는다(대부분은 과목 하나).
  const needTeachers = new Set(Object.entries(subjects).filter(([, list]) => list.length > 1).map(([id]) => id));
  const classes: Record<string, NoticeClassTeacher[]> = {};
  if (!needTeachers.size) return { subjects, classes };
  // 🔴 여기 실패로 발송 창을 세우지 않는다 — 기본값 재료일 뿐이라, 못 읽으면 비워 두고(로그) 화면이 고르게 한다.
  try {
    const wanted = classRows.filter((c) => needTeachers.has(c.studentId));
    // 교시 표는 이력을 함께 담는다(#88) — 오늘 유효한 교시만, 청크 × 페이징으로(B2).
    const slots = await fetchAllPagedInChunks<{ class_id: string; teacher_id: string | null }>(
      [...new Set(wanted.map((c) => c.classId))],
      (chunk, from, to) =>
        supabase
          .from("class_schedules")
          .select("class_id, teacher_id")
          .in("class_id", chunk)
          .not("teacher_id", "is", null)
          .lte("valid_from", today)
          .or(`valid_to.is.null,valid_to.gte.${today}`)
          .order("id")
          .range(from, to),
    );
    const slotTeachers = new Map<string, Set<string>>();
    for (const s of slots) {
      if (!s.teacher_id) continue;
      if (!slotTeachers.has(s.class_id)) slotTeachers.set(s.class_id, new Set());
      slotTeachers.get(s.class_id)!.add(s.teacher_id);
    }
    for (const c of wanted) {
      const teacherIds = new Set(slotTeachers.get(c.classId) ?? []);
      if (c.homeroom) teacherIds.add(c.homeroom);
      (classes[c.studentId] ??= []).push({ subject: c.subject, teacherIds: [...teacherIds] });
    }
  } catch (e) {
    console.error("[textbook] 알림장 기본값 재료(반 담당) 조회 실패 — 반 담당 판정 없이 진행합니다", e instanceof Error ? e.message : e);
    return { subjects, classes: {} };
  }
  return { subjects, classes };
}

/**
 * 요청서 주인 후보(알림장 기본값 판정용) — 판정 규칙은 `resolveNoticeOwners`(순수) 한 곳. 여기는 그 재료(계정)만 읽는다.
 * 🔴 실패는 삼킨다(로그) — 기본값 재료일 뿐이라 못 읽으면 주인 없음(= 화면이 고르게 한다)으로 떨어진다.
 * 읽는 칸은 id·이름·담당 과목뿐(같은 지점) — 강사의 직원 표 읽기 범위에 기대지 않으려고 admin으로 읽는다(tenant 필터 필수).
 */
export async function loadNoticeOwners(
  rows: Array<{ id: string; teacher_name: string | null; created_by: string | null }>,
): Promise<Record<string, NoticeOwner[]>> {
  const user = await getCurrentUser();
  if (!user) return {};
  const names = [...new Set(rows.map((r) => r.teacher_name?.trim()).filter((v): v is string => !!v))];
  const creators = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  if (!names.length && !creators.length) return {};
  type Row = { id: string; display_name: string | null; subjects: string[] | null; system_role: string | null };
  try {
    const admin = createAdminClient();
    const base = () =>
      admin.from("users").select("id, display_name, subjects, system_role").eq("tenant_id", user.tenantId).eq("status", "active");
    const [byName, byId] = await Promise.all([
      names.length ? fetchInChunks<Row>(names, (chunk) => base().in("display_name", chunk)) : Promise.resolve([] as Row[]),
      creators.length ? fetchInChunks<Row>(creators, (chunk) => base().in("id", chunk)) : Promise.resolve([] as Row[]),
    ]);
    const accounts = new Map<string, OwnerAccount>();
    for (const u of [...byName, ...byId]) {
      accounts.set(u.id, { id: u.id, displayName: u.display_name ?? "", subjects: u.subjects ?? [], role: u.system_role ?? "" });
    }
    const list = [...accounts.values()];
    const out: Record<string, NoticeOwner[]> = {};
    for (const r of rows) out[r.id] = resolveNoticeOwners({ teacherName: r.teacher_name, createdBy: r.created_by }, list);
    return out;
  } catch (e) {
    console.error("[textbook] 알림장 기본값 재료(요청서 주인) 조회 실패 — 기본값 없이 고르게 합니다", e instanceof Error ? e.message : e);
    return {};
  }
}

/** 하트비트가 이 시간 안이면 "지금 돌고 있는 워커"로 본다 — 이 글을 집어갈 후보. */
const WORKER_LIVE_MS = 10 * 60 * 1000;

/**
 * 이미지 첨부 발송을 **지금 켜져 있는 연동 PC가 처리할 수 있는가**(롤아웃 가드).
 *
 * 앱은 즉시 배포되고 워커는 zip 물리 이관이라 시차가 생긴다. 그 사이 보내면 구버전 워커가 첨부를 통째로
 * 무시하고 글자만 게시한 뒤 `success`로 남긴다(재발송하면 중복 글). 그래서 **살아있는 워커 중 하나라도
 * 미지원이면 막는다** — 그 워커가 큐를 집어갈 수 있기 때문.
 * ⚠️ 켜져 있는 워커가 하나도 없으면 막지 않는다(큐에 쌓였다가 나중에 처리되는 정상 동작 — 여기서 막으면
 *    "PC를 켜기 전엔 예약도 못 한다"가 된다). 그 사이 구버전이 켜질 잔여 위험은 이관 절차로 관리한다.
 */
export async function getNoticeAttachmentWorkerGate(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("classnote_workers").select("hostname, last_seen, last_results");
  const live = (data ?? []).filter(
    (w) => Date.now() - Date.parse(String(w.last_seen ?? "")) < WORKER_LIVE_MS,
  );
  const stale = live.filter((w) => !workerSupportsNoticeAttachments(w.last_results));
  if (!stale.length) return { ok: true };
  return {
    ok: false,
    error: `연동 PC(${stale.map((w) => String(w.hostname)).join(", ")})의 발송 프로그램이 아직 이미지 첨부를 지원하지 않습니다 — 연동 PC를 최신 버전으로 업데이트한 뒤 보내주세요(지금 보내면 요청서 없이 글자만 게시됩니다).`,
  };
}

/**
 * orderIds → 요청 행. 강사(겸직-강사뷰 포함)는 **본인 담당 학생 + 본인이 낸 요청**만(하나라도 밖이면 전체 거부).
 *
 * 🔴 소유 조건은 2026-07-29 적대 감사로 추가됐다 — 여기가 **가장 넓은 표면**이었다. 수정·삭제는 그나마
 * "사무실 미처리" 조건에 걸려 실측 4건뿐이었는데, 이 발송 경로엔 그 제한이 없어 강사가 담당 학생의
 * **모든** 교재 요청(=대부분 남의 과목)을 학부모 알림장으로 내보낼 수 있었다.
 */
export async function loadScopedOrders(
  orderIds: string[],
): Promise<{ error: string } | { rows: TextbookOrderRow[] }> {
  const supabase = await createClient();
  const rows = await fetchInChunks<TextbookOrderRow>(orderIds, (chunk) =>
    supabase
      .from("textbook_orders")
      .select("id, student_id, student_name, teacher_name, created_by, classnote_notice_id, book_name, book_detail, price, request_date")
      .in("id", chunk),
  );
  if (!rows.length) return { error: "교재 요청을 찾을 수 없습니다" };
  const teacherId = await effectiveTeacherId();
  if (teacherId) {
    const user = await getCurrentUser();
    const scoped = new Set(await textbookRequestStudentIds(teacherId));
    // 본인이 만든 요청은 담당 범위와 무관하게 본인 것(D5 — 목록에 뜨는 요청은 보낼 수 있어야 한다).
    if (!rows.every((r) => (r.created_by && r.created_by === user?.id) || (r.student_id && scoped.has(r.student_id))))
      return { error: "담당 학생의 요청만 학부모에게 보낼 수 있습니다" };
    const notMine = rows.filter((r) => !ownsTextbookRequest(r.teacher_name, user?.displayName, r.created_by, user?.id));
    if (notMine.length)
      return {
        error: `본인이 낸 요청만 학부모에게 보낼 수 있습니다 — ${[...new Set(notMine.map((r) => r.teacher_name).filter(Boolean))].join(", ") || "다른 선생님"} 요청이 포함돼 있습니다`,
      };
  }
  return { rows };
}
