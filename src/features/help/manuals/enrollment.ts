import type { HelpManual } from "../types";

export const enrollment: HelpManual = {
  slug: "enrollment",
  title: "콜&상담",
  href: "/enrollment",
  menuKey: "enrollment",
  group: "원생",
  layout: "kanban",
  summary:
    "신입 문의와 상담입니다. 칸반은 상담 전 · 상담 완료 · 미등록 · 등록 완료 4칸입니다. 목록 보기(시트 모양)로 바꿔 한 줄로 볼 수도 있습니다.",
  related: ["students", "consultations", "dashboard"],
  callouts: [
    {
      n: 1,
      label: "신규 등록",
      zone: "header",
      body: "상담 카드를 직접 만듭니다. 이름·학교·연락처·희망 과목을 적습니다.",
    },
    {
      n: 2,
      label: "QR 접수",
      zone: "header",
      body: "학부모가 휴대폰으로 직접 접수하게 하는 코드입니다. 접수분은 목록에 바로 쌓이고, 기존 재원생이면 그 원생과 연결됩니다. 보호자 번호가 분명히 다른 동명이인은 연결하지 않습니다.",
    },
    {
      n: 3,
      label: "칸반 / 목록",
      zone: "toolbar",
      body: "칸반은 4칸 카드, 목록은 한 줄 표입니다. 필터·월 선택은 두 보기가 같습니다.",
    },
    {
      n: 4,
      label: "기간 · 상담사 · 검색",
      zone: "filters",
      body: "연월 피커와 담당 상담사, 이름 검색입니다.",
    },
    {
      n: 5,
      label: "상담 전 칸",
      zone: "board",
      body: "아직 만나기 전. QR로 들어온 카드에만 QR 표식이 있습니다. 끌어 다른 칸으로 옮기면 상태가 바뀝니다.",
    },
    {
      n: 6,
      label: "상담 완료 칸",
      zone: "board",
      body: "상담을 마친 카드. 녹음이 있으면 마이크 표식만(녹음이 끝나면 자동 분석이라 AI 표식을 겹치지 않습니다).",
    },
    {
      n: 7,
      label: "미등록 / 등록 완료",
      zone: "board",
      body: "미등록은 등록하지 않기로 한 카드. 등록 완료는 실제로 반에 들어간 카드(반 배정 표식). 반이 있는 카드는 끌어 옮기지 못합니다 — 배정은 수강에서 오는 값이라 상태만 바꾸면 도로 돌아옵니다.",
    },
    {
      n: 8,
      label: "카드 · 행",
      zone: "row",
      body: "칸반 카드는 누르면 상세, 목록은 ‘열기’. 목록의 이름·학교·과목·상담 내용은 더블클릭하면 그 칸에서 고칩니다. 상태 칸 더블클릭은 4단계 중 하나입니다.",
    },
    {
      n: 9,
      label: "녹음 · AI",
      zone: "cell",
      body: "상세에서 녹음하거나 파일을 올리면 글로 옮기고 분석합니다. 다시 분석은 버튼을 누를 때만입니다. 분석에 쓰인 모델 이름이 펼치기 옆에 짧게 보입니다.",
    },
  ],
};
