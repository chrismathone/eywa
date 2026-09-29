import type { Face } from "@/components/face-tabs";

const CLASSNOTE_TABS = new Set(["queue", "boards", "notice", "compose", "recall"]);

export function isClassnoteReportTab(key: string): boolean {
  return CLASSNOTE_TABS.has(key);
}

export function lessonReportFaces({ canOwner, canSend, classnoteOn }: {
  canOwner: boolean; canSend: boolean; classnoteOn: boolean;
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
  if (canOwner) faces.push(
    { key: "report", label: "보고서 설정", href: "/lesson-reports?tab=report", group: "설정" },
    { key: "ai_ment", label: "AI 멘트", href: "/lesson-reports?tab=ai_ment", group: "설정" },
  );
  return faces.filter((face) => classnoteOn || !isClassnoteReportTab(face.key));
}
