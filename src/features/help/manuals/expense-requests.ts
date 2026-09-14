import type { HelpManual } from "../types";

export const expenseRequests: HelpManual = {
  slug: "expense-requests",
  title: "지출결의서",
  href: "/expense-requests",
  menuKey: "expense_requests",
  group: "운영",
  layout: "list",
  summary:
    "강사가 본인 지출을 올리는 자리입니다. 사이드바에는 없고 강사 ‘내 메뉴’입니다. 사무실 전건 결재는 [[billing|수납관리]] 지출 면입니다.",
  related: ["billing", "approvals"],
  callouts: [
    {
      n: 1,
      label: "새 결의서",
      zone: "header",
      body: "금액·사유·영수증을 올립니다.",
    },
    {
      n: 2,
      label: "내 목록",
      zone: "row",
      body: "진행 상태. 누르면 문서입니다.",
    },
    {
      n: 3,
      label: "결재",
      zone: "board",
      body: "강사는 여기서 올리고, 결재 흐름은 사무실 지출 면(또는 [[approvals|전자결재]])입니다.",
    },
  ],
};
