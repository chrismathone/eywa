import type { HelpManual } from "../types";

export const staff: HelpManual = {
  slug: "staff",
  title: "직원관리",
  href: "/staff",
  menuKey: "staff",
  group: "운영",
  layout: "list",
  summary:
    "직원 명부입니다. 원장과 개인 예외가 있는 데스크만 엽니다. 이력서·근무 설정·계정 관리 창구는 내용이 겹치지 않습니다.",
  related: ["owner", "approvals", "onescreen"],
  callouts: [
    {
      n: 1,
      label: "직원 등록",
      zone: "header",
      body: "새 직원을 이력서부터 만듭니다. 인적·계약(연락처·직급·입사일)은 이력서가 단일 소스입니다.",
    },
    {
      n: 2,
      label: "등록 QR",
      zone: "header",
      body: "직원이 휴대폰으로 자기 정보를 넣게 하는 링크입니다. 새 링크를 발급하면 지금 QR은 더 이상 열리지 않습니다.",
    },
    {
      n: 3,
      label: "연차 관리",
      zone: "header",
      body: "박소선·이승엽·김예원(과 총괄)에게만 보입니다. 법정 부여 위에 이월·특별휴가를 한 줄씩 얹습니다. 휴가 **신청**은 [[approvals|전자결재]]입니다.",
    },
    {
      n: 4,
      label: "역할 · 상태 · 과목 · 계약 · 정렬",
      zone: "filters",
      body: "한 줄 드롭다운입니다. 볼 열을 고르는 표라 열 머리가 필터가 아닙니다 — 숨긴 열의 필터를 되돌릴 자리가 없기 때문입니다.",
    },
    {
      n: 5,
      label: "검색 · 표시 인원",
      zone: "toolbar",
      body: "이름 검색은 눌러야 나옵니다. 한 페이지에 몇 명을 볼지는 계정에 저장됩니다.",
    },
    {
      n: 6,
      label: "이름 칸",
      zone: "row",
      body: "누르면 이력서입니다. 근무 설정(담당 과목·강의실·알림)과 계정(이메일·역할·삭제)은 이력서에 없는 것만 다룹니다.",
    },
    {
      n: 7,
      label: "열 · 글자 크기",
      zone: "footer",
      body: "표에서 볼 열과 글자 크기는 계정 설정입니다. 이 창이 바꾼 차이만 저장합니다.",
    },
  ],
};
