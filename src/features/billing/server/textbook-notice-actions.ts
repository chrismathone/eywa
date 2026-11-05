"use server";

/**
 * 교재요청 → 학부모 ClassNote 발송.
 *
 * 강사가 요청서를 만든 그 자리에서 학부모에게 바로 보낸다(원장이 손으로 올리던 형태 = 글 1개에
 * 멘트+교재 내용 **＋ 요청서 양식 이미지(학생별) ＋ 교재 표지(선택, 공통)**). 발송 레일은 **기존 공지 레일 재사용**
 * — [`sendOnescreenNotice`](../../onescreen/server/notice-actions.ts)가 강사 스코프·재원생 필터·학원 전체
 * 동명이인 가드·발송 킬스위치(dry-run)·큐 적재를 이미 전부 갖고 있다. 여기서는 **무슨 글자·무슨 그림을
 * 어떤 보드로 보낼지**만 정하고 그 액션을 호출한다.
 *
 * ⚠️ 수업보고서 레일(lesson_reports)은 건드리지 않는다 — 유니크 키 때문에 진짜 보고서를 덮어쓴다.
 * ⚠️ textbook_orders.notes(사무실 내부 메모)는 학부모에게 나가지 않는다(본문 조립 함수 입력에 아예 없음).
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accountForTarget } from "@/features/owner/settings-types";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { sendOnescreenNotice } from "@/features/onescreen/server/notice-actions";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { DEFAULT_TEXTBOOK_MENT, resolveTextbookMent, textbookNoticeCommon } from "../textbook-notice";
import { defaultNoticeSubject } from "../textbook-notice-subject";
import { groupTextbookNoticeStudents } from "../textbook-notice-group";
// 중복 발송 차단 규칙(0174a) — 순수함수 단일 소스.
import { isDeadNoticeStatus, partitionAlreadySent, textbookSendKey } from "../textbook-send-dedup";
import type {
  PreparedTextbookNotice,
  SendTextbookNoticeResult,
  TextbookNoticeSkip,
} from "../textbook-notice-types";
import {
  getMyTextbookMent,
  getNoticeAttachmentWorkerGate,
  getStudentBoardSubjects,
  loadNoticeOwners,
  loadScopedOrders,
} from "./textbook-notice-data";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { SEND_CLASS_SUBJECTS, classRouteActive } from "@/features/onescreen/send-class";
import { noticeClassRouteWorkerReady, resolveNoticeClasses } from "@/features/report-admin/server/notice-class-route";
import { resolveNoticeStandings } from "@/features/report-admin/server/notice-standing-query";
import { isClassnoteSubjectEnabled } from "@/features/onescreen/classnote-guard";
import type { NoticeOwner } from "../textbook-notice-subject";

/**
 * 학생별 **보내는 선생님**(수학 반 보드 경로의 삼자 일치용) — 강사 본인이 보내면 본인, 사무실이 보내면 그 학생 요청서들의 주인.
 * 미리 보기(prepare)와 실제 발송(send)이 같은 규칙을 쓰게 한 곳에 둔다.
 */
function teachersByStudent(
  rows: ReadonlyArray<{ id: string; student_id: string | null }>,
  owners: Record<string, NoticeOwner[]>,
  senderTeacherId: string | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.student_id) continue;
    const list = (out[r.student_id] ??= []);
    for (const id of senderTeacherId ? [senderTeacherId] : (owners[r.id] ?? []).map((o) => o.id)) if (!list.includes(id)) list.push(id);
  }
  return out;
}

const MENT_MAX = 2000;

/**
 * 내 멘트 저장(0129a) — 본인 행만(admin client + id·tenant_id 스코프, 0104a setMyNoticeMode 선례).
 * "중간저장" 용도라 실패해도 발송·입력을 막지 않는다(조용히 ok:false).
 */
export async function saveMyTextbookMent(text: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false };
  // 🔴 관리 클라이언트 쓰기라 canWriteTenant 캡을 지나지 않는다 — 열람 전용 강사뷰(·지점 보기)는 여기서 막는다.
  //    안 막으면 원장이 강사 X 화면을 '읽기'로 보다가 칸을 고치는 순간 X의 멘트가 바뀐다(원장 2026-11-05 강사뷰 전수).
  if (await readonlyTeacherViewError()) return { ok: false };
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
 * 저장해 둔 내 멘트(없으면 기본 문구) — **작성 폼**에서 학부모 메시지 칸의 초기값으로 읽는다.
 * 발송 다이얼로그는 `prepareTextbookNotice`가 이미 같이 실어주므로 이 액션을 또 부르지 않는다(왕복 1회).
 */
export async function loadMyTextbookMent(): Promise<string> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return DEFAULT_TEXTBOOK_MENT;
  // 저장값이 옛 기본 문구 그대로면 현재 기본 문구로 흡수한다(resolveTextbookMent 주석 — 안 그러면 기본을 고쳐도 안 바뀐다).
  return resolveTextbookMent(await getMyTextbookMent());
}

/** 발송 다이얼로그 진입 — 요청 행 + 학생별 발송 가능 과목 + 내 멘트 + 계좌 + 발송/첨부 스위치를 한 번에. */
export async function prepareTextbookNotice(orderIds: string[]): Promise<PreparedTextbookNotice> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests")))
    return { ok: false, error: "교재 요청 권한이 없습니다" };
  const ids = [...new Set((orderIds ?? []).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "발송할 교재 요청이 없습니다" };

  const loaded = await loadScopedOrders(ids);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const studentIds = loaded.rows.map((r) => r.student_id).filter(Boolean) as string[];
  // 서로 독립인 조회 5건 — 직렬 워터폴 금지(B4).
  const [boards, owners, savedMent, settings, worker] = await Promise.all([
    getStudentBoardSubjects(studentIds),
    loadNoticeOwners(loaded.rows),
    getMyTextbookMent(),
    getTenantSettings(),
    getNoticeAttachmentWorkerGate(),
  ]);
  const acc = accountForTarget(settings.billing, "textbook");
  // 수학 알림장이 어느 반 보드로 가는지 미리 정해 보여 준다(발송 액션과 같은 함수 — 화면에 보인 반으로 나간다).
  // 경로가 꺼져 있거나 연동 PC가 아직 못 하면 비운다(= 지금까지처럼 1인 보드). 판정 실패는 화면을 세우지 않는다 — 발송 때 다시 판정한다.
  const mathRouteP = (async (): Promise<PreparedTextbookNotice["mathRoute"]> => {
    try {
      const supabase = await createClient();
      const senderTeacherId = await effectiveTeacherId();
      if (!classRouteActive(settings) || !(await noticeClassRouteWorkerReady(supabase))) return undefined;
      const teachers = teachersByStudent(loaded.rows, owners, senderTeacherId);
      const mathStudents = [...new Set(studentIds)].filter((id) => (boards.subjects[id] ?? []).some((k) => SEND_CLASS_SUBJECTS.has(k)));
      const picks = await resolveNoticeClasses(
        user.tenantId,
        mathStudents.map((id) => ({ studentId: id, teacherIds: teachers[id] ?? [], teacherStrict: !!senderTeacherId })),
      );
      const out: NonNullable<PreparedTextbookNotice["mathRoute"]> = {};
      for (const [id, p] of picks) out[id] = p.ok ? { className: p.className } : { reason: p.reason };
      return out;
    } catch (e) {
      console.error("[textbook] 반 보드 미리 보기 판정 실패 — 발송 때 다시 판정합니다", e instanceof Error ? e.message : e);
      return undefined;
    }
  })();
  // 수업 시작 전·휴원(대기) 중인 학생 — 그 과목 알림장으로는 보내지 않는다(원장 2026-11-05 · 발송 액션 routeNoticeCandidates와 같은 함수).
  // 교재요청서는 첫 수업 전에 보내는 일이 많아 보내기 전에 알린다. 위 미리 보기와 서로 독립(B4). 판정 실패는 화면을 세우지 않는다.
  const standingP = (async (): Promise<PreparedTextbookNotice["standing"]> => {
    if (!classRouteActive(settings)) return undefined;
    const pairs = [...new Set(studentIds)].flatMap((id) =>
      (boards.subjects[id] ?? []).filter((k) => isClassnoteSubjectEnabled(k, settings.report.classnoteSubjects)).map((subject) => ({ studentId: id, subject })),
    );
    if (!pairs.length) return {};
    try {
      const judged = await resolveNoticeStandings(user.tenantId, pairs);
      const out: NonNullable<PreparedTextbookNotice["standing"]> = {};
      for (const [id, bySubject] of judged) out[id] = Object.fromEntries(bySubject);
      return out;
    } catch (e) {
      console.error("[textbook] 수업 시작 전·휴원 미리 보기 판정 실패 — 발송 때 다시 판정합니다", e instanceof Error ? e.message : e);
      return undefined;
    }
  })();
  const [mathRoute, standing] = await Promise.all([mathRouteP, standingP]);
  return {
    ok: true,
    mathRoute,
    standing,
    orders: loaded.rows.map((r) => {
      const subjects = (r.student_id ? boards.subjects[r.student_id] : undefined) ?? [];
      return {
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        teacherName: r.teacher_name,
        bookName: r.book_name,
        bookDetail: r.book_detail,
        price: Number(r.price),
        requestDate: r.request_date,
        subjects,
        // 두 과목을 다 듣는 학생의 알림장 기본값 = 이 요청을 낸 선생님이 그 학생을 가르치는 과목(못 정하면 null — 화면이 고르게 한다).
        defaultSubject: defaultNoticeSubject({
          subjects,
          classes: (r.student_id ? boards.classes[r.student_id] : undefined) ?? [],
          owners: owners[r.id] ?? [],
          boardOf: (s) => BOARD_PREFIX[s],
        }),
      };
    }),
    ment: resolveTextbookMent(savedMent),
    account: { bank: acc.bank, holder: acc.holder, number: acc.number },
    sendEnabled: classnoteSendOn(settings),
    showAttachments: settings.report.showAttachments,
    workerError: worker.ok ? undefined : worker.error,
  };
}

export type SendTextbookNoticeInput = {
  orderIds: string[];
  ment: string;
  /** studentId → 보낼 보드 과목 키(화면에서 확정/선택). 없으면 그 학생은 제외된다. */
  subjectByStudent: Record<string, string>;
  /** 전원 공통 첨부(교재 표지 등) — 업로드가 끝난 {path,name,size}. */
  commonAttachments?: NoticeAttachment[];
  /** studentId → 그 학생 요청서 PNG. 남의 요청서가 가지 않도록 **학생별로만** 싣는다. */
  attachmentsByStudent?: Record<string, NoticeAttachment[]>;
  /**
   * 테스트 발송 — 실 학부모 대신 테스트 학생 '학원이' 보드 1곳으로만 보낸다(개발 중 실발송 금지 규칙).
   * 🔴 **함정**: `sendOnescreenNotice`는 test 모드에서 개별 내용(individualBody)·개별 첨부 병합을 **건너뛴다**
   * (notice-actions.ts `if (!input.test) { …indiv… }`). 그대로 test로 보내면 **머리말만 가고 교재명·금액·계좌·
   * 요청서가 통째로 빠져** 통과해도 아무것도 증명 못 한다 → 테스트는 **합본을 `body`에, 첨부는 공통 자리에** 싣는다.
   */
  test?: boolean;
};

/**
 * 실제 발송 — 학생별 본문/첨부를 조립해 공지 레일에 넘긴다.
 * 학생마다 교재·금액·요청서가 다르므로 **반드시 개별로 분기**(공통 body는 멘트/머리말, 공통 첨부는 표지).
 * 성공하면 멘트를 다음 기본값으로 저장(원장 요구). dryRun·skipped는 그대로 실어 화면이 정직하게 표시한다.
 */
export async function sendTextbookNotice(input: SendTextbookNoticeInput): Promise<SendTextbookNoticeResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "textbook_requests")))
    return { ok: false, error: "교재 요청 권한이 없습니다" };
  const ids = [...new Set((input.orderIds ?? []).filter(Boolean))];
  if (!ids.length) return { ok: false, error: "발송할 교재 요청이 없습니다" };

  const loaded = await loadScopedOrders(ids);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  // 서로 독립인 게이트 2건 — 설정 조회와 워커 지원 확인(B4).
  const [settings, worker] = await Promise.all([getTenantSettings(), getNoticeAttachmentWorkerGate()]);
  // ⚠️ 학원설정 '사진/파일 첨부'는 **학부모에게 사진·파일을 보내지 않는다**는 학원 방침 스위치다.
  // 이 화면의 결과물은 요청서 그림이 붙은 글이라 방침과 정면 충돌 → 아예 막는다(화면도 버튼 비활성화).
  // 🔴 공지 워커(classnote-notice-core)는 이 설정을 **읽지 않는다**(스샷 경로가 아니라 그대로 게시) —
  //    즉 이 레일에서 방침을 지키는 지점은 **여기 한 곳뿐**이다. 이 게이트를 없애면 설정이 무시된다.
  if (!settings.report.showAttachments)
    return {
      ok: false,
      error:
        "학원설정 → 보고서 → 표시 항목의 ‘사진/파일 첨부’가 꺼져 있습니다 — 이 발송은 요청서 이미지가 함께 나가므로 설정을 켠 뒤 보내주세요.",
    };
  // ⚠️ 연동 PC 워커가 구버전이면 첨부를 통째로 무시하고 글자만 게시한 뒤 success로 남긴다(재발송=중복 글).
  if (!worker.ok) return { ok: false, error: worker.error };
  const account = accountForTarget(settings.billing, "textbook");
  const ment = (input.ment ?? "").trim().slice(0, MENT_MAX);

  // 🔴 **중복 발송 차단**(0174a, 원장 2026-08-03) — 수업보고서 success 차단과 같은 규약.
  //    ① 이 요청서가 이미 나갔다 ② 같은 학생·같은 교재가 다른 요청서로 이미 나갔다 ③ 이 배치 안 중복.
  //    ②의 조회는 **선택한 학생들만** 대상으로 좁힌다(전건 스캔 금지, B2).
  const studentIds = [...new Set(loaded.rows.map((r) => r.student_id).filter(Boolean))] as string[];
  const supabase = await createClient();
  const sentRows = studentIds.length
    ? await fetchInChunks<{ student_id: string | null; book_name: string; classnote_notice_id: string | null }>(studentIds, (chunk) =>
        supabase
          .from("textbook_orders")
          .select("student_id, book_name, classnote_notice_id")
          .in("student_id", chunk)
          .not("classnote_notice_id", "is", null),
      )
    : [];
  // 감사 F3 — 실패·회수 완료된 공지에 연결된 요청서는 발송분으로 치지 않는다(재발송 가능).
  //   공지 상태를 못 읽으면 종전처럼 전부 발송분으로 본다(막는 쪽 — 중복 게시가 되돌리기 어렵다).
  const linkedNoticeIds = [
    ...new Set(
      [...loaded.rows.map((r) => r.classnote_notice_id), ...sentRows.map((r) => r.classnote_notice_id)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  let deadNoticeIds = new Set<string>();
  if (linkedNoticeIds.length) {
    try {
      const notices = await fetchInChunks<{ id: string; status: string | null }>(linkedNoticeIds, (chunk) =>
        supabase.from("classnote_notices").select("id, status").eq("tenant_id", user.tenantId).in("id", chunk),
      );
      deadNoticeIds = new Set(notices.filter((n) => isDeadNoticeStatus(n.status)).map((n) => n.id));
    } catch {
      deadNoticeIds = new Set();
    }
  }
  const liveNotice = (id: string | null) => (id && !deadNoticeIds.has(id) ? id : null);
  const alreadySentKeys = new Set(
    sentRows.filter((r) => liveNotice(r.classnote_notice_id)).map((r) => textbookSendKey(r.student_id, r.book_name)),
  );
  const dedup = partitionAlreadySent(
    loaded.rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      bookName: r.book_name,
      classnoteNoticeId: liveNotice(r.classnote_notice_id),
    })),
    alreadySentKeys,
  );
  if (dedup.sendable.length === 0)
    return { ok: false, error: "보낼 수 있는 요청서가 없습니다 — 아래 사유를 확인해주세요", skipped: dedup.skipped };
  const sendableIds = new Set(dedup.sendable.map((r) => r.id));
  const sendableRows = loaded.rows.filter((r) => sendableIds.has(r.id));

  // 학생별 묶음(같은 학생 여러 건 = 한 글) 조립은 순수 함수 — 액션은 인가·게이트·레일 호출만 책임진다.
  const { students, skipped } = groupTextbookNoticeStudents(
    sendableRows.map((r) => ({
      studentId: r.student_id,
      studentName: r.student_name,
      bookName: r.book_name,
      bookDetail: r.book_detail,
      price: Number(r.price),
      requestDate: r.request_date,
    })),
    {
      ment,
      account,
      subjectOf: (id) => {
        const s = (input.subjectByStudent?.[id] ?? "").trim();
        return s && BOARD_PREFIX[s] ? s : null;
      },
      attachmentsOf: (id) => input.attachmentsByStudent?.[id],
    },
  );
  if (!students.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  const common = input.commonAttachments ?? [];
  // 수학 반 보드 경로의 삼자 일치(선생님 – 반 – 학생)에 쓸 선생님 — 사무실이 대신 보낼 때의 요청서 주인.
  // (강사 본인이 보내면 공지 레일이 본인을 쓴다.) 못 읽으면 선생님 없는 발송으로 떨어진다(반이 하나면 그 반).
  // 🔴 미리 보기(prepare)와 **같은 행 집합**(고른 요청서 전부)으로 주인을 모은다 — 다르면 화면에 보인 반과 다른 반 보드로 갈 수 있다.
  const teacherIdsByStudent = teachersByStudent(loaded.rows, await loadNoticeOwners(loaded.rows), null);
  // 테스트 발송: 학원이 보드 1곳이므로 첫 학생 글·첨부를 합본으로 만들어 공통 자리에 통째로 싣는다(위 함정 주석).
  const res = input.test
    ? await sendOnescreenNotice({
        body: [textbookNoticeCommon(ment), students[0]!.individualBody].filter(Boolean).join("\n\n"),
        students: [],
        attachments: [...common, ...(students[0]!.attachments ?? [])],
        test: true,
      })
    : await sendOnescreenNotice({ body: textbookNoticeCommon(ment), students, attachments: common, teacherIdsByStudent });
  const merged: TextbookNoticeSkip[] = [
    ...dedup.skipped,
    ...skipped,
    ...(res.skipped ?? []).map((s) => ({ name: s.name, reason: s.reason })),
  ];
  if (!res.ok) return { ok: false, error: res.error, skipped: merged };

  // 🔴 공지 연결 기록(0174a) — **발송 성공 직후에만**. 먼저 채우면 실패한 건이 영영 재발송 불가가 된다.
  //    이 값이 곧 ① 삭제 시 학부모 글 되짚기 ② 다음 발송의 중복 차단 표식이다.
  //    ⚠️ dry-run(발송 스위치 OFF)은 큐에 안 올라갔으므로 **연결하지 않는다** — 연결하면 실제로 안 나간 글이
  //       "이미 발송함"으로 굳어 진짜 발송을 막는다.
  //    ⚠️ 테스트 발송('학원이' 보드)도 연결하지 않는다 — 실 학부모에게 간 글이 아니다.
  // 🔴 **실제로 큐에 오른 학생의 요청서만** 연결한다 — 공지 레일이 제외한 학생(반 보드 없음·동명이인 등)의 요청서까지 '발송함'으로
  //    적으면 그 학생은 다시 보낼 길이 막힌다(푸는 길이 다른 학생에게 간 글까지 지우는 게시취소뿐).
  const queuedStudents = new Set(res.queuedStudentIds ?? []);
  const linkedIds = sendableRows.filter((r) => r.student_id && queuedStudents.has(r.student_id)).map((r) => r.id);
  if (res.noticeId && !res.dryRun && !input.test && linkedIds.length) {
    const linkIds = linkedIds;
    const admin = createAdminClient(); // RLS 우회 → tenant_id 명시 필터 필수
    const { error: linkErr } = await admin
      .from("textbook_orders")
      .update({ classnote_notice_id: res.noticeId })
      .in("id", linkIds)
      .eq("tenant_id", user.tenantId);
    // 연결 실패는 발송을 되돌리지 않는다(글은 이미 큐에 올라갔다) — 다만 중복 차단이 약해지므로 기록은 남긴다.
    if (linkErr) console.error("[textbook] 공지 연결 기록 실패 — 중복 차단이 약해집니다", linkErr.message);
  }

  /**
   * 감사로그 — **학부모에게 나간 발송 + 요청서에 박힌 발송 표식**.
   *
   * ⚠️ 공지 레일(`sendOnescreenNotice`)도 자체적으로 `classnote_notice_send`를 한 줄 남긴다. 그 줄은
   *    "공지 1건이 큐에 올라갔다"는 사실이고, 여기 줄은 "**어느 교재 요청서**가 발송 처리됐다"는 다른
   *    사실이다 — 후자가 없으면 위 `classnote_notice_id` 쓰기(= 그 요청서를 영구히 재발송 불가로 만드는
   *    중복 차단 표식)에 흔적이 하나도 안 남는다.
   * 🔴 `dryRun`·`test`를 그대로 싣는다 — 실제로 안 나간 발송을 "보냈다"로 적으면 감사로그가 거짓이 된다.
   */
  await logAction({
    action: "textbook_notice_send",
    targetType: "textbook_order",
    // 실제로 나간 수(테스트·dry-run은 고른 수) — 제외된 학생을 '보냈다'로 적지 않는다.
    targetLabel:
      res.dryRun || input.test
        ? `학생 ${students.length}명 · 요청서 ${sendableIds.size}건`
        : `학생 ${res.queued ?? 0}명 · 요청서 ${linkedIds.length}건`,
    metadata: {
      // 실제로 나간 요청서(큐에 오른 학생의 것) — 제외된 학생의 요청서는 싣지 않는다. 테스트·dry-run은 연결이 없어 고른 것 그대로.
      orderIds: res.dryRun || input.test ? [...sendableIds] : linkedIds,
      studentCount: students.length,
      queued: res.queued ?? 0,
      noticeId: res.noticeId ?? null,
      dryRun: res.dryRun ?? false,
      test: input.test ?? false,
      skippedCount: merged.length,
    },
  });
  // 다음 발송의 기본값으로 남긴다(중간저장) — best-effort라 실패해도 발송 결과엔 영향 없음.
  await saveMyTextbookMent(ment);
  return { ok: true, queued: res.queued ?? 0, dryRun: res.dryRun, skipped: merged };
}
