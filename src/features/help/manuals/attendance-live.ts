import type { HelpManual } from "../types";

export const attendanceLive: HelpManual = {
  slug: "attendance-live",
  title: "오늘 출결",
  href: "/attendance/live",
  menuKey: "attendance",
  group: "수업",
  layout: "grid",
  summary: "오늘(또는 고른 날) 반별 좌석표입니다. 월별 출석부와 같은 출석부 창 안의 면입니다.",
  related: ["attendance", "attendance-quick", "attendance-seat"],
  callouts: [
    {
      n: 1,
      label: "날짜 이동",
      zone: "toolbar",
      body: "오늘을 기준으로 앞뒤 날입니다. 휴일이어도 칸은 남아 있어 그날 실제로 한 수업을 찍을 수 있습니다.",
    },
    {
      n: 2,
      label: "반 칩",
      zone: "filters",
      body: "그날 수업이 있는 반만 섭니다. 칩을 누르면 그 반 좌석만 남습니다.",
    },
    {
      n: 3,
      label: "검색",
      zone: "toolbar",
      body: "원생 이름. 여러 반에 걸쳐 찾습니다.",
    },
    {
      n: 4,
      label: "좌석 칸",
      zone: "cell",
      body: "이름을 눌러 출석·결석·지각을 찍습니다. 글자 크기는 칸 폭에 맞춰 커집니다. [[attendance|보강 예약]]이 있는 교시 칸은 보라 점선 링입니다.",
    },
    {
      n: 5,
      label: "합계",
      zone: "footer",
      body: "그 반의 출석·결석 인원입니다. 검색 중이면 검색된 원생만 셉니다.",
    },
  ],
};
