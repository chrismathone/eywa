import type { HelpManual } from "../types";

export const consultations: HelpManual = {
  slug: "consultations",
  title: "원생상담",
  href: "/consultations",
  menuKey: "consultations",
  group: "원생",
  layout: "list",
  summary: "재원생 면담 기록입니다. 행에 마우스를 올리면 내용이 보이고, 기본은 짧은 칸반형 목록입니다.",
  related: ["enrollment", "students", "retention"],
  callouts: [
    {
      n: 1,
      label: "새 상담",
      zone: "header",
      body: "재원 원생을 골라 면담을 적습니다. 녹음하면 AI가 학습·정서 포인트를 정리합니다.",
    },
    {
      n: 2,
      label: "기간",
      zone: "filters",
      body: "최근 7일 / 30일 / 전체. 축 이름 ‘기간:’이 라벨에 붙습니다.",
    },
    {
      n: 3,
      label: "과목 · 상담사",
      zone: "filters",
      body: "학원설정 과목과 이 학원 직원입니다.",
    },
    {
      n: 4,
      label: "후속",
      zone: "filters",
      body: "기한 지남 / 오늘 / 곧 / 나중에 / 완료. 후속이 있는 행만 남깁니다.",
    },
    {
      n: 5,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름·요약. 눌러야 나옵니다.",
    },
    {
      n: 6,
      label: "상담 행",
      zone: "row",
      body: "이름·학년 | 과목·상담사 | 요약 | 카테고리·후속·녹음·AI | 시각. 누르면 상세입니다. 창이 넓으면 2·3단으로 한 번에 더 많이 보입니다.",
    },
    {
      n: 7,
      label: "후속 토글",
      zone: "cell",
      body: "상세에서 후속 조치를 켜고 기한을 둡니다. 기한이 오면 알림 종이 담당 상담사에게 울립니다.",
    },
  ],
};
