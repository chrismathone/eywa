/**
 * 강사평가 점수 규칙의 모양 — 구간표 · 비례 · 건당 점수 · 자료가 없을 때. `config.ts`가 다시 내보낸다(설정·미리보기·계산이 같은 스키마).
 * 순수 모듈(서버·클라이언트 공용).
 */
import { z } from "zod";

export const finite = z.number().finite();
/** 기준·점수 칸 — 총점 칸(numeric(8,1))이 넘치지 않게 범위를 둔다. */
const bounded = finite.min(-1_000_000, "100만 이하로 적어 주세요").max(1_000_000, "100만 이하로 적어 주세요");
/** 구간 — 위에서부터 처음 맞는 구간의 점수. 양 끝 포함, 비우면 끝이 없다. */
export const bandSchema = z.object({ from: bounded.nullable(), to: bounded.nullable(), points: bounded });
export const scoringSchema = z.discriminatedUnion("mode", [
  /** 수치가 `zero`면 0점, `full`이면 만점, 사이는 비례(밖은 0~만점으로 자른다). 낮을수록 좋은 지표는 zero > full. */
  z.object({ mode: z.literal("linear"), zero: bounded, full: bounded }),
  z.object({ mode: z.literal("bands"), bands: z.array(bandSchema).min(1).max(20) }),
  /** 1건(1 단위)마다 점수. `cap`이면 만점에서 멈춘다. */
  z.object({ mode: z.literal("perUnit"), points: bounded, cap: z.boolean() }),
]);
export type Scoring = z.infer<typeof scoringSchema>;
export type Band = z.infer<typeof bandSchema>;

/** 자료가 없을 때 — 0점(원장 기본) · 만점 · 합계에서 빼기(만점에서도 뺀다). */
export const missingSchema = z.enum(["zero", "full", "exclude"]);
export type MissingRule = z.infer<typeof missingSchema>;
export const MISSING_LABEL: Record<MissingRule, string> = { zero: "0점", full: "만점", exclude: "합계에서 빼기" };
