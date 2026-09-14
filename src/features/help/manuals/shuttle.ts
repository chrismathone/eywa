import type { HelpManual } from "../types";

export const shuttle: HelpManual = {
  slug: "shuttle",
  title: "셔틀",
  href: "/shuttle",
  menuKey: "shuttle",
  group: "운영",
  layout: "kanban",
  summary:
    "노선 편성이 본체이고, 오늘 등하원은 매일 찍는 면입니다. 출결과 자동으로 맞추지 않습니다 — 셔틀 미탑승이 결석이 아닙니다.",
  related: ["students", "attendance"],
  callouts: [
    {
      n: 1,
      label: "노선 편성 · 오늘 등하원 · 운행 현황",
      zone: "header",
      body: "같은 셔틀 창의 면. 폰은 화면 안 탭으로 오갑니다(사이드바가 없어 하부탭만으로는 못 갑니다).",
    },
    {
      n: 2,
      label: "정류장 관리",
      zone: "header",
      body: "정류장 이름은 여기서만 고칩니다. 노선은 정류장을 참조만 해서, 같은 곳이 노선마다 다른 글자로 갈라지지 않습니다.",
    },
    {
      n: 3,
      label: "시즌",
      zone: "toolbar",
      body: "학기중 / 방학중. 차량을 복제하지 않고 같은 노선의 시즌만 바꿉니다.",
    },
    {
      n: 4,
      label: "회차 · 노선 · 원생",
      zone: "board",
      body: "3열. 원생을 끌어 정류장에 넣습니다. 폰은 ‘+ 원생’이 기본입니다.",
    },
    {
      n: 5,
      label: "오늘 등하원 기록",
      zone: "cell",
      body: "탔다/안 탔다. 셔틀 담당(직원관리 토글)과 사무실이 찍습니다. 결석을 만들지 않습니다.",
    },
    {
      n: 6,
      label: "인쇄",
      zone: "header",
      body: "편성표 인쇄. 더보기 메뉴입니다.",
    },
  ],
};
