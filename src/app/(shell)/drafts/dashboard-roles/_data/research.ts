/**
 * 조사 요약 — 지금 운영실이 보여 주는 항목 전수와 민감도 제안, 침산 직원 분포(건수).
 *
 * 출처: 코드(`features/dashboard/overview/server.ts` `add(area, menus)` 게이트 · `lib/permissions.ts` 기본값) +
 * 침산 운영 DB 읽기 전용 조회(2026-10-01, 역할 override·개인 예외 포함). 이름은 적지 않는다.
 * "지금 보는 역할"은 침산 실제 권한 기준이다 — 열람(viewer)은 역할 override로 운영실이 꺼져 있고,
 * 매니저는 수납이 '전체'로 열려 있다.
 *
 * 🔴 `server-only` — 침산 실측(직급·부서·인원)이라 클라이언트 번들에 실리면 안 된다(시안 페이지가 notFound를 던져도
 *    클라이언트 청크는 받을 수 있다). 화면엔 서버 컴포넌트(`research.tsx`·`bundle-summary.tsx`)만 그린다.
 * 🔴 슈퍼관리자 계정이 든 행·문장은 `superAdminOnly` — 원장에게는 슈퍼관리자를 '관리자'로 보여 주는 정책이라
 *    (`displayRoleFor`) 실제 역할을 이 표가 대신 알려 주면 안 된다.
 */
import "server-only";
import type { BundleId } from "./bundles";

export type Tier = "원장 전용" | "관리자급" | "실무" | "누구나";

export const TIER_TONE = {
  "원장 전용": "critical",
  관리자급: "caution",
  실무: "info",
  누구나: "positive",
} as const;

export type InventoryRow = { area: string; item: string; data: string; now: string; tier: Tier; note?: string };

const ALL = "원장·관리자·실장";

export const INVENTORY: InventoryRow[] = [
  { area: "지표", item: "재원생", data: "재원 수 · 프로그램별", now: ALL, tier: "실무", note: "과목 담당은 내 과목만" },
  { area: "지표", item: "퇴원생 · 팝업 명단", data: "이번 달 수 · 이름·학교·퇴원일", now: ALL, tier: "관리자급", note: "수는 실무, 명단은 관리자급" },
  { area: "지표", item: "신규문의", data: "오늘 건수 · 문의자 이름·단계", now: ALL, tier: "실무" },
  { area: "지표", item: "금일 입테", data: "오늘 건수 · 일정 원문", now: ALL, tier: "실무", note: "원문에 학부모 전화번호가 섞일 수 있다" },
  { area: "지표", item: "금일 등록 · 오늘첫수업", data: "건수 · 이름·반 배정", now: ALL, tier: "실무" },
  { area: "지표", item: "결석학생(어제)", data: "건수 · 이름·사전 통보 여부", now: ALL, tier: "실무" },
  { area: "지표", item: "보강예정", data: "한 달 예약 · 이름·예약한 직원", now: ALL, tier: "실무" },
  { area: "카드", item: "N월 수납 현황", data: "완납·부분납·미납 건수 + 미수 잔액(원)", now: ALL, tier: "원장 전용", note: "건수는 데스크 실무 후보" },
  { area: "카드", item: "6개월 청구 · 수납", data: "월별 실청구액 · 이번 달 수납률", now: ALL, tier: "원장 전용" },
  { area: "카드", item: "N월 지출 내역", data: "분류별 지출 합계", now: ALL, tier: "원장 전용" },
  { area: "카드", item: "직원 구성", data: "재직 인원 · 역할×과목", now: "원장 + 직원관리 개인 예외 관리자 4명", tier: "원장 전용" },
  { area: "카드", item: "등록 · 퇴원 추이", data: "6개월 월별 등록·퇴원 수", now: ALL, tier: "관리자급", note: "퇴원 권한이 아니라 원생 권한으로 열린다" },
  { area: "카드", item: "재원생 추이", data: "12개월 월말 재원 수", now: ALL, tier: "관리자급" },
  { area: "카드", item: "콜&상담 전환", data: "접수·등록·미등록 · 전환율", now: ALL, tier: "관리자급" },
  { area: "카드", item: "상담 진행", data: "단계별 인원 · 멈춘 상담 이름·사유 문장", now: ALL, tier: "관리자급" },
  { area: "카드", item: "학생 상담", data: "7일 건수 · 후속조치 기한", now: ALL, tier: "관리자급" },
  { area: "카드", item: "반복 결석 학생", data: "14일 결석 3회↑ 이름·횟수", now: ALL, tier: "관리자급", note: "과목 담당은 내 과목만" },
  { area: "카드", item: "강사 시트 작성 현황", data: "영어·수학 반 수·작성률", now: ALL, tier: "관리자급", note: "강사 성과(간접)" },
  { area: "카드", item: "행정 · 자산", data: "회의록·문서·결재 대기·자산 건수", now: ALL, tier: "관리자급" },
  { area: "카드", item: "출결 현황 · 14일 등원율", data: "오늘 출결 도넛 · 일별 등원율", now: ALL, tier: "실무" },
  { area: "카드", item: "학습 · 학부모 보고", data: "숙제 미제출·미확인 보고서 건수", now: ALL, tier: "실무" },
  { area: "카드", item: "신규생 단계 · 체크 진행", data: "90일 신규생 단계 · 확인 필요 이름", now: ALL, tier: "실무" },
  { area: "카드", item: "레벨테스트 · 첫수업 일정", data: "한 달 일정 제목(원문)", now: ALL, tier: "실무", note: "전화번호 가림 필요" },
  { area: "카드", item: "재원생 구성 · 과목별 · 학년별 · 학교별", data: "인원 막대", now: ALL, tier: "실무" },
  { area: "카드", item: "현재 수업 현황 · 강의실 2D/3D", data: "반·시간·강사 이름·교실", now: ALL, tier: "누구나" },
  { area: "카드", item: "학원 공지", data: "최근 공지 · 본문", now: ALL, tier: "누구나" },
  { area: "꺼짐", item: "AI 일일 브리핑", data: "위험 학생 이름 + '관련 월 수강료'", now: "꺼져 있음", tier: "원장 전용", note: "다시 켤 때 원장 전용으로" },
  { area: "미연결", item: "누적 미수 상위 · 한 화면 대시보드", data: "학생 이름 + 미수 금액", now: "화면에 안 붙음", tier: "원장 전용" },
];

export type StaffRow = { role: string; title: string; subject: string; n: number; now: string; bundle: string; superAdminOnly?: boolean };

export const STAFF_DIST: StaffRow[] = [
  { role: "원장", title: "원장 · 대표", subject: "없음", n: 2, now: "전부", bundle: "원장" },
  { role: "원장", title: "개발팀(부장·대리) · 슈퍼관리자", subject: "없음", n: 2, now: "전부", bundle: "원장", superAdminOnly: true },
  { role: "관리자", title: "부원장 · 교수부장 (수학과)", subject: "수학", n: 2, now: "전부 + 돈", bundle: "과목 관리자" },
  { role: "관리자", title: "부원장 · 교수부장 · 직급 없음 (영어과)", subject: "영어", n: 3, now: "전부 + 돈", bundle: "과목 관리자" },
  { role: "관리자", title: "사원 (경영지원팀)", subject: "없음", n: 2, now: "전부 + 돈", bundle: "경영지원 · 데스크" },
  { role: "매니저", title: "분원장(수학과) · 전임강사(영어과)", subject: "수학 1 · 영어 1", n: 2, now: "전부 + 돈(수납 '전체' override)", bundle: "실장(매니저)" },
  { role: "강사", title: "전임·파트·프리랜서·원어민·아르바이트", subject: "영어 10 · 수학 6 · 없음 1", n: 17, now: "없음 — 원스크린(잠금)", bundle: "대상 아님" },
  { role: "열람", title: "아르바이트", subject: "없음", n: 1, now: "없음 — 역할 override로 꺼짐", bundle: "대상 아님" },
  { role: "상담 · 회계", title: "—", subject: "—", n: 0, now: "override: 상담 전체 / 회계 꺼짐", bundle: "생기면 정함" },
];

/** 묶음별 실측 인원 — 슈퍼관리자가 볼 때만 슈퍼관리자 계정을 함께 적는다. */
export const BUNDLE_PEOPLE: Record<BundleId, { base: string; withSuperAdmin?: string }> = {
  owner: { base: "2명 — 원장·대표", withSuperAdmin: "4명 — 원장·대표 2 + 개발팀 2(슈퍼관리자)" },
  subjectAdmin: { base: "5명 — 수학 2(부원장·교수부장) · 영어 3(부원장·교수부장·직급 없음)" },
  manager: { base: "2명 — 분원장(수학) · 전임강사(영어), 둘 다 담당 과목 있음" },
  desk: { base: "2명 — 경영지원팀 사원" },
};

export const ACTIVE_STAFF = { base: 29, withSuperAdmin: 31 };

export const WIRING: { text: string; superAdminOnly?: boolean }[] = [
  { text: "판정 = 시스템 역할 + 담당 과목(users.subjects). 직급은 권한과 연결된 코드가 없고 값도 학원설정 직급 목록과 어긋나 쓰지 않는다." },
  { text: "돈·직원 칸은 메뉴 권한(수납·직원관리)에서 떼어 '원장 전용' 판정(원장 + 슈퍼관리자, 급여명세서와 같은 두 줄)으로 — 지금은 매니저가 역할 override로 수납 '전체'라 그대로 두면 돈이 샌다." },
  { text: "과목 좁히기는 화면 숨김이 아니라 서버 조회 단계에서 — 지금 add(area, menus)가 권한 없는 영역을 아예 안 읽는 것과 같은 방식." },
  { text: "기존 '역할별 기본 세팅 5종'은 슬랙 알림 프리셋이라 권한 프리셋이 아니다 — 운영실 묶음은 판정 함수 하나로 새로 둔다." },
  { text: "슈퍼관리자는 자동 통과(원장 묶음)." },
  { text: "슈퍼관리자 3명 중 침산 활성 2명은 역할이 원장이다(원장에겐 '관리자'로 보인다).", superAdminOnly: true },
];

export const OWNER_DECIDES: string[] = [
  "데스크(경영지원)에게 미납 건별 금액을 보여 줄지 — 안내 업무엔 필요, 합계·수납률·추이는 빼는 안.",
  "과목 관리자에게 그 과목의 실청구·정산(과목 손익)을 보여 줄지 — 지금 안은 금액 전부 원장 전용.",
  "강사별 보고서·시트 작성률(성과 비교)을 과목 관리자에게 열지 — 실장(매니저)에겐 닫는 안.",
  "퇴원 명단(이름)과 사유 — 안: 명단은 과목 관리자(내 과목), 사유 원문은 원장 전용.",
  "레벨테스트 일정 원문의 학부모 전화번호 — 안: 원장 외에는 가려서 보여 준다.",
  "직원 구성 카드 — 지금은 직원관리 개인 예외를 따라 관리자 4명(경영지원 2·과목 관리자 2)에게 열린다. 안: 원장 전용(직원관리 메뉴 예외와는 따로).",
  "담당 과목이 둘 이상인 사람(지금 0명) — 안: 담당 과목 합집합.",
];
