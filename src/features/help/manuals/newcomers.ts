import type { HelpManual } from "../types";

export const newcomers: HelpManual = {
  slug: "newcomers",
  title: "신규생 관리",
  href: "/newcomers",
  menuKey: "newcomers",
  group: "원생",
  layout: "list",
  summary:
    "신입 등록 후 90일 체크리스트입니다. 7·30·60·90일 창은 등록일에서 세지만, 사전 콜·첫 수업 안내·첫 수업 후 콜은 첫 수업일에 매달립니다.",
  related: ["students", "dashboard", "consultations"],
  callouts: [
    {
      n: 1,
      label: "창 필터",
      zone: "filters",
      body: "7일 / 30일 / 60일 / 90일. 경계의 원생이 목록과 [[dashboard|대시보드]] 신호에서 같은 날에 나타나도록 한 함수로 셉니다.",
    },
    {
      n: 2,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름.",
    },
    {
      n: 3,
      label: "체크 칸",
      zone: "cell",
      body: "사전 콜 · 첫 수업 안내 · OJT · 첫 수업 후 콜 · 1개월 · (필요시) 2개월 · 3개월. 완료율 분모는 기한이 온 필수 항목뿐입니다. 2개월은 필요시라 지연에 안 넣습니다.",
    },
    {
      n: 4,
      label: "첫 수업일",
      zone: "row",
      body: "가장 이른 수강 시작일입니다. 모르면 기한도 없고 지연으로 안 셉니다.",
    },
  ],
};
