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
      body: "화살표로 하위 폴더를 펼치고, 이름을 누르면 해당 폴더의 문서와 하위 폴더가 보입니다. 상단 경로를 눌러 상위 폴더로 바로 이동합니다. 긴 경로는 가운데를 …로 줄이며, …를 누르면 생략된 상위 폴더를 선택할 수 있습니다. 왼쪽 문서 수에는 하위 폴더의 문서도 포함됩니다.",
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
    {
      n: 5,
      label: "폴더 관리",
      zone: "filters",
      body: "폴더 안에서 '하위 폴더 만들기'를 눌러 여러 단계로 정리하세요. '폴더 관리'에서 이름·위치·같은 상위 폴더 안의 순서를 바꿀 수 있습니다. 폴더를 옮기면 하위 폴더와 문서도 따라갑니다. 삭제하려면 하위 폴더를 먼저 정리하고 문서를 옮길 폴더를 선택하세요. 기본 폴더는 삭제할 수 없습니다.",
    },
  ],
};
