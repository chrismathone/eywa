import type { HelpManual } from "../types";

export const consultations: HelpManual = {
  slug: "consultations",
  title: "원생상담",
  href: "/consultations",
  menuKey: "consultations",
  group: "원생",
  layout: "list",
  summary: "재원생 면담 기록입니다. 행에 마우스를 올리면 내용이 보이고, 기본은 짧은 칸반형 목록입니다.",
  related: ["enrollment", "students", "retention"],
  callouts: [
    {
      n: 1,
      label: "새 상담",
      zone: "header",
      body: "재원 원생을 골라 면담을 적습니다. '반'은 상담사가 그날 가르치는 그 원생의 반이 하나면 저절로 잡히고, 아니면 미매핑(—)입니다. 직접 고르거나 미매핑으로 둘 수 있습니다. 녹음하면 AI가 학습·정서 포인트를 정리합니다.",
    },
    {
      n: 2,
      label: "기간",
      zone: "filters",
      body: "최근 7일 / 30일 / 전체. 축 이름 ‘기간:’이 라벨에 붙습니다.",
    },
    {
      n: 3,
      label: "과목 · 상담사",
      zone: "filters",
      body: "학원설정 과목과 이 학원 직원입니다.",
    },
    {
      n: 4,
      label: "후속",
      zone: "filters",
      body: "기한 지남 / 오늘 / 곧 / 나중에 / 완료. 후속이 있는 행만 남깁니다.",
    },
    {
      n: 5,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름·요약. 눌러야 나옵니다.",
    },
    {
      n: 6,
      label: "상담 행",
      zone: "row",
      body: "이름·학년 | 과목·상담사 | 반 이름 | 요약 | 카테고리·후속·녹음·AI | 시각. 누르면 상세입니다. 창이 넓으면 2단, 좁으면 1단입니다(한 쪽에 담기는 건수는 단 수와 무관합니다). 단이 좁으면 녹음·AI 열이 접혀 표식이 과목·상담사 옆으로 가고, 긴 이름·반 이름은 말줄임됩니다 — 마우스를 올리면 전부 보입니다. 반을 못 정한 상담은 '—'입니다.",
    },
    {
      n: 7,
      label: "후속 토글",
      zone: "cell",
      body: "상세에서 후속 조치를 켜고 기한을 둡니다. 기한이 오면 알림 종이 담당 상담사에게 울립니다.",
    },
    {
      n: 8,
      label: "상담 통계",
      zone: "board",
      body: "목록 오른쪽(좁으면 아래). 목록 필터를 그대로 따릅니다 — 기간·범위가 머리에 적힙니다. 지표 줄을 누르면 그 지표의 월별·주별 추이가, 아래 분해(상담사·과목·반·카테고리·대상)의 줄을 누르면 목록이 그 값으로 걸러집니다. 상담 공백은 오늘 기준 재원생 전체입니다.",
    },
  ],
};
