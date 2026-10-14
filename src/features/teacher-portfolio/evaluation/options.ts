/**
 * 지표만의 '세는 법' — 점수 규칙(만점·구간)과 달리 **무엇을 세는지**를 바꾼다(원장 *"가능한 모든것을 커스터마이징"*).
 * 퇴원율(churn)·원생 소개(expansion)만 있다. 설정(config.ts)이 이 스키마로 검증하고, 계산 코드가 읽는다.
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
