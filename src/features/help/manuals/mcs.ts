import type { HelpManual } from "../types";

export const mcs: HelpManual = {
  slug: "mcs",
  title: "수학 강사 시트",
  href: "/mcs",
  menuKey: "mcs",
  group: "수업",
  layout: "sheet",
  summary:
    "수학은 원생마다 교재·진도가 달라, 표를 원생 × 수업일로 눕혀 둡니다. 보기 탭은 없고 진도표 하나입니다.",
  related: ["ecs", "onescreen", "timetable"],
  callouts: [
    {
      n: 1,
      label: "반 선택",
      zone: "header",
      body: "목록은 정규 / 특강 좌우 2단입니다. 반 이름의 ‘개별’은 인원이 아니라 ‘원생마다 제 교재’라는 뜻입니다.",
    },
    {
      n: 2,
      label: "월 이동",
      zone: "toolbar",
      body: "그 달 수업일만 열입니다. 아직 안 온 날은 빈 칸이고, 지난 날 무기록은 ‘기록 없음’입니다.",
    },
    {
      n: 3,
      label: "목표 칸 · 레일",
      zone: "filters",
      body: "이 달 목표 진도. 아래 두 줄 레일은 지금 / 목표를 같은 눈금으로 보여 길이 차가 계획 대비입니다.",
    },
    {
      n: 4,
      label: "수업일 칸",
      zone: "cell",
      body: "그날 진도와 시험(맞은 개수/전체만, % 없음). 목표 밖 교재는 네 변 테두리와 ‘목표 밖’ 칩입니다.",
    },
    {
      n: 5,
      label: "입력 없음 칩",
      zone: "toolbar",
      body: "와 놓고 안 적은 칸만 셉니다. 결석·아직 안 온 날은 작성률을 깎지 않습니다.",
    },
  ],
};
