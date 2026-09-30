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
};

export type ParentThreadsView = { rows: ParentThreadRow[]; total: number; days: number; replyReady: boolean };
