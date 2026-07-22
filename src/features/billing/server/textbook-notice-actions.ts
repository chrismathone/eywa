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
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accountForTarget } from "@/features/owner/settings-types";
import { BOARD_PREFIX } from "@/features/report-admin/notice-targets";
import { sendOnescreenNotice } from "@/features/onescreen/server/notice-actions";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { DEFAULT_TEXTBOOK_MENT, textbookNoticeCommon } from "../textbook-notice";
import { groupTextbookNoticeStudents } from "../textbook-notice-group";
import type {
  PreparedTextbookNotice,
  SendTextbookNoticeResult,
  TextbookNoticeSkip,
} from "../textbook-notice-types";
import {
  getMyTextbookMent,
  getNoticeAttachmentWorkerGate,
  getStudentBoardSubjects,
  loadScopedOrders,
} from "./textbook-notice-data";

const MENT_MAX = 2000;

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
 * 저장해 둔 내 멘트(없으면 기본 문구) — **작성 폼**에서 학부모 메시지 칸의 초기값으로 읽는다.
 * 발송 다이얼로그는 `prepareTextbookNotice`가 이미 같이 실어주므로 이 액션을 또 부르지 않는다(왕복 1회).
 */
export async function loadMyTextbookMent(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_TEXTBOOK_MENT;
  return (await getMyTextbookMent()) ?? DEFAULT_TEXTBOOK_MENT;
}

/** 발송 다이얼로그 진입 — 요청 행 + 학생별 발송 가능 과목 + 내 멘트 + 계좌 + 발송/첨부 스위치를 한 번에. */
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
  // 서로 독립인 조회 4건 — 직렬 워터폴 금지(B4).
  const [subjects, savedMent, settings, worker] = await Promise.all([
    getStudentBoardSubjects(studentIds),
    getMyTextbookMent(),
    getTenantSettings(),
    getNoticeAttachmentWorkerGate(),
  ]);
  const acc = accountForTarget(settings.billing, "textbook");
  return {
    ok: true,
    orders: loaded.rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      teacherName: r.teacher_name,
      bookName: r.book_name,
      bookDetail: r.book_detail,
      price: Number(r.price),
      requestDate: r.request_date,
      subjects: (r.student_id ? subjects[r.student_id] : undefined) ?? [],
    })),
    ment: savedMent ?? DEFAULT_TEXTBOOK_MENT,
    account: { bank: acc.bank, holder: acc.holder, number: acc.number },
    sendEnabled: settings.report.classnoteSendEnabled,
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
  const user = await getCurrentUser();
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

  // 학생별 묶음(같은 학생 여러 건 = 한 글) 조립은 순수 함수 — 액션은 인가·게이트·레일 호출만 책임진다.
  const { students, skipped } = groupTextbookNoticeStudents(
    loaded.rows.map((r) => ({
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
  // 테스트 발송: 학원이 보드 1곳이므로 첫 학생 글·첨부를 합본으로 만들어 공통 자리에 통째로 싣는다(위 함정 주석).
  const res = input.test
    ? await sendOnescreenNotice({
        body: [textbookNoticeCommon(ment), students[0]!.individualBody].filter(Boolean).join("\n\n"),
        students: [],
        attachments: [...common, ...(students[0]!.attachments ?? [])],
        test: true,
      })
    : await sendOnescreenNotice({ body: textbookNoticeCommon(ment), students, attachments: common });
  const merged: TextbookNoticeSkip[] = [
    ...skipped,
    ...(res.skipped ?? []).map((s) => ({ name: s.name, reason: s.reason })),
  ];
  if (!res.ok) return { ok: false, error: res.error, skipped: merged };
  // 다음 발송의 기본값으로 남긴다(중간저장) — best-effort라 실패해도 발송 결과엔 영향 없음.
  await saveMyTextbookMent(ment);
  return { ok: true, queued: res.queued ?? 0, dryRun: res.dryRun, skipped: merged };
}
