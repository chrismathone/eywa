import { z } from "zod";

export const caseCommandSchema = z.object({
  caseId: z.string().uuid(),
  version: z.number().int().positive(),
  command: z.enum(["acknowledge", "submit", "verify", "dismiss", "reopen"]),
  result: z.enum(["contacted", "retry", "decision"]).nullable().default(null),
  note: z.string().trim().max(1000).default(""),
  nextCheckOn: z.iso.date().nullable().default(null),
}).superRefine((v, ctx) => {
  if (v.command !== "acknowledge" && v.note.length < 10)
    ctx.addIssue({ code: "custom", path: ["note"], message: "처리 내용 또는 판단 근거를 10자 이상 적어 주세요." });
  if (v.command === "submit" && !v.result)
    ctx.addIssue({ code: "custom", path: ["result"], message: "처리 결과를 선택해 주세요." });
  if (v.command === "submit" && v.result === "retry" && !v.nextCheckOn)
    ctx.addIssue({ code: "custom", path: ["nextCheckOn"], message: "다음 연락일을 선택해 주세요." });
});
export type CaseCommand = z.infer<typeof caseCommandSchema>;
