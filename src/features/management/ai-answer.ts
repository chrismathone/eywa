import { z } from "zod";

/** 경영 분석 AI 검토 답의 모양 — 서버 검증·DB 보관·화면이 같이 쓴다. */
export const aiAnswerSchema = z.object({
  summary: z.string().max(1500),
  findings: z.array(z.object({ statement: z.string().max(600), kind: z.enum(["관찰", "가설"]), metricIds: z.array(z.string()).min(1).max(5), nextAction: z.string().max(600) }).strict()).max(6),
  missingData: z.array(z.string().max(300)).max(8),
}).strict();
export type AiAnswer = z.infer<typeof aiAnswerSchema>;
export type AiReview = { answer: AiAnswer; model: string; createdAt: string; factsObservedAt: string };
