import type { SemanticTone } from "@/lib/design/semantic-color";

/** 답글 한 줄(화면용) — 상태는 이미 한글 라벨·tone으로 바뀌어 있다(raw 코드 노출 금지). */
export type ReplyView = {
  id: string;
  authorLabel: string;
  body: string;
  pendingBody: string | null;
  statusLabel: string;
  tone: SemanticTone;
  busy: boolean;
  /** 한글 사유 */
  error: string | null;
  /** 원문(툴팁 전용) */
  errorRaw: string | null;
  canChange: boolean;
  /** 아직 ClassNote에 안 올라갔다(올리기 대기) — 삭제 = 취소. */
  notPosted: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  historyCount: number;
};

/**
 * 학부모 메시지 하나의 공감 상태(화면용, 0319a) — 상태는 이미 한글 라벨·tone으로 바뀌어 있다.
 * 공감 기능이 없는 자리(표 없음·옛 워커)는 이 값 자체가 null이다(버튼을 그리지 않는다).
 */
export type ReactionView = {
  messageId: string;
  /** 지금 눌려 있는(또는 누르는 중인) 종류의 한글 이름("확인했어요") — 기록이 없으면 null */
  typeLabel: string | null;
  /** 상태 한글 라벨("공감함"·"공감 누르는 중") — 기록이 없으면 null */
  statusLabel: string | null;
  tone: SemanticTone;
  /** ClassNote에 눌려 있다고 보는가 */
  pressed: boolean;
  busy: boolean;
  /** 누른 사람 명의("BS3Q 수진T") */
  by: string | null;
  error: string | null;
  errorRaw: string | null;
  /** 새로 누를 수 있는 상태인가(자격은 누를 때 서버가 본다) */
  canPress: boolean;
  /** 이 사람이 풀 수 있나(누른 사람 본인·관리자급 + 손댈 수 있는 상태) */
  canRemove: boolean;
};

export type ReactionActionResult = { ok: true; message: string; reaction: ReactionView } | { ok: false; error: string; reaction?: ReactionView | null };

/**
 * 벨이 열릴 때 한 번에 받는 것 — 답글을 쓸 수 있는 알림(알림 id → 메시지 id)과 그 메시지들의 공감 상태.
 * `vague` = 같은 글에 같은 문구의 댓글이 둘이라 알림이 어느 댓글인지 가릴 수 없는 메시지 — 벨에서는(행에서도, 거기서 연 답글 창에서도) 공감을 세우지 않는다.
 */
export type ReplyTargets = { targets: Record<string, string>; reactions: Record<string, ReactionView> | null; vague: string[] };

export type ReplyContext =
  | {
      ok: true;
      message: { id: string; source: "post" | "comment"; content: string; boardName: string | null; postedAt: string | null };
      replies: ReplyView[];
      canReply: boolean;
      /** 못 쓰는 이유(한글) — canReply면 null */
      reason: string | null;
      /** 학부모가 볼 이름표("BS3Q 수진T") */
      authorLabel: string | null;
      workerReady: boolean;
      maxLength: number;
      /** 공감 상태 — 공감 기능이 없는 자리(0319a 전·옛 워커)면 null */
      reaction: ReactionView | null;
    }
  | { ok: false; error: string };

export type ReplyActionResult = { ok: true; message: string; context: ReplyContext } | { ok: false; error: string };

/** 수업보고서 '학부모 글·답글' 면 한 줄. */
export type ParentThreadRow = {
  messageId: string;
  source: "post" | "comment";
  boardName: string | null;
  studentName: string | null;
  content: string;
  postedAt: string | null;
  replyCount: number;
  latest: { label: string; tone: SemanticTone } | null;
  replyable: boolean;
  /** 공감 상태 — 공감 버튼을 세우지 않는 줄이면 null */
  reaction: ReactionView | null;
};

/** `testOnly` = 시험 모드(학원이 테스트 보드의 글에만 쓸 수 있다는 안내를 단다). */
export type ParentThreadsView = { rows: ParentThreadRow[]; total: number; days: number; replyReady: boolean; testOnly: boolean };
