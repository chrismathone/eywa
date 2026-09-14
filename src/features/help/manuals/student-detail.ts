import type { HelpManual } from "../types";

export const studentDetail: HelpManual = {
  slug: "student-detail",
  title: "원생 상세",
  href: "/students",
  menuKey: "students",
  group: "원생",
  layout: "list",
  summary:
    "한 원생의 수강·출결·성적·상담·수납을 탭으로 봅니다. 강사는 담당 원생만 열 수 있고, 등록·수정·퇴원은 사무실만 합니다.",
  related: ["students", "attendance", "consultations", "exams", "billing"],
  callouts: [
    {
      n: 1,
      label: "원생 수정",
      zone: "header",
      body: "이름·학교·연락처 등 기록을 고칩니다. 강사에게는 없습니다. 학교는 저장할 때 ‘○○초’처럼 짧게 맞춰집니다.",
    },
    {
      n: 2,
      label: "반 배정",
      zone: "header",
      body: "수강 반을 넣거나 옮기거나 끝냅니다. [[timetable|시간표]]에서 끌어 옮기는 것과 같은 수강 기록입니다.",
    },
    {
      n: 3,
      label: "탭",
      zone: "toolbar",
      body: "기본 정보 · 출결 · 성적 · 상담 · 수납 · 타임라인. 출결 탭에는 앞으로의 [[attendance|보강 예약]] 목록도 있습니다.",
    },
    {
      n: 4,
      label: "상담 기록",
      zone: "board",
      body: "이 원생의 [[consultations|원생상담]]과 연결된 [[enrollment|콜&상담]]이 함께 보입니다.",
    },
    {
      n: 5,
      label: "퇴원 / 휴원",
      zone: "footer",
      body: "사무실만. 퇴원하면 [[withdrawals|퇴원관리]]에 쌓이고, 재원으로 되돌릴 수 있습니다. 강사는 이 버튼을 볼 수 없습니다.",
    },
  ],
};
