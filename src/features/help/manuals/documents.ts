import type { HelpManual } from "../types";

export const documents: HelpManual = {
  slug: "documents",
  title: "데이터베이스",
  href: "/documents",
  menuKey: "documents",
  group: "지원",
  layout: "list",
  summary: "학원 서식 저장소입니다. 왼쪽 폴더, 오른쪽 파일. 작성된 이력서·환불요청서도 함께 보관합니다.",
  related: ["staff", "billing"],
  callouts: [
    {
      n: 1,
      label: "폴더",
      zone: "filters",
      body: "왼쪽 탐색기. 누르면 그 폴더의 양식만 남습니다.",
    },
    {
      n: 2,
      label: "검색",
      zone: "toolbar",
      body: "파일 이름. 눌러야 나옵니다.",
    },
    {
      n: 3,
      label: "올리기",
      zone: "header",
      body: "양식 파일을 폴더에 넣습니다.",
    },
    {
      n: 4,
      label: "파일 행",
      zone: "row",
      body: "내려받기 · 미리보기. 연결된 작성 문서(이력서 등)는 따로 표시됩니다.",
    },
  ],
};
