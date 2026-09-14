import type { HelpManual } from "../types";

export const timetable: HelpManual = {
  slug: "timetable",
  title: "시간표",
  href: "/timetable",
  menuKey: "timetable",
  group: "수업",
  layout: "grid",
  summary:
    "주간 시간표입니다. 여는 것은 더블클릭, 옮기는 것은 그냥 드래그, 반영은 저장입니다. 편집 모드 스위치는 없습니다.",
  related: ["classes", "students", "attendance", "ecs"],
  callouts: [
    {
      n: 1,
      label: "과목",
      zone: "toolbar",
      body: "수학·영어 등 학원설정에 있는 과목만 나옵니다. 과목을 바꾸면 교시 줄과 기본 뷰가 그 과목에 맞게 바뀝니다.",
    },
    {
      n: 2,
      label: "구분",
      zone: "toolbar",
      body: "정규 / 특강 / 전체 / **보강**. 보강 탭은 [[attendance|보강 예약]]을 요일×교시에 그려 주는 표시 전용입니다. 슬롯을 끌어 옮기거나 엑셀로 보내지 않습니다.",
    },
    {
      n: 3,
      label: "프로그램",
      zone: "toolbar",
      body: "영어일 때만 보입니다. EiE / 인재원 영어. 미분류 반은 ‘인재원 영어’ 쪽에 남습니다.",
    },
    {
      n: 4,
      label: "뷰",
      zone: "toolbar",
      body: "기본뷰(반 칸) · 통합뷰 · 강사뷰 · 교실뷰. 원생을 끌어 옮기는 것과 반 블록을 통째로 옮기는 것은 기본뷰입니다.",
    },
    {
      n: 5,
      label: "주 이동",
      zone: "toolbar",
      body: "‹ 이번 주 ›. 가운데 라벨을 누르면 이번 주로 돌아갑니다. 미래 주에는 예약해 둔 배치·반 이름이 미리 보입니다.",
    },
    {
      n: 6,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름으로 칸을 찾습니다. 해당 원생이 있는 반만 남습니다.",
    },
    {
      n: 7,
      label: "그룹 설정 · 강사 순서 · 뷰 설정",
      zone: "header",
      body: "통합뷰 줄 배치, 강사 열 순서, 원생 명단 접기·빈 교시 접기입니다. 명단을 접으면 칸 높이도 줄어듭니다. 보기 설정은 계정에 저장됩니다.",
    },
    {
      n: 8,
      label: "엑셀 · 시트",
      zone: "header",
      body: "정규 시간표만 내보내고 가져옵니다. 구분을 특강·보강으로 두면 버튼이 잠깁니다. 가져오기는 적용일을 고르고, 충돌 체크리스트를 통과해야 반영됩니다.",
    },
    {
      n: 9,
      label: "반 블록",
      zone: "board",
      body: "보이는 칸 통째가 한 블록입니다. 더블클릭하면 반 창이 열리고, 그냥 끌면 갈 수 있는 칸만 남고 막힌 칸은 붉은 빗금입니다. 저장을 눌러야 반영됩니다.",
    },
    {
      n: 10,
      label: "원생 줄",
      zone: "row",
      body: "더블클릭하면 [[student-detail|원생 상세]]가 열립니다. 끌어 다른 반으로 옮깁니다. 등원 요일은 **우클릭**으로 고칩니다. Delete는 오늘 수강 종료(권한 있는 사람만).",
    },
    {
      n: 11,
      label: "보강 줄",
      zone: "cell",
      body: "기본뷰 반 칸 아래, 대기·퇴원과 같은 자리에 그날 [[attendance|보강 예약]] 원생이 옅은 보라 줄로 섭니다. 마우스를 올리면 보강 정보가 나옵니다.",
    },
    {
      n: 12,
      label: "저장 바",
      zone: "footer",
      body: "옮긴 것이 있을 때만 아래에 섭니다. 적용일은 화면이 보여 주는 그 주와 같습니다. 이미 찍힌 출결이 있는 시각으로는 옮기지 못합니다.",
    },
  ],
};
