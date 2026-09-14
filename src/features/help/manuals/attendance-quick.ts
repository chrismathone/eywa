import type { HelpManual } from "../types";

export const attendanceQuick: HelpManual = {
  slug: "attendance-quick",
  title: "출결 모드",
  href: "/attendance/quick",
  menuKey: "attendance",
  group: "수업",
  layout: "list",
  summary:
    "강사 본인 반만, 터치 몇 번으로 끝내는 화면입니다. 관리자뷰 사이드바에는 담당 반이 있는 겸직에게만 보입니다.",
  related: ["attendance", "attendance-live", "onescreen"],
  callouts: [
    {
      n: 1,
      label: "날짜",
      zone: "toolbar",
      body: "오늘 이후는 잠깁니다. 지난 날을 열어 소급 입력할 수 있습니다.",
    },
    {
      n: 2,
      label: "반 카드",
      zone: "board",
      body: "담당 반이 세로로 쌓입니다. 카드를 열어 원생 칩을 누릅니다.",
    },
    {
      n: 3,
      label: "원생 칩",
      zone: "cell",
      body: "눌러 출석·결석·지각을 순환합니다. 월별 격자와 같은 기록이 쌓입니다.",
    },
    {
      n: 4,
      label: "원스크린으로",
      zone: "header",
      body: "수업 마감은 [[onescreen|원스크린]]에서 합니다. 출결만 빠르게 찍는 자리가 여기입니다.",
    },
  ],
};
