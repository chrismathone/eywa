import { z } from "zod";
export const completionSchema=z.object({action:z.string().trim().min(2,"실행한 액션을 남겨 주세요").max(80),result:z.string().trim().min(2,"처리 결과를 남겨 주세요").max(120),next:z.string().trim().max(60)}).strict();
export type Completion=z.infer<typeof completionSchema>;
export function completionMemo(input:unknown){const c=completionSchema.parse(input);return `수행: ${c.action}\n결과: ${c.result}${c.next?`\n후속: ${c.next}`:""}`;}
