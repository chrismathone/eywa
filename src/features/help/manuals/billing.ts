import type { HelpManual } from "../types";

export const billing: HelpManual = {
  slug: "billing",
  title: "수납관리",
  href: "/billing",
  menuKey: "billing",
  group: "운영",
  layout: "list",
  summary:
    "이번 달 청구와 미수입니다. 교재·지출·수강료 계산기·회차·시수·환불은 같은 수납 창의 면입니다.",
  related: ["students", "textbook-requests", "expense-requests", "owner"],
  callouts: [
    {
      n: 1,
      label: "청구서 만들기",
      zone: "header",
      body: "이번 달(또는 고른 달) 청구서를 만듭니다. 원생을 골라 한 번에 넣을 수 있습니다.",
    },
    {
      n: 2,
      label: "엑셀 내보내기/가져오기",
      zone: "toolbar",
      body: "검색 옆 한 버튼. 내보내기는 지금 표와 같은 집합(기한 경과만 보고 있으면 그 건만)이고, 가져오기는 청구서 서식을 받아 올립니다(관리자 이상).",
    },
    {
      n: 3,
      label: "월 이동",
      zone: "toolbar",
      body: "‹ 2026년 9월 › + ‘월:’ 드롭다운. 청구가 있는 달만 목록에 있습니다.",
    },
    {
      n: 4,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름. 눌러야 나옵니다.",
    },
    {
      n: 5,
      label: "수납 · 교재 · 지출 · …",
      zone: "header",
      body: "같은 창의 면입니다. 교재는 강사 [[textbook-requests|교재 요청]]을 처리하는 자리, 지출은 [[expense-requests|지출결의서]] 결재와 장부입니다.",
    },
    {
      n: 6,
      label: "지표 칸",
      zone: "board",
      body: "청구액·수납·미수·수납률. 진행률은 카드 없이 스탯 아래 한 줄입니다.",
    },
    {
      n: 7,
      label: "청구 행",
      zone: "row",
      body: "원생별 청구. 수납을 적고, 할인을 넣고, 상태를 바꿉니다. 열이 많으면 표를 잡고 끌어 가로로 밉니다.",
    },
  ],
  faces: [
    {
      title: "교재",
      summary: "신청 → 주문 → 납부. 강사는 [[textbook-requests|교재 요청]]에서 올리고, 사무실이 이 면에서 처리합니다.",
      callouts: [],
    },
    {
      title: "지출",
      summary: "학원 지출 장부. 강사 결의서는 [[expense-requests|지출결의서]]에서 올라옵니다.",
      callouts: [],
    },
    {
      title: "수강료 계산기",
      summary: "신입 상담 견적입니다. 재원생 청구서와 다른 저장소입니다.",
      callouts: [],
    },
    {
      title: "회차 확정 · 청구 시수 대조",
      summary: "새 확정은 출석부 시수 기준이며 기존 일수 기준 확정은 재확정 전까지 유지됩니다. 회차 확정 안의 ‘청구 시수 대조’에서 달력월 출결과 비교합니다. 시수 마스터는 수학·영어의 세션 기간, 남은 예정, 출결 미입력을 확인하는 운영 화면입니다. 청구 분배 기록은 참고용이며 실제 급여는 출석부 기준입니다. 공통 단가는 ‘단가 설정’에서 관리하며 EiE는 회차를 곱하지 않는 월 금액으로 확정합니다.",
      callouts: [],
    },
    {
      title: "환불 요청서",
      summary: "작성·인쇄. 계좌 정보는 AI에 보내지 않습니다.",
      callouts: [],
    },
  ],
};
