import type { HelpManual } from "../types";

export const withdrawals: HelpManual = {
  slug: "withdrawals",
  title: "퇴원관리",
  href: "/withdrawals",
  menuKey: "withdrawals",
  group: "원생",
  layout: "list",
  summary: "퇴원 처리와 사유 통계입니다. 한 과목만 끝난 원생(‘수강종료’)도 라벨을 달고 같은 목록에 섭니다.",
  related: ["students", "dashboard", "retention"],
  callouts: [
    {
      n: 1,
      label: "유형",
      zone: "filters",
      body: "전체(기본) / 퇴원 / 수강종료. 수강종료는 그 과목 수강이 오늘 기준으로 실제로 끝났을 때만 섭니다.",
    },
    {
      n: 2,
      label: "기간 · 사유 · 과목",
      zone: "filters",
      body: "기간은 ‘직접 지정’으로 시작일·종료일을 고를 수 있습니다. 과목은 학원설정입니다. 사유는 퇴원·수강종료 둘 다(수강종료는 그 과목 수강의 종료 사유), 상담은 퇴원에만 있어 고르면 수강종료는 빠집니다.",
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
      body: "월별 퇴원 수와 분포입니다. 분포는 과목·강사·학년·학교로 바꿔 볼 수 있고, 칸을 누르면 아래 명단이 그 값으로 걸러집니다. 사유 막대도 눌러 명단을 볼 수 있습니다. [[dashboard|대시보드]] 퇴원생 카드와 같은 이번 달 기준입니다.",
    },
    {
      n: 5,
      label: "명단 행",
      zone: "row",
      body: "누르면 그 원생의 퇴원 상세입니다. 재원으로 되돌릴 수 있습니다(사무실만).",
    },
  ],
};
