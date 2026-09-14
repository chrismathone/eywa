import type { HelpManual } from "../types";

export const students: HelpManual = {
  slug: "students",
  title: "원생목록",
  href: "/students",
  menuKey: "students",
  group: "원생",
  layout: "list",
  summary:
    "재원 원생을 찾고 상세로 들어가는 표입니다. 열 머리 라벨이 곧 필터입니다. 결과가 0명이어도 표 머리는 남습니다 — 치우면 걸린 필터를 되돌릴 자리가 없습니다.",
  related: ["student-detail", "classes", "enrollment", "withdrawals"],
  callouts: [
    {
      n: 1,
      label: "새 원생",
      zone: "header",
      body: "한 명을 등록합니다. 강사는 열람만 할 수 있어 이 버튼이 없습니다. 이름은 학교·학년과 함께 자연키라, 재원 중인 동명이인(같은 학교·학년)은 막힙니다.",
    },
    {
      n: 2,
      label: "엑셀",
      zone: "header",
      body: "내보내기 · 가져오기. 먼저 내보내 그 서식대로 고친 뒤 올립니다. 가져오기도 원생 기록이 바뀌는 일이라 강사에게는 없습니다.",
    },
    {
      n: 3,
      label: "미수강 제외",
      zone: "toolbar",
      body: "지금 아무 반에도 안 들어 있는 재원생을 표에서 뺍니다. 상태=퇴원에서는 숨습니다 — 퇴원생은 활성 수강이 없어 켜 두면 전원이 사라집니다.",
    },
    {
      n: 4,
      label: "검색",
      zone: "toolbar",
      body: "눌러야 입력창이 나옵니다. 펼치면 앞에서 이름·학교·전화·주소·이메일·메모 중 어디를 찾을지 고릅니다.",
    },
    {
      n: 5,
      label: "학년 · 정렬",
      zone: "filters",
      body: "이름 열 머리. ‘학년: 중1’처럼 축 이름이 라벨입니다. ‘전체’도 주소에 명시됩니다 — 안 그러면 저장값이 되살아나 전체를 못 고릅니다.",
    },
    {
      n: 6,
      label: "상태",
      zone: "filters",
      body: "기본은 재원. 예비·상담 / 휴원 / 퇴원 / 전체. 상태는 저장하지 않습니다.",
    },
    {
      n: 7,
      label: "수강 과목",
      zone: "filters",
      body: "학원설정 과목만. 강사는 담당 과목으로 선택지가 좁아집니다.",
    },
    {
      n: 8,
      label: "담당 강사",
      zone: "filters",
      body: "담임으로 좁힙니다. 선택지 이름도 학원 직원입니다.",
    },
    {
      n: 9,
      label: "원생 행",
      zone: "row",
      body: "누르면 [[student-detail|원생 상세]] 창이 열립니다. 학교·학년은 ‘경명여중1’처럼 붙여 적습니다.",
    },
  ],
};
