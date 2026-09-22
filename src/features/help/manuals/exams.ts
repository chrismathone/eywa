import type { HelpManual } from "../types";

export const exams: HelpManual = {
  slug: "exams",
  title: "성적관리",
  href: "/exams",
  menuKey: "exams",
  group: "원생",
  layout: "list",
  summary:
    "년도·학기·과목·반·시험을 고르면 그 반 명단이 뜨고 점수를 바로 적습니다. 시험을 따로 등록하지 않습니다. 영어 JJ실은 인재원 학습 데이터를 끌어 봅니다.",
  related: ["students", "classes", "onescreen"],
  callouts: [
    {
      n: 1,
      label: "년도 · 학기",
      zone: "toolbar",
      body: "학교 학기(1학기·2학기)입니다. 2학기는 9월에 시작해 이듬해 2월에 끝나므로, 1·2월에 열면 전년도 2학기가 기본입니다.",
    },
    {
      n: 2,
      label: "과목 · 반",
      zone: "toolbar",
      body: "과목 선택지는 학원설정입니다. 영어는 인재원 영어와 EiE로 갈라 반을 고르지만, 저장되는 성적은 영어 하나입니다(학생 상세에서도 영어로 모입니다).",
    },
    {
      n: 3,
      label: "시험",
      zone: "toolbar",
      body: "수학은 중간고사·기말고사, 영어는 듣기평가·중간고사·기말고사입니다. 한 학생의 같은 시험 칸은 하나라, 다시 적으면 덮어씁니다.",
    },
    {
      n: 4,
      label: "점수 격자",
      zone: "row",
      body: "명단을 따라 점수를 내려 적고 저장합니다. 엑셀로 내려받아 채운 뒤 올려도 되고, 그때 빈 칸은 건드리지 않습니다.",
    },
    {
      n: 5,
      label: "JJ실 칩",
      zone: "toolbar",
      body: "인재원 연동이 켜져 있을 때만 보입니다. aywa 반으로 묶여 있고, 인재원 반 이름은 묶는 키가 아닙니다. 짝이 없는 원생은 상세에서 잇습니다.",
    },
  ],
};
