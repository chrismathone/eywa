import type { HelpManual } from "../types";

export const inventory: HelpManual = {
  slug: "inventory",
  title: "재고관리",
  href: "/inventory",
  menuKey: "inventory",
  group: "운영",
  layout: "list",
  summary:
    "전자기기 자산대장입니다. 자산 1대 = 영구 행 1개. 면(자산·대여·실사·소모품)은 화면 안 탭입니다. 행 더블클릭이 수정, 우하단이 삭제입니다.",
  related: ["staff", "owner"],
  callouts: [
    {
      n: 1,
      label: "자산 / 대여 / 실사 / 소모품",
      zone: "header",
      body: "화면 안 탭. 사이드바에는 ‘재고관리’ 한 줄만 있습니다.",
    },
    {
      n: 2,
      label: "엑셀",
      zone: "header",
      body: "내려받는 서식 = 올리는 서식. 자산ID/품목ID로 맞춥니다. 오류 1건이면 전무입니다. 새 분류가 있으면 반영 전에 확인 창이 한 번 뜹니다.",
    },
    {
      n: 3,
      label: "필터 · 검색",
      zone: "filters",
      body: "상태·분류. 조치필요는 분실·확인·미등록·수리중을 한 함수로 셉니다. 폐기 숨김은 계정에 저장됩니다.",
    },
    {
      n: 4,
      label: "QR 보기",
      zone: "cell",
      body: "QR은 저장하지 않고 자산ID에서 만듭니다. 찍으면 그 기기의 현재 상태 공개 화면입니다. 라벨 인쇄는 번호 범위로 고릅니다.",
    },
    {
      n: 5,
      label: "행 더블클릭",
      zone: "row",
      body: "수정. 상태 칸 더블클릭은 상태 변경. 대여 중이면 사용자 칸을 직접 못 바꿉니다 — 대여 기록이 진실입니다.",
    },
    {
      n: 6,
      label: "삭제",
      zone: "footer",
      body: "수정 창 우하단. 자산 삭제는 대여·실사를 함께 지우고, 열린 대여가 있으면 거절합니다.",
    },
  ],
};
