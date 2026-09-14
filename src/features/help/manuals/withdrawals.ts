import type { HelpManual } from "../types";

export const withdrawals: HelpManual = {
  slug: "withdrawals",
  title: "퇴원관리",
  href: "/withdrawals",
  menuKey: "withdrawals",
  group: "원생",
  layout: "list",
  summary: "퇴원 처리와 사유 통계입니다. 한 과목만 끝난 원생은 ‘수강종료’로 그 과목만 퇴원입니다.",
  related: ["students", "dashboard", "retention"],
  callouts: [
    {
      n: 1,
      label: "유형",
      zone: "filters",
      body: "퇴원 / 수강종료. 수강종료는 그 과목 수강이 오늘 기준으로 실제로 끝났을 때만 섭니다.",
    },
    {
      n: 2,
      label: "기간 · 사유 · 과목",
      zone: "filters",
      body: "이번 달 기본. 과목은 학원설정입니다. 상담 유무로도 좁힐 수 있습니다.",
    },
    {
      n: 3,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름. 눌러야 나옵니다.",
    },
    {
      n: 4,
      label: "추이 · 분포",
      zone: "board",
      body: "월별 퇴원 수와 과목별 분포입니다. [[dashboard|대시보드]] 퇴원생 카드와 같은 이번 달 기준입니다.",
    },
    {
      n: 5,
      label: "명단 행",
      zone: "row",
      body: "누르면 그 원생의 퇴원 상세입니다. 재원으로 되돌릴 수 있습니다(사무실만).",
    },
  ],
};
