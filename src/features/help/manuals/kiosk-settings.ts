import type { HelpManual } from "../types";

export const kioskSettings: HelpManual = {
  slug: "kiosk-settings",
  title: "출석 키오스크",
  href: "/kiosk-settings",
  menuKey: "kiosk_settings",
  group: "지원",
  layout: "list",
  summary:
    "원장 전용입니다. 사이드바에 없고 이 설명서(또는 도움말 링크)가 입구입니다. 원생이 태블릿에서 직접 출석을 찍는 화면을 켭니다.",
  related: ["attendance", "owner"],
  callouts: [
    {
      n: 1,
      label: "키오스크 켜기",
      zone: "header",
      body: "태블릿용 출석 화면 주소와 PIN입니다. 키오스크는 직원 이름 없이 출결만 찍습니다.",
    },
    {
      n: 2,
      label: "PIN · 자리",
      zone: "board",
      body: "자리(랩실) PIN은 [[attendance-seat|자리 출석부]]와 같은 화면을 비로그인으로 엽니다. JJ PIN은 결석 사유를 내려보내지 않습니다.",
    },
  ],
};
