import type { Face } from "@/components/face-tabs";

const CLASSNOTE_TABS = new Set(["queue", "boards", "notice", "compose", "recall", "parent_replies"]);

export function isClassnoteReportTab(key: string): boolean {
  return CLASSNOTE_TABS.has(key);
}

export function lessonReportFaces({ canOwner, canSend, classnoteOn, aiOn = true, replyOn = false }: {
  canOwner: boolean; canSend: boolean; classnoteOn: boolean;
  /** AI 분석 라이선스 — 꺼진 지점엔 'AI 멘트' 면이 없다(2026-09-30 "꺼지면 흔적 없이"). */
  aiOn?: boolean;
  /** 학부모 글 답글·공감 모드가 시험·전체인가(학원 설정, 기본 끔) — 끔이면 '학부모 글·답글' 면이 없다(있었는지조차 모르게). */
  replyOn?: boolean;
}): Face[] {
  const faces: Face[] = [
    { key: "video_homework", label: "영상 제출 현황", href: "/lesson-reports/video-homework", group: "관리" },
    { key: "queue", label: "클래스노트 발송 큐", href: "/lesson-reports?tab=queue", group: "관리" },
    { key: "writing", label: "작성률", href: "/lesson-reports?tab=writing", group: "관리" },
    { key: "boards", label: "반 구성", href: "/lesson-reports?tab=boards", group: "관리" },
    { key: "list", label: "목록", href: "/lesson-reports?tab=list", group: "관리" },
    { key: "notice", label: "반 공지", href: "/lesson-reports?tab=notice", group: "관리" },
  ];
  if (canSend) faces.push(
    { key: "compose", label: "직접 발송", href: "/lesson-reports?tab=compose", group: "관리" },
    { key: "recall", label: "회수", href: "/lesson-reports?tab=recall", group: "관리" },
  );
  // 학부모 글·댓글 + 답글·공감(0317a·0319a) — ClassNote 모듈 면이고, 학원 설정 '학부모 글 답글·공감'이 끔이면 세우지 않는다.
  // 답글 자격은 창·서버 액션이 다시 본다.
  if (canSend && replyOn) faces.push({ key: "parent_replies", label: "학부모 글·답글", href: "/lesson-reports?tab=parent_replies", group: "관리" });
  if (canOwner) faces.push(
    { key: "report", label: "보고서 설정", href: "/lesson-reports?tab=report", group: "설정" },
    ...(aiOn ? [{ key: "ai_ment", label: "AI 멘트", href: "/lesson-reports?tab=ai_ment", group: "설정" } as Face] : []),
  );
  return faces.filter((face) => classnoteOn || !isClassnoteReportTab(face.key));
}
