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
      label: "엑셀 내보내기/가져오기",
      zone: "filters",
      body: "내보내기는 지금 보이는 반 목록을 엑셀로 받습니다. 가져오기는 반·시간표·반배정 서식을 받아 올리면 미리보기를 거쳐 들어갑니다(관리자 이상).",
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
      body: "반 이름·담임·학생 열 머리의 화살표로 정렬합니다. 누르면 그 열로 정렬하고, 다시 누르면 오름차순·내림차순이 바뀝니다. 고른 정렬은 계정에 남습니다.",
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
