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
      body: "오늘 이후는 잠깁니다. 날짜 글자를 누르면 달력이 열립니다.",
    },
    {
      n: 2,
      key: "os-filters",
      label: "작성 / 멘트 / 글씨 / 보기",
      zone: "filters",
      body: "작성·보기는 상단에서, 멘트·글씨 크기·반별/가나다 정렬·이전 내용 숨기기는 설정에서 고릅니다. 정렬과 이전 내용 표시는 카드·표가 공유하고 내 계정에 저장됩니다. 발송 완료 안내의 다시 보지 않기는 이 브라우저에만 저장되며 설정에서 다시 켤 수 있습니다. 영어 행은 템플릿 모드라 수학과 칸이 다릅니다.",
    },
    {
      n: 3,
      key: "os-quick",
      label: "출결 모드",
      zone: "header",
      body: "[[attendance-quick|출결 모드]]로 갑니다. 진입 버튼은 흰색이며, 출결 모드 안의 파란 종료 버튼으로 강사 화면에 돌아옵니다.",
    },
    {
      n: 4,
      key: "os-class",
      label: "반 칩",
      zone: "toolbar",
      body: "오늘 담당 반. 인원과 위임 표시가 칩에 있습니다. 왼쪽 학생 목록도 수업별로 나뉘며, 같은 학생이 정규·특강을 들으면 두 반 아래에 각각 나옵니다. 누르면 가운데에서 그 수업이 선택됩니다. 기존 보고서 라벨의 초록색은 발송 완료, 붉은색은 수업 종료 후 미발송입니다.",
    },
    {
      n: 5,
      key: "os-row",
      label: "원생 행",
      zone: "row",
      body: "진도·오늘 과제·테스트·태도·메모. 수학은 자동 멘트, 영어는 고른 템플릿으로 글을 조립합니다. 저장이 수업보고서입니다. 표의 상세 버튼에서 카드와 같은 편집·미리보기·PDF·공유 링크 기능을 엽니다. 이전 행은 두 줄로 표시하며 마우스를 올리면 전체 내용이 보입니다.",
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
      body: "카드의 일괄 작업에서도 표와 같은 선택·일괄 입력·저장·발송을 할 수 있습니다. 저장하면 보고서가 생깁니다. 학부모 발송은 ClassNote이고, 사무실 총괄은 [[lesson-reports|수업보고서]]입니다. AI가 실패하면 글을 비우지 않습니다.",
    },
  ],
};
