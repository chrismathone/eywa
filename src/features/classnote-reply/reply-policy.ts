/**
 * ClassNote **학부모 글·댓글 답글**(0317a) — 앱 쪽 순수 판정(서버·클라 공용, `server-only` 금지 #61).
 *
 * 원장 2026-09-30 *"이전 1인 반에서 작동하는 기능을 반 기준으로 바꿔도 작동하게"* — aywa에서 쓴 답글을 연동 PC 워커가
 * ClassNote 그 글에 댓글로 올린다. 게시 명의 = `<반 이름> <강사 호칭>`(예 "BS3Q 수진T"), 본문엔 서명을 넣지 않는다(원장 결정).
 * 🔴 모드 = 학원 설정 `report.classnoteParentReplyMode`(끔·시험·전체, 기본 끔) — 읽는 자리는 [`classnoteReplyMode`](../owner/classnote-gate.ts)
 *    하나다(모듈이 꺼지면 끔). 이 파일의 함수는 모드를 **인자로** 받는다(상수 없음).
 *    끔 = 없는 기능(버튼·면·서버 전부) · 시험 = 학원이 테스트 보드의 학원이 글만 · 전체 = 답글 자격이 있는 글(워커가 확정 연결을 다시 본다).
 * 🔴 워커가 길이·테스트 대상을 `scripts/_classnote/parent-reply-guard.mjs`에 따로 든다(런타임이 달라서) — 한쪽을 바꾸면 다른 쪽도
 *    (가드: reply-guard-parity.test.ts).
 */

import type { SemanticTone } from "@/lib/design/semantic-color";

export const REPLY_BODY_MAX = 1000;
export const REPLY_AUTHOR_MAX = 60;
export type ReplyMode = "off" | "test" | "on";
export const REPLY_TEST_TARGETS = {
  boards: [
    { id: 1317083, name: "[수학] 테스트반" },
    { id: 1291581, name: "(수학)학원이" },
  ],
  childIds: [5268389],
} as const;
/** 같은 사람이 같은 글에 다시 쓰기까지(초) — 재클릭·연타 방지(진짜 자물쇠는 DB 유니크). */
export const REPLY_COOLDOWN_SEC = 20;
/** 연동 PC 심장박동이 이 안에 있어야 요청을 받는다(분) — classnote-sync `SYNC_WORKER_ALIVE_MIN`과 같은 값. */
export const REPLY_WORKER_ALIVE_MIN = 5;
/** 누구 글이든 답할 수 있는 역할(원장·관리자·매니저). 그 밖은 그 학생 벨을 받는 사람만. */
export const REPLY_MANAGER_ROLES = ["master", "admin", "manager"] as const;

export type ReplyStatus = "queued" | "processing" | "success" | "failed" | "edit_requested" | "delete_requested" | "deleted";
export const REPLY_BUSY: readonly ReplyStatus[] = ["queued", "processing", "edit_requested", "delete_requested"];

export function isReplyManager(role: string | null | undefined): boolean {
  return !!role && (REPLY_MANAGER_ROLES as readonly string[]).includes(role);
}

/** 메시지(보드 이름·원아)가 테스트 대상이면 그 보드 번호, 아니면 null — 이름은 테스트 목록 안에서만 번호로 바꾼다. */
export function testTargetBoardId({ boardName, childId }: { boardName: string | null; childId: number | null }): number | null {
  const board = REPLY_TEST_TARGETS.boards.find((b) => b.name === (boardName ?? "").trim());
  if (!board || childId == null || !(REPLY_TEST_TARGETS.childIds as readonly number[]).includes(Number(childId))) return null;
  return board.id;
}

/**
 * 지금 모드에서 이 메시지에 답글·공감을 받을 수 있나. 통과하면 워커가 대조할 보드 번호(알면 — 시험 보드만 안다).
 * 전체(on)는 여기서 다 통과시키고, 누가 쓸 수 있는지(자격)·대상이 확정됐는지는 서버 `decideReplyPermission`이 본다.
 * 🔴 모르는 모드 값은 끔으로 읽는다(타입 밖 값이 와도 열리지 않는다).
 */
export function replyTargetAllowed(
  mode: ReplyMode,
  target: { boardName: string | null; childId: number | null },
): { ok: true; boardId: number | null } | { ok: false; reason: string } {
  const boardId = testTargetBoardId(target);
  if (mode === "on") return { ok: true, boardId };
  if (mode === "test") return boardId ? { ok: true, boardId } : { ok: false, reason: "시험 단계라 학원이 테스트 보드의 글에만 답글을 쓸 수 있습니다" };
  return { ok: false, reason: "사용할 수 없는 기능입니다" };
}

/** 발송용 1인 보드 `(수학)홍길동`·`(영어)홍길동`의 학생 이름 부분(공백 무시) — 그 모양이 아니면 null. 워커 `personalBoardOf`와 같은 규칙. */
export function personalBoardStudentName(boardName: string | null): string | null {
  const m = /^\((수학|영어)\)(.+)$/.exec((boardName ?? "").replace(/\s/g, ""));
  return m ? m[2]! : null;
}

/**
 * 전체(on) 모드에서 그 보드가 aywa가 아는 **모양**인가 — 0302a에 하나로 연결된 반 보드(`boardIsClass`)이거나 1인 보드 `(수학|영어)이름`.
 * 목록(벨·'학부모 글·답글' 면)이 버튼을 세울지 정할 때 쓴다: 영어 그룹반처럼 어차피 받지 않는 글에 "눌러도 안 되는 버튼"을 세우지 않는다.
 * 시험 보드·시험 모드는 그대로 통과(그쪽은 `replyTargetAllowed`가 이미 걸렀다).
 */
export function replyBoardKnown(a: { mode: ReplyMode; testBoardId: number | null; boardIsClass: boolean; boardName: string | null }): boolean {
  if (a.mode !== "on" || a.testBoardId !== null) return true;
  return a.boardIsClass || personalBoardStudentName(a.boardName) !== null;
}

/**
 * 전체(on) 모드에서 워커가 통과시킬 수 있는 자리인가 — 앱이 **요청을 받기 전에** 같은 조건을 미리 본다(받아 놓고 실패로 끝나지 않게).
 * 워커 `evaluateReplyTarget`의 ③·⑤에 해당: 보드가 0302a에 하나로 연결된 반 보드이거나, 1인 보드 `(과목)이름`이고 그 이름이
 * **확정 연결된 학생의 보드 이름**(`studentBoardName` = ClassNote용 이름 > 이름)과 같다. 그리고 학생·원아가 확정돼 있다.
 * 시험 보드(boardId 있음)는 그대로 통과. 최종 판정은 워커가 ClassNote를 다시 읽어 한다(여기는 안내용 사전 확인).
 */
export function replyPlaceConfirmed(a: {
  mode: ReplyMode; testBoardId: number | null; boardIsClass: boolean; boardName: string | null; studentId: string | null; childId: number | null;
  /** 1인 보드일 때만 본다 — 확정 연결된 학생의 보드 이름에 쓰이는 이름 */
  studentBoardName?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (a.mode !== "on" || a.testBoardId !== null) return { ok: true };
  const personal = a.boardIsClass ? null : personalBoardStudentName(a.boardName);
  if (!replyBoardKnown(a)) return { ok: false, reason: "aywa에 연결된 반 보드나 1인 보드의 글이 아니라 답글을 올릴 수 없습니다" };
  if (!a.studentId || a.childId == null) return { ok: false, reason: "이 글의 학생을 확정하지 못해 답글을 올릴 수 없습니다" };
  if (personal && personal !== (a.studentBoardName ?? "").replace(/\s/g, ""))
    return { ok: false, reason: "보드 이름이 이 학생의 1인 보드와 달라 답글을 올릴 수 없습니다" };
  return { ok: true };
}

/** 본문 검사 — 앞뒤 공백·줄바꿈 표기만 정리(워커 `normalizeReplyText`와 같은 규칙). */
export function validateReplyBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "답글 내용을 입력하세요" };
  if (body.length > REPLY_BODY_MAX) return { ok: false, error: `답글은 ${REPLY_BODY_MAX}자까지 쓸 수 있습니다(지금 ${body.length}자)` };
  return { ok: true, body };
}

/** 강사 호칭 — 수업보고서 발송용 이름(0217a)이 있으면 그 이름, 없으면 표시 이름(보고서 작성자명과 같은 규약). */
export function teacherReplyLabel({ reportDisplayName, displayName }: { reportDisplayName: string | null; displayName: string | null }): string {
  return (reportDisplayName ?? "").trim() || (displayName ?? "").trim();
}

/** 1인 보드 `(과목)학생명`의 과목 라벨 — 반 보드면 null. */
export function personalBoardSubject(boardName: string | null): string | null {
  const m = /^\(([^)]+)\)/.exec((boardName ?? "").trim());
  return m ? m[1]!.trim() : null;
}

/**
 * 게시 명의 `<반 이름> <강사 호칭>`. 반 보드면 보드 이름(= aywa 반 이름)이 곧 반 이름이다.
 * 1인 보드 `(수학)학생명`이면 보드 이름이 학생 이름이라 명의로 쓰지 않는다 — 그 학생이 지금 다니는 그 과목 반 이름
 * (`className`, 서버가 정한다)을 쓰고, 모르면 보드의 과목 라벨("수학 수진T").
 * 🔴 보드 이름은 **반 보드로 확인된 것만**(`boardIsClass` — 0302a 연결이 있거나 시험 단계 테스트 보드) 명의에 쓴다.
 *    확인 안 된 보드 이름은 학생 이름일 수 있다(`(과목)` 접두 없는 1인 보드) — 학부모에게 보이는 이름에 싣지 않는다.
 */
export function buildReplyAuthorName(a: { boardName: string | null; boardIsClass: boolean; className: string | null; teacherLabel: string }): string {
  const who = a.teacherLabel.trim();
  const subject = personalBoardSubject(a.boardName);
  const board = a.boardIsClass && !subject ? (a.boardName ?? "").trim() : "";
  const where = board || (a.className ?? "").trim() || subject || "";
  const name = [where, who].filter(Boolean).join(" ");
  if (name.length <= REPLY_AUTHOR_MAX) return name;
  const room = Math.max(1, REPLY_AUTHOR_MAX - who.length - 2);
  return `${where.slice(0, room)}… ${who}`.slice(0, REPLY_AUTHOR_MAX);
}

/**
 * 수정·삭제할 수 있나 — 작성자 본인 또는 관리자급, 그리고 손댈 수 있는 상태(대기·게시됨).
 * `manager` = 서버가 정한 관리자급 여부(역할 + 보호된 계정 자동 통과) — 주면 역할 판정에 더한다.
 * 🔴 연동 PC가 **한 번이라도 집은**(`claimed` — 재시도로 돌아왔든 멈춤 복구로 돌아왔든) 대기 행은 "아직 ClassNote에 없다"고 볼 수 없다 —
 *    게시 요청이 나갔는데 응답이 끊겼을 수 있어서다. 그 상태에서 aywa 기록만 고치면 워커가 고친 본문을 못 찾아 **한 번 더 게시**한다(댓글 2개).
 *    연동 PC가 확정할 때까지 막는다(`retryCount` > 0도 같은 뜻).
 */
export function canChangeReply(a: { userId: string; role: string; authorUserId: string | null; status: ReplyStatus; manager?: boolean; retryCount?: number; claimed?: boolean }): boolean {
  if (a.status !== "queued" && a.status !== "success") return false;
  if (a.status === "queued" && ((a.retryCount ?? 0) > 0 || a.claimed === true)) return false;
  return a.manager === true || isReplyManager(a.role) || (!!a.authorUserId && a.authorUserId === a.userId);
}

/** tone = 의미색 캐논(semantic-color) — 연동 PC가 하는 중 = info · 게시됨 = positive · 수정/삭제 실패 = caution · 실패 = critical · 삭제 = inert. */
export type ReplyStatusView = { label: string; tone: SemanticTone; busy: boolean };

/** 상태 → 화면 라벨(raw 코드 노출 금지). */
export function replyStatusView(r: { status: ReplyStatus; editedAt?: string | null; error?: string | null; failedAction?: string | null }): ReplyStatusView {
  switch (r.status) {
    case "queued":
      return { label: "올리기 대기", tone: "info", busy: true };
    case "processing":
      return { label: "ClassNote에 반영 중", tone: "info", busy: true };
    case "edit_requested":
      return { label: "수정 대기", tone: "info", busy: true };
    case "delete_requested":
      return { label: "삭제 대기", tone: "info", busy: true };
    case "failed":
      return { label: "올리지 못함", tone: "critical", busy: false };
    case "deleted":
      return { label: "삭제됨", tone: "inert", busy: false };
    default:
      if (r.error && r.failedAction === "edit") return { label: "게시됨 · 수정 실패", tone: "caution", busy: false };
      if (r.error && r.failedAction === "delete") return { label: "게시됨 · 삭제 실패", tone: "caution", busy: false };
      return { label: r.editedAt ? "게시됨(수정됨)" : "게시됨", tone: "positive", busy: false };
  }
}

/** 기능별로 워커가 실어야 하는 표식. 답글은 **설정 모드를 읽는 판**(`parentReplySettings`)이어야 한다 — 옛 판은 모드가 코드 상수(시험)다. */
const REQUIRED_CAPS = { parentReply: ["parentReply", "parentReplySettings"], parentReaction: ["parentReaction"] } as const;

/**
 * 연동 PC가 답글(`parentReply`)·공감(`parentReaction`)을 받을 수 있나 — 살아 있는 실게시 PC가 있고, 그 PC가 **전부** 그 기능을 아는 버전이다.
 * 🔴 "한 대라도 알면"이 아니다: 실게시는 지점당 한 대(먼저 시작한 PC)만 돌아, 옛 판 PC가 담당이고 새 판 PC가 대기 중이면
 *    요청을 받아도 아무도 집지 않는다(24시간 뒤 만료). 살아 있는 실게시 PC 중 하나라도 옛 판이면 받지 않는다.
 */
export function workerReadyForReplies(rows: { last_seen: string | null; last_results: unknown }[], nowMs: number, cap: "parentReply" | "parentReaction" = "parentReply"): boolean {
  const live = rows.flatMap((r) => {
    const seen = r.last_seen ? Date.parse(r.last_seen) : NaN;
    if (!Number.isFinite(seen) || nowMs - seen > REPLY_WORKER_ALIVE_MIN * 60_000) return [];
    const o = r.last_results && typeof r.last_results === "object" && !Array.isArray(r.last_results) ? (r.last_results as Record<string, unknown>) : null;
    if (o?.postMode !== true) return [];
    return [o.caps && typeof o.caps === "object" && !Array.isArray(o.caps) ? (o.caps as Record<string, unknown>) : {}];
  });
  return live.length > 0 && live.every((caps) => REQUIRED_CAPS[cap].every((k) => caps[k] === true));
}
