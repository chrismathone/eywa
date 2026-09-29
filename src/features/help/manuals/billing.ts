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
      title: "회차 확정 · 시수 검증",
      summary: "출석 하루 = 1회이며 시수(0.5)와는 다릅니다. 공통 단가는 ‘단가 설정’에서 추가·수정·삭제하며 수학·영어가 같은 목록을 씁니다. 기존 확정 금액은 유지됩니다. EiE는 회차를 곱하지 않는 월 금액으로 확정합니다. 강사 정산은 급여명세서와 같은 계산(출석 시수 × 단가 × 수수료 차감 × 배분율)입니다.",
      callouts: [],
    },
    {
      title: "환불 요청서",
      summary: "작성·인쇄. 계좌 정보는 AI에 보내지 않습니다.",
      callouts: [],
    },
  ],
};
