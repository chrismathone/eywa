import type { HelpManual } from "../types";

export const retention: HelpManual = {
  slug: "retention",
  title: "이탈 방어",
  href: "/retention",
  menuKey: "retention",
  group: "원생",
  layout: "list",
  summary:
    "출결·성적·상담·수납을 종합해 흔들리는 재원생을 찾습니다. [[newcomers|신규생 관리]]는 ‘들어온 지 얼마 안 된 절차’이고, 이쪽은 ‘지금 흔들리는 재원생’입니다.",
  related: ["consultations", "attendance", "withdrawals", "newcomers"],
  callouts: [
    {
      n: 1,
      label: "오늘 챙길 원생",
      zone: "board",
      body: "위험 신호가 있는 원생이 위에 섭니다. 사전 통보로 설명되는 결석은 이 목록에서 뺍니다. ‘N회’ 숫자 자체는 깎지 않습니다.",
    },
    {
      n: 2,
      label: "보드 · 캠페인 · 메시지",
      zone: "header",
      body: "면 전환. 보드가 기본입니다.",
    },
    {
      n: 3,
      label: "원생 카드",
      zone: "row",
      body: "누르면 [[student-detail|원생 상세]] 또는 [[consultations|원생상담]]으로 이어집니다. 다음 행동(콜·상담)이 카드에 적혀 있습니다.",
    },
  ],
};
