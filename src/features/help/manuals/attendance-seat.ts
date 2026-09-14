import type { HelpManual } from "../types";

export const attendanceSeat: HelpManual = {
  slug: "attendance-seat",
  title: "자리 출석부 (랩실·JJ실)",
  href: "/attendance/seat/lab",
  menuKey: "seat_attendance",
  group: "수업",
  layout: "sheet",
  summary:
    "사이드바 항목이 아닙니다. [[attendance|출석부]] 강사 드롭다운에서 LAB·JJ를 고릅니다. 그날 그 자리 명단만 출석·결석·지각 3종으로 찍습니다. 보강 추가는 여기 없습니다.",
  related: ["attendance", "ecs", "timetable"],
  callouts: [
    {
      n: 1,
      label: "자리 선택",
      zone: "toolbar",
      body: "랩실 / JJ실. 주소의 자리 이름이 라벨입니다.",
    },
    {
      n: 2,
      label: "교시 칩",
      zone: "filters",
      body: "한 교시만 보거나 하루 전체를 봅니다. 원생을 다른 교시로 끌면 **다른 시간**으로만 옮겨집니다. 같은 시간은 의미가 없어 아무 일도 없습니다.",
    },
    {
      n: 3,
      label: "출결 칩",
      zone: "cell",
      body: "출석·결석·지각. 결석 사유는 마우스 오버로만 보입니다. 보강 상태는 이 화면에 섞지 않습니다.",
    },
    {
      n: 4,
      label: "JJ 진도",
      zone: "board",
      body: "JJ실은 [[ecs|영어 강사 시트]]와 같은 계획 칸입니다. 권한도 ECS와 같습니다. 랩실·공개 PIN에는 진도가 없습니다.",
    },
    {
      n: 5,
      label: "드래그 빗금",
      zone: "cell",
      body: "그 반의 다른 수업 시각, 그 원생의 다른 수업 시각은 붉은 빗금입니다. 놓을 수 없는 이유 문구가 같습니다.",
    },
  ],
};
