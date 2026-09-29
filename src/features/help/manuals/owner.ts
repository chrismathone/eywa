import type { HelpManual } from "../types";

export const owner: HelpManual = {
  slug: "owner",
  title: "학원 설정",
  href: "/owner",
  menuKey: "owner",
  group: "지원",
  layout: "list",
  summary: "원장 전용입니다. 과목·학년·교시·브랜드·권한·연동이 여기 한곳에 있고, 저장한 값은 실제 화면 선택지에 바로 반영되어야 합니다.",
  related: ["workspace", "staff", "timetable"],
  callouts: [
    {
      n: 1,
      label: "프로필·브랜드",
      zone: "header",
      body: "학원 이름, 로고 글자, 브랜드 색. 색이 버튼·강조색이 됩니다.",
    },
    {
      n: 2,
      label: "운영 체계 · 과목 운영",
      zone: "toolbar",
      body: "학년·직급·평일/주말 교시·공휴일, 그리고 과목 이름·색·과목별 교시. 과목 키는 학원장이 안 만집니다. 지울 때는 다른 과목에 흡수합니다.",
    },
    {
      n: 3,
      label: "수납·청구 · 알림·약관 · 상담 양식",
      zone: "toolbar",
      body: "청구 마감일, 알림톡 발신, 공개 접수 약관, 상담 폼 항목입니다.",
    },
    {
      n: 4,
      label: "역할·권한 · 탭 및 메뉴 구성",
      zone: "toolbar",
      body: "역할별 메뉴 권한과, 관리자뷰(사이드바)·강사뷰(내 메뉴)에 무엇을 어떤 순서로 보일지입니다. 메뉴 구성은 권한을 대체하지 않습니다.",
    },
    {
      n: 5,
      label: "기능 · 팝업 공지 · 데이터 정리 · 감사로그 · 연동",
      zone: "board",
      body: "새 학원은 ‘기능’에서 필요한 기능을 켭니다. 관리 그룹에서는 중복 원생 정리와 변경 이력을 보고, ‘연동’에서는 켜진 슬랙·makeedu·구글 시트의 내부 탭을 골라 설정합니다.",
    },
    {
      n: 6,
      label: "저장",
      zone: "footer",
      body: "섹션 단위로 저장됩니다. 저장 토스트가 떠도 화면이 안 바뀌면 그 필드는 아직 쓰이지 않는 설정입니다 — 그런 입력은 열어 두지 않습니다.",
    },
  ],
};
