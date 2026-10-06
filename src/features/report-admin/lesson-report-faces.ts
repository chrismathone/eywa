import type { Face } from "@/components/face-tabs";

export const CLASSNOTE_REPORT_TABS = ["queue", "boards", "notice", "compose", "recall", "parent_replies"] as const;
export type ClassnoteReportTab = (typeof CLASSNOTE_REPORT_TABS)[number];
export type LessonReportTab = ClassnoteReportTab | "writing" | "list" | "report" | "ai_ment";

const CLASSNOTE_TABS: ReadonlySet<string> = new Set(["classnote", ...CLASSNOTE_REPORT_TABS]);

export function isClassnoteReportTab(key: string): boolean {
  return CLASSNOTE_TABS.has(key);
}

export type LessonReportFaceOptions = {
  canReportSettings: boolean; canAiMent: boolean; canSend: boolean; classnoteOn: boolean;
  /** AI 분석 라이선스 — 꺼진 지점엔 'AI 멘트' 면이 없다(2026-09-30 "꺼지면 흔적 없이"). */
  aiOn?: boolean;
  /** 학부모 글 답글·공감 모드가 시험·전체인가(학원 설정, 기본 끔) — 끔이면 '학부모 글·답글' 면이 없다(있었는지조차 모르게). */
  replyOn?: boolean;
  canReports?: boolean;
};

/** 새 URL와 기존 알림·즐겨찾기의 ?tab=queue 등은 같은 서버 판정으로 연다. */
export function classnoteReportFaces({ canSend, classnoteOn, replyOn = false, canReports = true }: LessonReportFaceOptions): Face[] {
  if (!classnoteOn || !canReports) return [];
  const faces: Face[] = [
    { key: "queue", label: "발송 큐", href: "/lesson-reports?tab=classnote&section=queue" },
    { key: "boards", label: "반 구성", href: "/lesson-reports?tab=classnote&section=boards" },
    { key: "notice", label: "반 공지", href: "/lesson-reports?tab=classnote&section=notice" },
  ];
  if (canSend) faces.push(
    { key: "compose", label: "직접 발송", href: "/lesson-reports?tab=classnote&section=compose" },
    { key: "recall", label: "회수", href: "/lesson-reports?tab=classnote&section=recall" },
  );
  if (canSend && replyOn) faces.push({ key: "parent_replies", label: "학부모 글·답글", href: "/lesson-reports?tab=classnote&section=parent_replies" });
  return faces;
}

export function lessonReportFaces(options: LessonReportFaceOptions): Face[] {
  const { canReportSettings, canAiMent, aiOn = true, canReports = true } = options;
  const faces: Face[] = [
    { key: "video_homework", label: "영상 제출 현황", href: "/lesson-reports/video-homework", group: "관리" },
    { key: "writing", label: "작성률", href: "/lesson-reports?tab=writing", group: "관리" },
    { key: "list", label: "목록", href: "/lesson-reports?tab=list", group: "관리" },
  ];
  if (classnoteReportFaces(options).length) faces.push({ key: "classnote", label: "클래스노트", href: "/lesson-reports?tab=classnote", group: "관리" });
  if (canReportSettings) faces.push({ key: "report", label: "보고서 설정", href: "/lesson-reports?tab=report", group: "설정" });
  if (canAiMent && aiOn) faces.push({ key: "ai_ment", label: "AI 멘트", href: "/lesson-reports?tab=ai_ment", group: "설정" });
  return faces.filter((face) => canReports || face.group === "설정");
}

/** URL를 믿지 않고, 화면과 같은 모듈·메뉴·쓰기·답글 설정으로 조회할 면을 고른다. */
export function resolveLessonReportTab(sp: { tab?: string; section?: string }, options: LessonReportFaceOptions): LessonReportTab {
  const children = classnoteReportFaces(options);
  const requested = sp.tab === "classnote" ? sp.section ?? "queue" : sp.tab;
  if (requested && children.some((face) => face.key === requested)) return requested as ClassnoteReportTab;
  // 클래스노트 하위 URL로 설정 등 다른 면을 열지 않는다.
  if (sp.tab === "classnote") return "writing";
  if (requested && lessonReportFaces(options).some((face) => face.key === requested)) {
    if (requested === "writing" || requested === "list" || requested === "report" || requested === "ai_ment") return requested;
  }
  return "writing";
}
