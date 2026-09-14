import type { HelpManual } from "../types";

export const classes: HelpManual = {
  slug: "classes",
  title: "수업목록",
  href: "/classes",
  menuKey: "classes",
  group: "수업",
  layout: "list",
  summary: "반을 만들고 수정합니다. 열 머리가 필터입니다. 보기(표/카드)만 결과 줄에 남습니다.",
  related: ["timetable", "students", "owner"],
  callouts: [
    {
      n: 1,
      label: "새 반",
      zone: "header",
      body: "과목·담임·요일·교시·강의실을 정합니다. 과목·학년 선택지는 [[owner|학원 설정]]에서 옵니다.",
    },
    {
      n: 2,
      label: "강의실 자동배정",
      zone: "header",
      body: "비어 있는 방에 반을 넣습니다. 미리보기를 확인한 뒤 반영합니다.",
    },
    {
      n: 3,
      label: "과목",
      zone: "filters",
      body: "열 머리 필터. 학원설정에 없는 과목은 선택지에 없습니다.",
    },
    {
      n: 4,
      label: "반 이름 · 정렬",
      zone: "filters",
      body: "이름 검색과 수업명순 등 정렬이 이 열에 있습니다.",
    },
    {
      n: 5,
      label: "담임",
      zone: "filters",
      body: "그 반의 담임 강사. 영어 반은 한국인 강사 중 가장 많이 들어가는 사람이 담임인 경우가 많습니다.",
    },
    {
      n: 6,
      label: "요일",
      zone: "filters",
      body: "월·수처럼 **여러 요일을 함께** 고를 수 있습니다. 전체는 ‘요일: 전체’입니다.",
    },
    {
      n: 7,
      label: "상태",
      zone: "filters",
      body: "기본은 운영. 전체를 보려면 상태를 바꿉니다. 이 필터는 저장하지 않습니다.",
    },
    {
      n: 8,
      label: "보기: 표 | 카드",
      zone: "toolbar",
      body: "결과 줄의 라벨 하나입니다. 카드 보기에도 같은 열 머리 필터가 한 줄로 섭니다.",
    },
    {
      n: 9,
      label: "검색",
      zone: "toolbar",
      body: "눌러야 나옵니다. 반 이름·메모를 찾습니다.",
    },
    {
      n: 10,
      label: "반 행",
      zone: "row",
      body: "누르면 반 상세(명단·시간표·보고서 설정)가 열립니다.",
    },
  ],
};
