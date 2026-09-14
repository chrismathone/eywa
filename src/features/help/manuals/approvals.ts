import type { HelpManual } from "../types";

export const approvals: HelpManual = {
  slug: "approvals",
  title: "전자결재",
  href: "/approvals",
  menuKey: "approvals",
  group: "지원",
  layout: "list",
  summary: "기안 → 순차 결재선 → 함. 양식은 휴가·품의·지출·수입입니다. 연차 **일수 조정**은 [[staff|직원관리]]의 연차 관리입니다.",
  related: ["staff", "expense-requests"],
  callouts: [
    {
      n: 1,
      label: "기안하기",
      zone: "header",
      body: "양식을 고르고 결재선을 만듭니다. 자주 쓰는 결재선을 불러올 수 있습니다. 잔여 연차가 부족하면 휴가 기안 자체가 거절됩니다.",
    },
    {
      n: 2,
      label: "결재함",
      zone: "toolbar",
      body: "대기 · 예정 · 진행 · 완료 · 반려 · 참조. 내 차례만 대기함에 있습니다.",
    },
    {
      n: 3,
      label: "문서 행",
      zone: "row",
      body: "누르면 본문과 결재란입니다. 승인·반려·전결·후결·대결은 내 칸일 때만입니다.",
    },
    {
      n: 4,
      label: "회수",
      zone: "footer",
      body: "아무도 결재하지 않았을 때만 기안자가 회수합니다.",
    },
  ],
};
