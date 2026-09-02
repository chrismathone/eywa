/**
 * 등록상담 **시트형 목록뷰**의 칸 규약 — 순수 함수(Vitest).
 *
 * 원장 2026-09-02: *"우리 칸반뷰를 시트처럼 목록뷰화"* — 참고 원본은 옛 콜앤상담 구글시트의
 * `2025.6월 입학상담`·`2025.7월 입학상담` 탭(다른 탭 아님). 그 탭의 열(상태·콜일자·번호·학생이름·전화번호·
 * 문의내용·학교·학년·상담 내용·전화수신자·유입경로·상담자·상담일자/요일·주소·결제일·비고)은 전부 우리
 * `enrollment_consultations`의 기존 컬럼에 대응한다(실DB 확인 2026-09-02 — 새 컬럼 0, [[#95]] 무관).
 * 여기는 그 열의 **표기 규칙**만 둔다.
 *
 * 🔴 상태는 `outcome` **원값**이다(브리프: 목록뷰는 원값을 보여 주는 자리 — 칸반 4칸으로 뭉개지 말 것).
 *    라벨·색은 [outcome-meta](./outcome-meta.ts) 단일 소스에서 오고, '반 배정 완료'는 outcome이 아니라
 *    수강에서 나오는 파생값이라 [board-stages](./board-stages.ts)의 상수를 쓴다. 여기서 라벨·색 맵을 새로
 *    만들지 않는다(화면 파일의 STATUS_META 금지 규약과 같은 이유).
 * ⚠️ 일반 모듈이어야 한다 — 클라(표)와 테스트가 같이 읽는다(`server-only` 금지, [[#61]]).
 */
import type { PillColor } from "@/components/atoms/pill";
import { KNOWN_SUBJECT_KEYS } from "@/features/owner/subjects";
import { kstDateOf, weekdayIndexOf } from "@/lib/date-kst";
import { ASSIGNED_LABEL } from "./board-stages";
import { OUTCOME_PILL, outcomePill } from "./outcome-meta";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "YYYY-MM-DD" → "M/D" (시트의 콜일자·결제일 표기). 날짜 형식이 아니면 null — 없는 날짜를 지어내지 않는다. */
export function sheetDate(ymd: string | null | undefined): string | null {
  if (!ymd || !YMD.test(ymd)) return null;
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
}

/** "YYYY-MM-DD" → "M/D (월)" — 시트의 상담일자·요일 두 칸을 한 칸으로(요일은 UTC 파싱이라 서버 TZ 무관). */
export function sheetDateDow(ymd: string | null | undefined): string | null {
  const base = sheetDate(ymd);
  if (!base || !ymd) return null;
  return `${base} (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

/**
 * 콜일자 = 접수일(`received_date`) → 없으면 접수 시각(`consulted_at`)의 **KST 날짜**.
 * 옛 시트의 '콜일자'가 곧 접수일이고, QR·수기 등록은 received_date가 비어 있어 consulted_at이 그 역할을 한다
 * (실측 최근 6개월: received_date 97/168). 🔴 `consulted_at.slice(0, 10)`은 UTC 날짜라 새벽 접수가 하루
 * 밀린다 — kstDateOf를 탄다.
 */
export function callDateOf(row: { receivedDate: string | null; consultedAt: string }): string | null {
  return row.receivedDate ?? kstDateOf(row.consultedAt);
}

/** 한 글자 축약 — 시트에서 "영+수"처럼 적던 표기. 표준 사전의 한글명으로 편 뒤 키로 간다. */
const SHORT_SUBJECT: Record<string, string> = { 영: "영어", 수: "수학", 국: "국어", 과: "과학" };

/**
 * 과목 칸 토막 — 자유 표기("영어, 수학"·"영+수"·"EiE"·"math")를 토막으로 나누고, 한글 과목명은 표준 키로
 * 바꾼다(그래야 학원설정의 과목 색·라벨이 붙는다 — `useSubjectMaps().labelOf/colorOf`). 모르는 표기는
 * **그대로** 둔다(EiE·프로그램명 같은 것 — 색만 없고 글자는 산다). 빈 값은 빈 배열.
 * ⚠️ 실측(최근 6개월): 키(`math`·`english`)와 한글(`수학`·`영어`·`영어, 수학`)이 반반 섞여 있다 —
 *    옛 시트 이관분이 한글이고 앱 폼 저장분이 키다. 그래서 둘 다 받는다.
 */
export function subjectTokens(subject: string | null | undefined): string[] {
  if (!subject) return [];
  return subject
    .split(/[,/·+&]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const full = SHORT_SUBJECT[t] ?? t;
      return KNOWN_SUBJECT_KEYS[full] ?? full;
    });
}

/** 결제 금액(numeric 문자열) → "300,000원". 숫자가 아니면 원문 그대로(지어내지 않는다). */
export function wonLabel(v: string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${n.toLocaleString("ko-KR")}원`;
}

/**
 * 비고 칸 줄들 — 옛 시트의 '비고'에 사람이 적던 것(후속 조치·미등록 사유)을 순서대로.
 * 빈 값은 줄을 만들지 않는다(좁은 화면 카드에서 빈 칸이 사라지는 규약과 맞물린다).
 */
export function noteLines(row: {
  followUpDate: string | null;
  followUpContent: string | null;
  nonRegistrationReason: string | null;
}): string[] {
  const out: string[] = [];
  const when = sheetDate(row.followUpDate);
  const what = row.followUpContent?.trim();
  if (when || what) out.push(`조치${when ? ` ${when}` : ""}${what ? ` · ${what}` : ""}`);
  const why = row.nonRegistrationReason?.trim();
  if (why) out.push(`미등록 사유: ${why}`);
  return out;
}

/** 상태 범례(시트 1~2행의 색 범례에 해당) — outcome 원값 순서 그대로 + 파생 '반 배정 완료'. */
export const SHEET_LEGEND: { label: string; color: PillColor }[] = [
  ...Object.values(OUTCOME_PILL),
  { label: ASSIGNED_LABEL, color: "primary" },
];

/** 상태 칸 — 🔴 배정(수강 ≥ 1)이 outcome을 이긴다(칸반 `stageOfCard`·옛 목록 표와 같은 규칙). */
export function statusCellOf(row: { outcome: string; assignedClassCount: number }): {
  label: string;
  color: PillColor;
} {
  if (row.assignedClassCount >= 1) return { label: ASSIGNED_LABEL, color: "primary" };
  return outcomePill(row.outcome);
}
