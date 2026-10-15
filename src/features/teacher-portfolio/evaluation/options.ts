/**
 * 지표만의 '세는 법' — 점수 규칙(만점·구간)과 달리 **무엇을 세는지**를 바꾼다(원장 *"가능한 모든것을 커스터마이징"*).
 * 퇴원율(churn)·원생 소개(expansion)·성적 관리(grades)·학부모 만족도(satisfaction)·강사 근태(punctuality). 설정(config.ts)이 이 스키마로 검증하고, 계산 코드가 읽는다.
 */
import { z } from "zod";

/** 퇴원율의 세는 법(원장 결정 6) — 뺄 퇴원 사유 코드 · 수강종료(다른 과목은 다님)도 셀지. */
export const churnOptionsSchema = z.object({
  excludeReasons: z.array(z.string().regex(/^[a-z]{1,20}$/)).max(20),
  countEnded: z.boolean(),
});
export type ChurnOptions = z.infer<typeof churnOptionsSchema>;
export const DEFAULT_CHURN_OPTIONS: ChurnOptions = { excludeReasons: ["graduated", "relocation", "illness", "advised"], countEnded: true };

/**
 * 원생 소개의 세는 법(원장 결정 7) — 소개한 원생의 **상담일 담임 누구에게** 1건을 주나.
 * `all` = 그 원생의 담임 전원(여러 과목이면 모두) · `sameSubject` = 상담 과목과 같은 과목 반의 담임만(없으면 전원).
 * 직원이 직접 소개했으면 늘 그 직원이다.
 */
export const referralOptionsSchema = z.object({ attribution: z.enum(["all", "sameSubject"]) });
export type ReferralOptions = z.infer<typeof referralOptionsSchema>;
export const DEFAULT_REFERRAL_OPTIONS: ReferralOptions = { attribution: "all" };
export const REFERRAL_ATTRIBUTION_LABEL: Record<ReferralOptions["attribution"], string> = {
  all: "그 원생의 담임 전원(여러 과목이면 모두)",
  sameSubject: "상담 과목과 같은 과목 반의 담임만(없으면 전원)",
};

/**
 * 성적 관리의 세는 법(원장 결정 10 · 계획서 '성적 하위 항목 비중') — 시험 종류별 비중. 종류마다 평균 점수율을 낸 뒤 이 비중으로 가중 평균한다.
 * 0 = 그 종류는 세지 않는다. 기본 = 모두 1(시험이 있는 종류끼리 똑같이).
 */
const weight = z.number().finite().min(0, "비중은 0 이상입니다").max(10, "비중은 10까지입니다");
export const gradesOptionsSchema = z.object({
  weights: z.object({ daily: weight, check: weight, monthly: weight, school: weight, other: weight }),
});
export type GradesOptions = z.infer<typeof gradesOptionsSchema>;
export const DEFAULT_GRADES_OPTIONS: GradesOptions = { weights: { daily: 1, check: 1, monthly: 1, school: 1, other: 1 } };

/**
 * 학부모 만족도의 세는 법(계획서 3번 · 원장 결정 8) — 가점·감점 문구(문구별 점수) · 무시 문구(인사) · 완곡어 · 긴 글 기준 · AI 쓰는 범위 ·
 * 문구 없이 판정한 것(AI·사람 확인)의 점수. 판정 = `model/satisfaction-rules.ts`.
 */
const phrase = z.string().trim().min(1, "문구를 적어 주세요").max(30, "문구는 30자까지입니다");
const phrasePoints = z.number().finite().min(-100, "점수는 −100~100입니다").max(100, "점수는 −100~100입니다");
export const satisfactionOptionsSchema = z.object({
  positive: z.array(z.object({ phrase, points: phrasePoints })).max(50),
  negative: z.array(z.object({ phrase, points: phrasePoints })).max(50),
  ignore: z.array(phrase).max(50),
  hedges: z.array(phrase).max(30),
  longChars: z.number().int().min(10).max(1000),
  ai: z.enum(["off", "ambiguous", "all"]),
  plusPoints: phrasePoints,
  minusPoints: phrasePoints,
});
export type SatisfactionOptions = z.infer<typeof satisfactionOptionsSchema>;
const pts = (points: number) => (p: string) => ({ phrase: p, points });
/**
 * 기본 문구 — 2026-08~10 학부모 글 781건(출결 연락 제외)에 대 본 값(2026-10-15): '칭찬'은 대부분 "집에서 칭찬해 주겠다"는 답이라 빼고
 * '칭찬해 주셔서'만 · '고생하셨습니다'는 인사 · '걱정'·'아쉽'은 아이 이야기가 많아 뺐다(긴 글은 AI·사람이 본다).
 */
export const DEFAULT_SATISFACTION_OPTIONS: SatisfactionOptions = {
  positive: ["덕분", "만족", "감동", "최고", "신경 써 주셔서", "꼼꼼", "세심", "잘 가르쳐", "칭찬해 주셔서", "애써 주셔서", "믿고 맡"].map(pts(1)),
  negative: [...["불만", "실망", "불친절", "서운", "불편"].map(pts(-1)), ...["환불", "그만두", "그만 다니", "끊겠", "옮기려", "항의"].map(pts(-2))],
  ignore: ["감사합니다", "감사드립니다", "고맙습니다", "수고하세요", "수고하셨습니다", "고생하셨습니다", "고생 많으셨", "알겠습니다", "확인했습니다", "부탁드립니다"],
  hedges: ["혹시", "조금", "약간", "궁금", "괜찮을까요"],
  longChars: 80,
  ai: "ambiguous",
  plusPoints: 1,
  minusPoints: -1,
};
export const SATISFACTION_AI_LABEL: Record<SatisfactionOptions["ai"], string> = {
  off: "문구만(애매한 글은 사람이 확인)",
  ambiguous: "문구 + 애매한 글은 AI가 먼저 읽기(반영은 사람이 확인)",
  all: "문구에 안 걸린 글은 모두 AI가 먼저 읽기(반영은 사람이 확인)",
};

/**
 * 강사 근태의 세는 법(원장 2026-10-15 *"추천으로 진행. 직원마다 일부 출근시간 퇴근시간 다른 직원이 있음"*) — 메이크에듀는 출퇴근 시각만 남기므로
 * 기준 시각을 aywa가 정한다: 그날 맡은 첫 수업 시작(− `beforeMinutes`분)까지 출근 · 마지막 수업 끝 전에 퇴근하면 조퇴. 출퇴근 시각이 따로
 * 정해진 직원은 `hours`(요일별 출근·퇴근)가 그날의 기준이다. 지각·결근·조퇴 한 번을 몇 회로 셀지는 가중. 연차·결재된 휴가·휴원일은 늘 뺀다.
 * ⚠️ 새 칸은 기본값이 있어야 한다 — 저장된 설정(지각·결근 가중만 있던 모양)이 검증에 떨어지면 그 지표가 통째로 기본값으로 돌아간다.
 */
const times = z.number().finite().min(0, "0 이상입니다").max(10, "10까지입니다");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시각은 00:00 모양입니다");
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const WEEKDAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
export const staffHoursSchema = z.object({
  userId: z.string().uuid(), days: z.array(z.enum(WEEKDAYS)).min(1).max(7), start: hhmm, end: hhmm.nullable(),
});
export type StaffHours = z.infer<typeof staffHoursSchema>;
export const punctualityOptionsSchema = z.object({
  late: times, absent: times, early: times.default(1),
  beforeMinutes: z.number().int().min(0).max(240).default(0),
  /** 이 분까지는 지각·조퇴로 세지 않는다(21:02 퇴근 · 21:05 기준 같은 몇 분 차이 — 실데이터 2026-10-15). */
  graceMinutes: z.number().int().min(0).max(60).default(5),
  hours: z.array(staffHoursSchema).max(200).default([]),
});
export type PunctualityOptions = z.infer<typeof punctualityOptionsSchema>;
export const DEFAULT_PUNCTUALITY_OPTIONS: PunctualityOptions = { late: 1, absent: 1, early: 1, beforeMinutes: 0, graceMinutes: 5, hours: [] };
