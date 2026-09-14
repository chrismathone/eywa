import type { HelpManual } from "../types";

export const textbookRequests: HelpManual = {
  slug: "textbook-requests",
  title: "교재 요청",
  href: "/textbook-requests",
  menuKey: "textbook_requests",
  group: "운영",
  layout: "list",
  summary:
    "강사 미니셸 ‘내 메뉴’ 전용입니다. 담당 원생의 교재를 신청하고 진행(신청→주문→납부)을 봅니다. 사무실 처리는 [[billing|수납관리]] 교재 면입니다.",
  related: ["billing", "onescreen"],
  callouts: [
    {
      n: 1,
      label: "원생 · 교재 고르기",
      zone: "board",
      body: "왼쪽 폼. 담당 원생만 선택지에 있습니다.",
    },
    {
      n: 2,
      label: "미리보기",
      zone: "board",
      body: "오른쪽 요청서. 적는 대로 바로 보입니다.",
    },
    {
      n: 3,
      label: "보내기",
      zone: "footer",
      body: "사무실 교재 큐로 올라갑니다. 상태는 신청→주문→납부입니다.",
    },
  ],
};
