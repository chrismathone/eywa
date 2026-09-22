import type { HelpManual } from "../types";

export const exams: HelpManual = {
  slug: "exams",
  title: "성적관리",
  href: "/exams",
  menuKey: "exams",
  group: "원생",
  layout: "list",
  summary: "시험을 만들고 반별로 점수를 한 번에 넣으면 평균·석차가 계산됩니다. 영어 JJ실은 인재원 학습 데이터를 끌어 봅니다.",
  related: ["students", "classes", "onescreen"],
  callouts: [
    {
      n: 1,
      label: "새 시험",
      zone: "header",
      body: "과목·날짜·만점·응시 반을 정합니다. 과목 선택지는 학원설정입니다.",
    },
    {
      n: 2,
      label: "과목 · 기간",
      zone: "filters",
      body: "목록을 좁힙니다.",
    },
    {
      n: 3,
      label: "시험 행",
      zone: "row",
      body: "누르면 반별 점수 격자입니다. 한 칸에 점수를 넣고 이동하면 평균·석차가 다시 계산됩니다.",
    },
    {
      n: 4,
      label: "JJ실 칩",
      zone: "toolbar",
      body: "인재원 연동이 켜져 있을 때만 보입니다. aywa 반으로 묶여 있고, 인재원 반 이름은 묶는 키가 아닙니다. 짝이 없는 원생은 상세에서 잇습니다.",
    },
  ],
};
