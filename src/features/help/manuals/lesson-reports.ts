import type { HelpManual } from "../types";

export const lessonReports: HelpManual = {
  slug: "lesson-reports",
  title: "수업보고서",
  href: "/lesson-reports",
  menuKey: "lesson_reports",
  group: "수업",
  layout: "list",
  summary:
    "[[onescreen|원스크린]]에서 저장된 보고서를 학부모 ClassNote로 보내는 발송 관리입니다. 강사별 작성률, 아직 안 나간 보고서, 실패 재발송이 여기 있습니다.",
  related: ["onescreen", "dashboard"],
  callouts: [
    {
      n: 1,
      label: "미발송 필터",
      zone: "filters",
      body: "아직 큐에 안 들어온 건까지 같은 조건으로 셉니다. 알림 종이 말한 숫자와 이 목록이 같아야 합니다.",
    },
    {
      n: 2,
      label: "강사 · 반 · 날짜",
      zone: "filters",
      body: "발송 대상을 좁힙니다. 영어는 학원설정에서 ClassNote 과목으로 켜야 나갑니다(기본은 수학).",
    },
    {
      n: 3,
      label: "발송",
      zone: "header",
      body: "선택된 보고서를 ClassNote 보드로 보냅니다. 실패 사유가 한글 요약으로 보이고, 원문은 마우스 오버입니다.",
    },
    {
      n: 4,
      label: "공지 · 직접 작성",
      zone: "header",
      body: "보고서 없이 공지만 보내거나, 사무실이 대신 작성합니다. 테스트 원생 ‘학원이’는 실제 반에 넣지 않습니다.",
    },
    {
      n: 5,
      label: "작성률",
      zone: "board",
      body: "강사별 이번 기간 작성. 영어는 에이와에 보고서를 쓰지 않아 운영실 미작성 신호에서 빠집니다.",
    },
  ],
};
