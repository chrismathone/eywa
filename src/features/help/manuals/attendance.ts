import type { HelpManual } from "../types";

export const attendance: HelpManual = {
  slug: "attendance",
  title: "출석부",
  href: "/attendance",
  menuKey: "attendance",
  group: "수업",
  layout: "grid",
  summary:
    "메뉴의 기본 착지는 월별 출석부입니다. 원생 × 날짜 격자에서 출석·결석·지각·조퇴·보강을 찍고, 우클릭으로 보강·보강 예약을 잡습니다.",
  related: ["attendance-live", "attendance-quick", "attendance-seat", "timetable", "onescreen"],
  callouts: [
    {
      n: 1,
      key: "att-faces",
      label: "오늘 출결 · 출결 모드 · 월별",
      zone: "header",
      body: "같은 출석부 창 안의 면입니다. [[attendance-live|오늘 출결]]은 그날 좌석표, [[attendance-quick|출결 모드]]는 강사 본인 반을 터치로 찍는 화면입니다. 사이드바 부모를 누르면 항상 월별로 옵니다.",
    },
    {
      n: 2,
      key: "att-month",
      label: "월 이동",
      zone: "toolbar",
      body: "‹ 2026년 9월 ›. 가운데를 누르면 이번 달입니다. 학원 세션(월~금 각 4회)이 있으면 그 기간으로 볼 수도 있습니다.",
    },
    {
      n: 3,
      key: "att-view",
      label: "보기",
      zone: "toolbar",
      body: "반별 / 강사 전체. 강사 보기는 그 강사가 수업하는 날·교시 출결만 보이고, 다른 날은 빈칸으로 잠깁니다. 수업하는 날 칸은 자유롭게 고칠 수 있고, 다른 선생님 기록은 바뀌지 않습니다. 강사 계정은 반별 보기도 같은 기준입니다.",
    },
    {
      n: 4,
      key: "att-filters",
      label: "과목 · 정렬 · 기간",
      zone: "filters",
      body: "학원설정 과목만 선택지에 있습니다. 기간은 세션 또는 달력월입니다.",
    },
    {
      n: 5,
      key: "att-search",
      label: "검색",
      zone: "toolbar",
      body: "원생 이름. 검색어가 있으면 입력창이 펼쳐진 채입니다. 숫자(합계)도 검색된 원생 기준입니다.",
    },
    {
      n: 6,
      key: "att-cell",
      label: "출결 칸",
      zone: "cell",
      body: "클릭하면 출석·결석·지각·조퇴·보강이 돌아갑니다. **우클릭**하면 보강 추가·보강 예약입니다. 수학은 새 칸의 시수가 그날 수업 길이로 자동(교시 하나 0.5)이고, 이미 친 숫자는 그대로입니다. 영어는 자동 시수가 없습니다.",
    },
    {
      n: 7,
      key: "att-cell-menu",
      label: "우클릭 메뉴",
      zone: "cell",
      body: "보강 추가, **보강 예약**. 예약은 결석할 날의 칸에서 보강 날짜·교시(학원설정 교시표만)를 고릅니다. 결석 칸에 메모가 자동으로 적히고, 보강 날짜 칸에는 ‘보강 예약’ 네 글자가 사분면으로 섭니다.",
    },
    {
      n: 8,
      key: "att-reserve",
      label: "보강 예약 표시",
      zone: "board",
      body: "아직 보강 전이라 시수는 없습니다. 보강 날에 출석을 찍으면 예약이 이행되고 시수가 자동으로 붙습니다(빈 칸만). 취소는 예약 행을 지웁니다.",
    },
    {
      n: 9,
      key: "att-totals",
      label: "합계 줄",
      zone: "footer",
      body: "그 반·그 달의 출석 시수 합입니다. 강사 보기면 그 강사 교시 몫만 셉니다.",
    },
  ],
  faces: [
    {
      title: "오늘 출결",
      summary: "그날 반별 좌석표. 자세한 번호는 [[attendance-live|오늘 출결]] 설명서.",
      callouts: [],
    },
    {
      title: "출결 모드",
      summary: "강사 본인 반만, 터치 몇 번. 자세한 번호는 [[attendance-quick|출결 모드]] 설명서.",
      callouts: [],
    },
    {
      title: "랩실·JJ실",
      summary: "자리 출석부는 사이드바가 아니라 강사 드롭다운의 LAB·JJ. [[attendance-seat|자리 출석부]] 설명서.",
      callouts: [],
    },
  ],
};
