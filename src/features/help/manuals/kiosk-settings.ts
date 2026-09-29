import type { HelpManual } from "../types";

export const kioskSettings: HelpManual = {
  slug: "kiosk-settings",
  title: "출석 키오스크",
  href: "/kiosk-settings",
  menuKey: "kiosk_settings",
  group: "지원",
  layout: "list",
  summary:
    "원장 전용 설정입니다. 현관 태블릿에서 원생이 출석번호로 등하원을 기록하도록 번호와 기기를 관리하고, 학부모 알림 발송 상태를 확인합니다.",
  related: ["attendance", "owner"],
  callouts: [
    {
      n: 1,
      label: "출석번호",
      zone: "header",
      body: "학생 또는 학부모 휴대폰 번호 뒷자리로 원생별 출석번호를 발급합니다. 번호가 겹치면 다섯 자리로 구분합니다.",
    },
    {
      n: 2,
      label: "키오스크 기기",
      zone: "board",
      body: "현관 태블릿을 등록하거나 사용하지 않는 기기를 해제합니다. 기기별 최근 사용 시각도 확인합니다.",
    },
    {
      n: 3,
      label: "알림 발송 내역 · 카카오 알림톡 연동",
      zone: "board",
      body: "최근 알림의 발송 상태를 확인합니다. 카카오 채널을 연결하기 전에는 발송 시뮬레이션이며 실제 문자는 가지 않습니다. 연동 상태와 최근 오류를 확인하세요.",
    },
    {
      n: 4,
      label: "최근 등하원",
      zone: "footer",
      body: "태블릿에서 찍은 등하원 기록을 봅니다. 등원 시각의 수업이 하나로 정해지면 출석부에도 자동으로 반영되고, 강사가 이미 입력한 출결은 유지됩니다.",
    },
  ],
};
