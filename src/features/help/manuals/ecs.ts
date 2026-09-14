import type { HelpManual } from "../types";

export const ecs: HelpManual = {
  slug: "ecs",
  title: "영어 강사 시트",
  href: "/ecs",
  menuKey: "ecs",
  group: "수업",
  layout: "sheet",
  summary:
    "영어 반별 주간 수업계획과 출결입니다. 사이드바는 ‘강사 시트’ 한 줄이고, 영어가 기본 착지입니다. 수학은 [[mcs|수학 강사 시트]]입니다.",
  related: ["mcs", "timetable", "onescreen", "attendance-seat"],
  callouts: [
    {
      n: 1,
      label: "영어 / 수학",
      zone: "header",
      body: "하부탭. 수학은 별도 창·별도 권한입니다.",
    },
    {
      n: 2,
      label: "주 이동",
      zone: "toolbar",
      body: "그 주에 수업이 있는 반만 목록에 섭니다. 아직 시작 안 한 반은 미래 주에만 나타납니다.",
    },
    {
      n: 3,
      label: "EiE / 인재원 영어",
      zone: "board",
      body: "목록이 좌우 2단입니다. EiE만 Shouting 칸이 있고, 인재원 영어는 그 칸이 비어 폭만 맞춥니다. 좁으면 위아래로 쌓입니다.",
    },
    {
      n: 4,
      label: "작성률",
      zone: "cell",
      body: "그 주 배정 교시 대비 계획을 적은 비율입니다. 휴일에 안 쓰면 분모에서 빼고, 쓰면 한 일로 셉니다.",
    },
    {
      n: 5,
      label: "달력",
      zone: "header",
      body: "반 카드의 달력 링크. EiE는 월간 계획서(MP), 인재원 영어는 달력 보기입니다.",
    },
    {
      n: 6,
      label: "주간 시트 칸",
      zone: "board",
      body: "교재·페이지·진도·과제·특이사항. 특이사항은 포커스하면 스티커처럼 커집니다. 출결도 같은 카드에서 찍습니다.",
    },
    {
      n: 7,
      label: "목표",
      zone: "footer",
      body: "담임/부담임 주간·월간 목표. 월간에서 고치면 주간에도 바로 보입니다.",
    },
  ],
};
