/**
 * 의미색 캐논(semantic color canon) — "같은 뜻이면 어느 화면에서든 같은 색".
 *
 * 원장 지시(2026-08-18): *"전체적으로 색감을 여기저기에 넣어 눈에 띄면 좋겠네"* +
 * *"그렇다고 너무 여러곳에서 다양한 색감을 가진다기보다 **일치하는 곳의 색은 항상 일치**하게 해서
 * 이게 여기서도 이어지는구나 라는 느낌이 들도록"*.
 *
 * 그래서 색은 **장식이 아니라 어휘**다. 화면마다 예쁜 색을 고르는 게 아니라, 뜻(tone)을 고르면
 * 색은 여기서 정해진다. 운영실에서 초록으로 본 "정상"이 학생목록·출석부·수납·결재에서도 초록이라
 * 사용자가 색만 보고 상태를 읽게 된다.
 *
 * ## 축이 둘이다 — 섞지 말 것
 *  ① **의미(tone)** = 이 파일. 정상/주의/위험/정보/예외 — 앱 전체 공통, 코드 고정.
 *  ② **과목(subject)** = 학원설정(`operations.subjects[].color`) — 학원마다 다르고 원장이 고른다.
 *     소스는 [`buildSubjectMaps`](src/features/owner/subjects.ts). **여기서 과목 색을 정하지 말 것.**
 *
 * 두 축이 같은 팔레트(PillColor)를 공유하므로 한 화면에 나란히 놓이면 색이 겹쳐 보일 수 있다
 * (실측: 학생목록에서 '재원'(구 primary)과 '수학'(blue)이 거의 같은 파랑이었다). 그래서
 * **상태는 채운 배지(soft fill), 과목은 테두리 배지(outline)** 로 형태를 갈라 둔다 —
 * 색이 비슷해도 형태로 구분되고, 색이 다르면 두 배로 명확해진다.
 *
 * ⚠️ 새 상태·새 배지를 만들 때 `PillColor`를 직접 고르지 말고 여기 tone을 고를 것. 여기에 없는
 *    뜻이면 tone을 추가한다(= 앱 전역에 그 뜻이 생긴다는 결정). 화면 안에서 임의로 색을 고르는 순간
 *    "이어지는 느낌"이 끊긴다.
 */
import type { PillColor } from "@/components/atoms/pill";

/**
 * 앱 전체가 공유하는 여섯 가지 뜻.
 *
 * - `positive` 정상·완료·성공 — 출석 · 완납 · 승인 완료 · 재원 · 발송 완료
 * - `caution`  주의·**내 차례**  — 지각 · 부분납 · 내 결재 대기 · 보고서 작성중 · 휴원
 * - `critical` 실패·위험      — 결석 · 미납/연체 · 반려 · 발송 실패 · 마감 있는 미작성 · 이탈 위험
 * - `info`     진행중·정보     — 수업 진행 중 · 결재 진행중 · 상담 진행 · 예비/문의 · 조퇴
 *
 * ⚠️ `caution`과 `info`의 경계는 **"내가 지금 손을 대야 하나"** 다. 결재가 돌고 있는 것(진행중)은
 *    info지만 **내 차례**로 온 것은 caution — 같은 문서라도 보는 사람에 따라 뜻이 달라진다.
 *    📌 결재함 '대기' 탭은 아직 색이 아니라 **건수**로 이 구분을 표현한다(공용 FaceTabs라 탭별 색 없음).
 * - `special`  예외·대체       — 보강 · 대결/전결 · 반 이동(전출)
 * - `inert`    종료·비활성     — 퇴원 · 취소 · 해당 없음 (색을 빼서 "지나간 것"으로)
 *
 * ⚠️ `inert`는 **목록에서 지나간 행을 죽일 때** 쓰는 톤이지, **주의를 끌려고 붙인 배지**에 쓸 톤이
 *    아니다. 출석부 이름 칸의 '퇴원' 표식을 inert로 칠했다가 되돌렸다 — 같은 표의 주말 회색과
 *    대비가 1.13이라 표식이 있다는 사실 자체가 안 보였고, 신입·반이동과 한 세트인데 혼자 무채색이
 *    되면 세트에서 빠진다(2026-08-18 실측).
 *
 * `brand`는 뜻이 아니라 **자리 표시**(현재 위치·기본 액션·브랜드)라 따로 둔다 —
 * 상태에 brand를 쓰면 테넌트가 브랜드색을 바꿀 때 상태 색이 같이 바뀐다.
 *
 * 🔑 이 배정은 **새로 지어낸 게 아니라 이미 잘 쓰던 화면에서 뽑아 굳힌 것**이다 — 출석부 팔레트
 * (`--att-*`: 출석 민트 · 지각 주황 · 결석 빨강 · 조퇴 파랑 · 보강 보라)와 ECS 상태 톤
 * (옛 `class-sheets/lib/status-tone.ts` — 2026-11-10 미사용으로 삭제: done=green · warn=amber ·
 * absent=danger)이 이미 이 색조합을 쓰고 있었다. 나머지 화면을 여기에 맞추는 것이 이 캐논의 일이다.
 * ⚠️ 출석부의 `--att-*`는 31칸 격자 전용의 **쨍한 원색**이라 값이 다르다(같은 뜻·다른 채도) —
 *    다른 화면에 `--att-*`를 쓰지 말고, 여기 tone(-soft 틴트)을 쓸 것.
 */
export type SemanticTone =
  | "positive"
  | "caution"
  | "critical"
  | "info"
  | "special"
  | "inert"
  | "brand";

/** tone → 팔레트 색. 이 표가 "같은 뜻 = 같은 색"의 유일한 근거다. */
export const TONE_COLOR: Record<SemanticTone, PillColor> = {
  positive: "green",
  caution: "amber",
  critical: "danger",
  info: "blue",
  special: "purple",
  inert: "neutral",
  brand: "primary",
};

/** tone → 텍스트 색 클래스(아이콘·숫자·강조 문구용). 배지가 아니라 글자에 색을 줄 때. */
export const TONE_TEXT: Record<SemanticTone, string> = {
  positive: "text-green",
  caution: "text-amber",
  critical: "text-danger",
  info: "text-blue",
  special: "text-purple",
  inert: "text-text-dim",
  brand: "text-primary",
};

/** tone → 옅은 채움 + 같은 색 글자(배지·칩·알림 배너). */
export const TONE_SOFT: Record<SemanticTone, string> = {
  positive: "bg-green-soft text-green",
  caution: "bg-amber-soft text-amber",
  critical: "bg-danger-soft text-danger",
  info: "bg-blue-soft text-blue",
  special: "bg-purple-soft text-purple",
  inert: "bg-bg-soft text-text-dim",
  brand: "bg-primary-soft text-primary",
};

// 왼쪽 색 띠 표현(옛 `TONE_ACCENT_BAR`)은 없다 — 앱에서 걷어냈고(원장 2026-09-16) 마지막 소비처였던 시간표(개발중)를
// 2026-10-23 지우면서 상수도 지웠다. 뜻은 배경색·글자색·문구가 말한다(가드 `no-left-accent-bar.test.ts`).

/** tone → Pill 색. `<Pill color={toneColor("positive")}>` 처럼 쓴다. */
export function toneColor(tone: SemanticTone): PillColor {
  return TONE_COLOR[tone];
}

/**
 * **상태 전용으로 예약된 색** — 과목 등 다른 축이 이 색을 쓰면 뜻이 겹친다.
 *
 * 캐논이 코드로 막지 못하는 유일한 구멍이 여기다: 과목 색은 학원설정이라 원장이 `SUBJECT_COLORS`에서
 * **초록도 고를 수 있다**(2026-08-18 확인. injaewon 현재 설정은 blue·rose·purple·gold라 충돌 없음).
 * 🔑 선택지에서 빼지 않는 이유 = 이미 그 색으로 저장한 학원이 있으면 Zod가 거절해 **학원설정 저장이
 * 통째로 막힌다**(fail-closed). 그래서 편집기가 경고만 띄운다
 * ([list-editors.tsx](<src/app/(shell)/owner/_components/list-editors.tsx>) SubjectListEditor).
 */
export const STATE_RESERVED_COLORS: ReadonlySet<PillColor> = new Set<PillColor>([
  TONE_COLOR.positive,
  TONE_COLOR.critical,
  TONE_COLOR.caution,
]);
