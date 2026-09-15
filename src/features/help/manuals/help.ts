import type { HelpManual } from "../types";

export const help: HelpManual = {
  slug: "help",
  title: "도움말",
  href: "/help",
  menuKey: "help",
  group: "지원",
  layout: "list",
  summary:
    "화면별 설명서 목록과 자주 묻는 질문, 질문 게시판입니다. 화면을 보는 중이라면 어느 화면에서든 F1을 누르면 같은 설명이 그 위에 겹칩니다.",
  related: ["workspace"],
  callouts: [
    {
      n: 1,
      key: "help-search",
      label: "검색",
      zone: "header",
      body: "머리의 검색 토글. **한 칸이 셋을 함께 거릅니다** — 화면 설명서·자주 묻는 질문·질문 게시판.",
    },
    {
      n: 2,
      key: "help-f1",
      label: "F1 화면 도움말",
      zone: "header",
      body: "어느 화면에서든 **F1**을 누르면 그 화면 위에 번호 설명이 겹칩니다. 다시 F1 · Esc · 빈 곳 클릭으로 닫습니다.",
    },
    {
      n: 3,
      key: "help-guides",
      label: "화면 설명서",
      zone: "board",
      body: "업무군별 화면 목록입니다. 제목을 누르면 그 화면의 번호 설명서로, ↗는 실제 화면 창으로 갑니다.",
    },
    {
      n: 4,
      key: "help-faq",
      label: "자주 묻는 질문",
      zone: "board",
      body: "자주 쓰는 물음입니다. 본문의 화면 이름을 누르면 그 화면의 설명서로 갑니다(실제 화면은 목록의 ↗).",
    },
    {
      n: 5,
      key: "help-board",
      label: "질문 게시판",
      zone: "board",
      body: "도움말 메뉴에 들어올 수 있으면 질문을 올립니다. 자기 글만 고치거나 지울 수 있고, 답변은 원장·관리자가 답니다.",
    },
    {
      n: 6,
      key: "help-icons",
      label: "아이콘 시스템",
      zone: "footer",
      body: "제품 아이콘 목록입니다. 같은 도움말 창 안에서 이동합니다.",
    },
  ],
};
