export const HELP_POST_STATUSES = ["open", "answered", "closed"] as const;
export type HelpPostStatus = (typeof HELP_POST_STATUSES)[number];

export const HELP_POST_STATUS_LABEL: Record<HelpPostStatus, string> = {
  open: "대기",
  answered: "답변됨",
  closed: "닫힘",
};

export type HelpPostListItem = {
  id: string;
  title: string;
  status: HelpPostStatus;
  authorId: string;
  authorName: string;
  createdAt: string;
  answerCount: number;
};

export type HelpAnswer = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type HelpPostDetail = {
  id: string;
  title: string;
  body: string;
  status: HelpPostStatus;
  authorId: string;
  authorName: string;
  createdAt: string;
  answers: HelpAnswer[];
};

export type HelpBoardList = {
  ready: boolean;
  /** 표 부재가 아니라 조회 실패일 때. 화면에 원문 금지 — title 툴팁. */
  error?: { summary: string; raw: string };
  rows: HelpPostListItem[];
  total: number;
};

export function isHelpPostStatus(v: string): v is HelpPostStatus {
  return (HELP_POST_STATUSES as readonly string[]).includes(v);
}
