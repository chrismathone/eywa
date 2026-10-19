import { expect, it } from "vitest";
import { advicePrompt, adviceSchema } from "./advice";
import { agentPolicy } from "./policy";
import type { AgentCase } from "./model";
it("uses only allowlisted operational facts in AI input",()=>{
  const row={status:"open",source_due_on:"2026-10-19",source_done:false,episode:1,
    result_note:"PRIVATE_PARENT_REQUEST",verification_note:"PRIVATE_PHONE",student_id:"PRIVATE_ID",
    last_checked_at:"2026-10-19T00:00:00Z"} as AgentCase;
  expect(advicePrompt(row)).not.toContain("PRIVATE");
  expect(advicePrompt(row)).toContain("등록 전환");
});
it("rejects malformed or oversized generated advice",()=>{
  expect(adviceSchema.safeParse({summary:"상황",actions:[{}],verification:"확인"}).success).toBe(false);
  expect(adviceSchema.safeParse({summary:"상황",actions:["a","b","c","d"],verification:"확인"}).success).toBe(false);
});
it("defaults to off for missing or invalid settings",()=>{
  expect(agentPolicy(undefined).mode).toBe("off");
  expect(agentPolicy({mode:"active",reminderDays:-1}).mode).toBe("off");
});
