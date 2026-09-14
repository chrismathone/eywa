import type { HelpManual } from "../types";

export const workspace: HelpManual = {
  slug: "workspace",
  title: "창 사용법",
  href: "/help",
  menuKey: "help",
  group: "창",
  layout: "workspace",
  summary:
    "Eywa는 메뉴를 누르면 창이 열립니다. 여러 화면을 동시에 띄워 두고, 가장자리로 끌면 나란히 볼 수 있어요. 이 설명서의 노란 숫자 버튼을 누르면 아래 설명이 따라갑니다.",
  related: ["help", "dashboard"],
  callouts: [
    {
      n: 1,
      label: "사이드바 메뉴",
      zone: "header",
      body: "왼쪽 업무군(홈·수업·원생·운영·지원)에서 화면을 고릅니다. 누르면 [[workspace|창]]이 열리고, 이미 열린 메뉴를 다시 누르면 그 창이 앞으로 옵니다. 닫은 메뉴를 다시 열면 그 메뉴의 첫 화면으로 돌아갑니다.",
    },
    {
      n: 2,
      label: "창 제목 표시줄",
      zone: "toolbar",
      body: "여기를 잡고 끌면 창이 움직입니다. 화면 가장자리로 끌면 반쪽·최대화로 붙습니다. 제목은 지금 보고 있는 화면 이름입니다.",
    },
    {
      n: 3,
      label: "최소화",
      zone: "toolbar",
      body: "창을 접어도 작업 내용은 그대로입니다. 아래 스트립의 카드를 누르면 다시 펼쳐집니다.",
    },
    {
      n: 4,
      label: "닫기",
      zone: "toolbar",
      body: "창을 닫습니다. 저장하지 않은 내용이 있으면 한 번 더 물어봅니다. 닫은 메뉴는 사이드바에서 다시 열면 첫 화면입니다.",
    },
    {
      n: 5,
      label: "검색 팰릿 (Shift+F)",
      zone: "header",
      body: "메뉴·원생·화면을 이름이나 예전 이름(학생목록, 등록상담, 운영실)으로 찾습니다. 결과를 누르면 그 창이 열립니다.",
    },
    {
      n: 6,
      label: "알림 종",
      zone: "header",
      body: "결석이 쌓였을 때, 상담 후속 기한, 미발송 수업보고서, 발송 실패처럼 **지금 손댈 일**만 울립니다. 종을 누르면 해당 화면으로 갑니다.",
    },
    {
      n: 7,
      label: "창 모서리",
      zone: "footer",
      body: "모서리를 끌어 크기를 바꿉니다. 화면마다 **최소 크기**가 있어 그보다 작게는 줄어들지 않습니다 — 표와 칸이 한 줄로 늘어나지 않게 막아 둔 것입니다.",
    },
    {
      n: 8,
      label: "도움말 안 하이라이트",
      zone: "board",
      body: "설명 글에서 [[timetable|시간표]]처럼 색이 입혀진 말은 그 화면의 설명서로 바로 갑니다. 설명서 오른쪽 위 ‘이 화면 열기’가 실제 화면 창을 엽니다.",
    },
  ],
};
