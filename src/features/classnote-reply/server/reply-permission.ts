import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { kstToday } from "@/lib/date-kst";
import {
  buildReplyAuthorName,
  canChangeReply,
  isReplyManager,
  replyPlaceConfirmed,
  replyStatusView,
  replyTargetAllowed,
  teacherReplyLabel,
  type ReplyMode,
} from "../reply-policy";
import type { ReplyView } from "../reply-types";
import { confirmedStudentOf, resolveBoard, studentClassForAuthor, type ParentMessage, type ReplyRow } from "./reply-data";
import { currentTeachersOfClass, currentTeachersOfStudent } from "./reply-eligibility";

/**
 * 답글·공감 권한과 게시 명의(0317a·0319a) — 조회 화면과 요청 액션이 **같은 함수**로 판정한다(화면 판정과 서버 판정이 갈라지지 않게, #77).
 * 순서: 모드(끔 = 없는 기능 · 시험 = 학원이만 · 전체) → 발송 스위치 → '다른 강사 뷰'(열람 전용) → 자격(관리자급 또는 그 학생 벨을 받는 사람)
 *       → 전체 모드의 대상 확정(워커가 통과시킬 수 있는 자리인가 — 받아 놓고 실패로 끝나지 않게 미리 본다) → 게시 명의.
 */
type Admin = ReturnType<typeof createAdminClient>;

export type ReplyPermission =
  | { canReply: true; reason: null; authorLabel: string; boardId: number | null; studentId: string | null }
  | { canReply: false; reason: string; authorLabel: string | null; boardId: null; studentId: string | null };

/** 한 요청 안에서 같은 조회를 되풀이하지 않게(벨이 알림 여러 개를 한 번에 판정할 때) — 키 → 진행 중인 조회. */
export type PermissionMemo = Map<string, Promise<unknown>>;
function once<T>(memo: PermissionMemo | undefined, key: string, run: () => Promise<T>): Promise<T> {
  if (!memo) return run();
  if (!memo.has(key)) memo.set(key, run());
  return memo.get(key) as Promise<T>;
}

const NOT_RECIPIENT = "이 학생을 지금 맡고 있는 선생님(담임·부담임·오늘 위임)과 원장·관리자·매니저만 답글을 쓸 수 있습니다";

async function studentOfMessage(admin: Admin, tenantId: string, message: ParentMessage, classId: string | null): Promise<string | null> {
  if (message.studentId) return message.studentId;
  if (!classId || message.childId == null) return null;
  // 반 보드 글 — 저장된 원아 매칭(0302a ok)으로만 학생을 정한다(이름으로 고르지 않는다).
  const { data } = await admin
    .from("classnote_class_board_members")
    .select("student_id")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("child_id", message.childId)
    .eq("status", "ok")
    .limit(2);
  return (data ?? []).length === 1 ? (data![0]!.student_id as string) : null;
}

export async function decideReplyPermission(
  admin: Admin,
  a: { user: CurrentUser; manager: boolean; message: ParentMessage; sendOn: boolean; mode: ReplyMode },
  memo?: PermissionMemo,
): Promise<ReplyPermission> {
  const { user, message, mode } = a;
  const deny = (reason: string, authorLabel: string | null = null, studentId: string | null = null): ReplyPermission => ({
    canReply: false, reason, authorLabel, boardId: null, studentId,
  });
  const target = replyTargetAllowed(mode, { boardName: message.boardName, childId: message.childId });
  if (!target.ok) return deny(target.reason);
  if (!a.sendOn) return deny("ClassNote 발송이 꺼져 있어 답글을 보낼 수 없습니다");
  const ro = await once(memo, "ro", () => readonlyTeacherViewError());
  if (ro) return deny(ro);
  // 내 호칭 조회는 아래 판정과 독립이라 먼저 띄워 둔다(B4 — 줄 세우지 않는다). supabase 조회는 `.then`을 불러야 출발한다.
  const meP = once(memo, "me", () =>
    Promise.resolve(admin.from("users").select("display_name, report_display_name").eq("tenant_id", user.tenantId).eq("id", user.id).maybeSingle())
      .then((r) => r.data as { display_name: string | null; report_display_name: string | null } | null, () => null),
  );
  const board = await once(memo, `board:${message.boardName ?? ""}`, () => resolveBoard(admin, user.tenantId, message.boardName));
  const studentId = await studentOfMessage(admin, user.tenantId, message, board.classId);
  const today = kstToday();
  // 자격 = 원장·관리자·매니저 ∪ 그 학생(모르면 그 반)을 **지금** 맡은 사람 — 학부모 글 벨 수신자와 같은 규칙.
  let eligible = a.manager || isReplyManager(user.systemRole);
  if (!eligible && user.systemRole !== "student") {
    const keys = board.keys.join(",");
    const teachers = studentId && board.keys.length
      ? await once(memo, `st:${studentId}:${keys}`, () => currentTeachersOfStudent(admin, { tenantId: user.tenantId, studentId, subjectKeys: board.keys, today }))
      : !studentId && board.classId
        ? await once(memo, `cl:${board.classId}:${keys}`, () => currentTeachersOfClass(admin, { tenantId: user.tenantId, classId: board.classId!, subjectKeys: board.keys, today }))
        : [];
    eligible = teachers.includes(user.id);
  }
  const me = await meP;
  const teacherLabel = teacherReplyLabel({
    reportDisplayName: me?.report_display_name ?? null,
    displayName: me?.display_name ?? user.displayName,
  });
  const className = board.className ?? (await studentClassForAuthor(admin, { tenantId: user.tenantId, studentId, userId: user.id, keys: board.keys, today }));
  // 보드 이름을 명의에 쓰는 건 반 보드로 확인된 것만(0302a 연결 · 시험 단계의 테스트 보드).
  const boardIsClass = !!board.classId || target.boardId !== null;
  const authorLabel = buildReplyAuthorName({ boardName: message.boardName, boardIsClass, className, teacherLabel });
  if (!eligible) return deny(NOT_RECIPIENT, teacherLabel ? authorLabel : null, studentId);
  // 전체 모드 — 워커가 다시 확인할 연결(보드·원아·학생)을 미리 본다. 시험 보드·시험 모드는 그대로 통과.
  if (mode === "on" && target.boardId === null) {
    const confirmed = await confirmedStudentOf(admin, user.tenantId, { classId: board.classId, childId: message.childId });
    const place = replyPlaceConfirmed({
      mode, testBoardId: target.boardId, boardIsClass: !!board.classId, boardName: message.boardName,
      studentId: studentId && confirmed?.studentId === studentId ? studentId : null, childId: message.childId,
      studentBoardName: confirmed?.boardName ?? null,
    });
    if (!place.ok) return deny(place.reason, teacherLabel ? authorLabel : null, studentId);
  }
  // 호칭이 비면 명의가 반 이름만 남는다("BS3Q") — 누가 썼는지 없는 댓글을 학부모에게 보내지 않는다.
  if (!teacherLabel || !authorLabel.trim()) return deny("게시 명의를 만들 수 없습니다 — 직원 이름을 확인하세요", null, studentId);
  return { canReply: true, reason: null, authorLabel, boardId: target.boardId, studentId };
}

export function toReplyView(r: ReplyRow, user: CurrentUser, manager: boolean): ReplyView {
  const v = replyStatusView({ status: r.status, editedAt: r.editedAt, error: r.error, failedAction: r.failedAction });
  return {
    id: r.id, authorLabel: r.authorLabel, body: r.body, pendingBody: r.pendingBody, statusLabel: v.label, tone: v.tone, busy: v.busy,
    error: r.error, errorRaw: r.errorRaw,
    canChange: canChangeReply({ userId: user.id, role: user.systemRole, manager, authorUserId: r.authorUserId, status: r.status, retryCount: r.retryCount, claimed: r.claimed }),
    notPosted: r.status === "queued",
    mine: r.authorUserId === user.id, createdAt: r.createdAt, editedAt: r.editedAt, historyCount: r.editHistory.length,
  };
}
