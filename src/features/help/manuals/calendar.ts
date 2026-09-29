import type { HelpManual } from "../types";

export const calendar: HelpManual = {
  slug: "calendar",
  title: "캘린더",
  href: "/calendar",
  menuKey: "calendar",
  group: "홈",
  layout: "grid",
  summary:
    "학원 공용 일정입니다. 사이드바에서는 숨겨 두었고, 주소를 아는 사람·검색 팰릿 일부만 엽니다. 구글 캘린더와 상시 동기화하지 않습니다.",
  related: ["dashboard", "approvals"],
  callouts: [
    {
      n: 1,
      label: "일정 등록",
      zone: "header",
      body: "날짜(시간 선택 가능)와 제목·태그를 적습니다. 사무실이 쓰고 나머지 직원은 읽습니다.",
    },
    {
      n: 2,
      label: "태그 관리",
      zone: "header",
      body: "일정 색 태그입니다.",
    },
    {
      n: 3,
      label: "보기 · 기간 · 태그",
      zone: "toolbar",
      body: "월/연/목록/분석. 기간 네비의 가운데를 누르면 이번 달(또는 올해)입니다.",
    },
    {
      n: 4,
      label: "날짜 칸",
      zone: "cell",
      body: "누르면 그날 일정 목록. 레벨테스트 일정은 [[dashboard|대시보드]] ‘금일 입테’와 같은 분류입니다.",
    },
  ],
};
