import type { HelpManual } from "../types";

export const onescreen: HelpManual = {
  slug: "onescreen",
  title: "선생님 원스크린",
  href: "/onescreen",
  menuKey: "teacher_onescreen",
  group: "수업",
  layout: "sheet",
  summary:
    "강사가 매일 쓰는 수업 마감 화면입니다. 오늘 담당 반 원생이 한 화면에 나와, 진도·테스트·태도를 적고 저장하면 수업보고서가 됩니다. 관리자뷰에서는 이 화면이 열리지 않습니다.",
  related: ["lesson-reports", "attendance", "ecs", "mcs"],
  callouts: [
    {
      n: 1,
      key: "os-date",
      label: "날짜",
      zone: "toolbar",
      body: "오늘 이후는 잠깁니다. 달력 버튼으로 지난 날을 엽니다.",
    },
    {
      n: 2,
      key: "os-filters",
      label: "작성 / 멘트 / 글씨 / 보기",
      zone: "filters",
      body: "작성할 반·멘트 톤·글자 크기·화면 밀도입니다. 영어 행은 템플릿 모드라 수학과 칸이 다릅니다.",
    },
    {
      n: 3,
      key: "os-quick",
      label: "출결 모드",
      zone: "header",
      body: "[[attendance-quick|출결 모드]]로 갑니다. 출결만 빠르게 찍고 돌아올 때 씁니다.",
    },
    {
      n: 4,
      key: "os-class",
      label: "반 칩",
      zone: "toolbar",
      body: "오늘 담당 반. 인원과 위임 표시가 칩에 있습니다. 드롭다운으로 접지 않습니다.",
    },
    {
      n: 5,
      key: "os-row",
      label: "원생 행",
      zone: "row",
      body: "진도·오늘 과제·테스트·태도·메모. 수학은 자동 멘트, 영어는 고른 템플릿으로 글을 조립합니다. 저장이 수업보고서입니다.",
    },
    {
      n: 6,
      key: "os-makeup",
      label: "보강 행",
      zone: "row",
      body: "오늘 [[attendance|보강 예약]]이 있는 원생은 반이 오늘 안 돌아도 이름만 섭니다. 출결을 찍으면 예약이 이행됩니다.",
    },
    {
      n: 7,
      key: "os-save",
      label: "저장 · 발송",
      zone: "footer",
      body: "저장하면 보고서가 생깁니다. 학부모 발송은 ClassNote이고, 사무실 총괄은 [[lesson-reports|수업보고서]]입니다. AI가 실패하면 글을 비우지 않습니다.",
    },
  ],
};
