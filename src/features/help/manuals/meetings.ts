import type { HelpManual } from "../types";

export const meetings: HelpManual = {
  slug: "meetings",
  title: "회의록",
  href: "/meetings",
  menuKey: "meetings",
  group: "지원",
  layout: "list",
  summary: "회의를 녹음하면 글로 옮기고, AI가 안건·결정·할 일로 정리합니다. 다시 분석은 저장된 전사만으로도 됩니다.",
  related: ["consultations", "enrollment"],
  callouts: [
    {
      n: 1,
      label: "새 회의록",
      zone: "header",
      body: "제목·참석·녹음을 올립니다. 올리면 전사가 시작되고 상태가 ‘전사 중’ → ‘분석 중’ → ‘완료’로 바뀝니다.",
    },
    {
      n: 2,
      label: "기간 · 상태",
      zone: "filters",
      body: "완료/실패/처리 중으로 좁힙니다.",
    },
    {
      n: 3,
      label: "검색",
      zone: "toolbar",
      body: "제목·요약. 목록 미리보기는 AI 요약이 있으면 그 글입니다.",
    },
    {
      n: 4,
      label: "회의 행",
      zone: "row",
      body: "제목 | 요약 | 상태·녹음·참석·작성자·일시. 누르면 상세입니다.",
    },
    {
      n: 5,
      label: "AI로 정리",
      zone: "header",
      body: "상세 머리의 Primary. 저장된 전사로 8섹션을 다시 만듭니다. 오디오가 없어도 됩니다.",
    },
    {
      n: 6,
      label: "더보기",
      zone: "header",
      body: "인쇄 · TXT · 전사부터 다시 · 삭제. 전사 재제출과 삭제는 그 자리 확인을 한 번 더 받습니다.",
    },
    {
      n: 7,
      label: "화자 편집",
      zone: "board",
      body: "화자 A/B를 직원 드롭다운에 연결합니다. AI가 틀려도 사람이 고치면 이후 업무 연계의 기준이 됩니다.",
    },
  ],
};
