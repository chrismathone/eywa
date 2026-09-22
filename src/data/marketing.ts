import type { AywaIconName } from "@/components/icons/aywa-icons";

/**
 * 공개 랜딩(`/`) 카피 — 지금 메뉴와 맞춘다. 학원·지점 이름이나 실데이터는 넣지 않는다.
 * 🔴 무료·베타·요금 약속 금지 — 도입·요금은 '문의' 말투, 연결(메일·전화) 없이 문구만(원장 2026-09-22).
 *    연락처가 정해지면 이 문구에 연결만 단다.
 */
export const INQUIRY_NOTE = "도입과 이용 요금은 문의해 주세요.";

export type LandingRoom = "office" | "classA" | "desk";

/** 역할 카드 — 모형의 층이 곧 그 역할이 일하는 자리. */
export const LANDING_ROLES: {
  room: LandingRoom; tag: string; title: string; body: string; menus: string[]; image: string; alt: string;
}[] = [
  {
    room: "office", tag: "3F · 원장 · 관리자", title: "학원 전체를 한눈에",
    body: "운영실에서 재원생·결석·신규 문의를 보고, 매일 07:00에 만들어지는 AI 운영 브리핑으로 오늘 챙길 일을 확인합니다.",
    menus: ["운영실", "직원관리", "회의록"], image: "/landing/floor-3.webp", alt: "모형 3층 원장실 확대",
  },
  {
    room: "classA", tag: "2F · 강사", title: "오늘 수업만 간단하게",
    body: "사이드바 없는 화면에서 출결을 찍고, 원스크린에서 수업보고서를 써서 학부모 알림장으로 보냅니다. 반별 진도는 강사 시트에 남깁니다.",
    menus: ["원스크린", "강사 시트", "출결 모드"], image: "/landing/floor-2.webp", alt: "모형 2층 교실 확대",
  },
  {
    room: "desk", tag: "1F · 데스크", title: "문의와 등원, 수납",
    body: "걸려 온 상담을 네 칸으로 옮기며 관리하고, 원생 정보를 찾고, 청구와 미수를 챙깁니다.",
    menus: ["콜&상담", "원생목록", "수납관리"], image: "/landing/floor-1.webp", alt: "모형 1층 데스크 확대",
  },
];

/** 건물 곳곳의 작은 방 — 큰 메뉴 말고도 한 체계 안에 있는 일들. */
export const LANDING_SMALL_ROOMS: { icon: AywaIconName; title: string; body: string }[] = [
  { icon: "userCheck", title: "신규생 관리", body: "등록 뒤 7·30·60·90일에 챙길 콜과 안내를 체크합니다." },
  { icon: "sheetRows", title: "수학 강사 시트", body: "학생마다 다른 교재와 진도를 한 달 단위로 봅니다." },
  { icon: "exam", title: "성적관리", body: "시험 점수를 과목·반별 학생 목록에 바로 적어 모읍니다." },
  { icon: "scrollText", title: "전자결재", body: "휴가·품의·지출 문서를 결재선에 올립니다." },
  { icon: "calendar", title: "캘린더", body: "학원 공용 일정을 한 곳에서 관리합니다." },
  { icon: "archive", title: "재고관리", body: "자산마다 QR 라벨을 붙여 상태와 대여를 기록합니다." },
  { icon: "settings", title: "학원 설정", body: "과목·학년·교시·휴일을 학원 운영에 맞춰 정합니다." },
  { icon: "key", title: "권한", body: "역할별로 정하고, 사람별 예외를 둡니다. 권한 없는 메뉴는 보이지 않습니다." },
  { icon: "mapPin", title: "여러 지점", body: "지점마다 계정을 두고 한 체계로 운영합니다." },
];
