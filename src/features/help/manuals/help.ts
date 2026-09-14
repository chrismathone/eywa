import type { HelpManual } from "../types";

export const help: HelpManual = {
  slug: "help",
  title: "도움말",
  href: "/help",
  menuKey: "help",
  group: "지원",
  layout: "list",
  summary:
    "지금 보고 있는 설명서 모음입니다. 글 속의 색 입힌 말은 다른 화면 설명서로, 오른쪽 위 ‘이 화면 열기’는 실제 화면 창으로 갑니다.",
  related: ["workspace"],
  callouts: [
    {
      n: 1,
      label: "검색",
      zone: "header",
      body: "머리의 검색 토글. 빠른 시작·설명서·자주 묻는 질문을 함께 거릅니다.",
    },
    {
      n: 2,
      label: "빠른 시작",
      zone: "board",
      body: "처음 쓰는 순서입니다. 오른쪽 링크는 실제 화면 창을 엽니다.",
    },
    {
      n: 3,
      label: "화면 설명서",
      zone: "board",
      body: "카드 제목을 누르면 그 화면의 번호 설명서입니다. ↗는 실제 화면입니다.",
    },
    {
      n: 4,
      label: "하이라이트 단어",
      zone: "cell",
      body: "본문의 [[timetable|시간표]]처럼 색이 입혀진 말은 그 설명서로 바로 갑니다. 지금 보고 있는 화면 이름은 눌러지지 않습니다.",
    },
    {
      n: 5,
      label: "아이콘 시스템",
      zone: "footer",
      body: "제품 아이콘 목록입니다. 같은 도움말 창 안에서 이동합니다.",
    },
  ],
};
