import { z } from "zod";
export const AgentLogRequest=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),module:z.enum(["all","app","classnote","makeedu","video","update"]).default("all"),level:z.enum(["all","warning","error"]).default("all"),cursor:z.object({at:z.string().datetime(),id:z.string().uuid()}).strict().optional()}).strict();
export function kstLogRange(date?:string,now=Date.now()) {
  const day=date??new Date(now+9*3600_000).toISOString().slice(0,10);
  const start=new Date(day+"T00:00:00+09:00");
  if(!Number.isFinite(start.getTime())||new Date(start.getTime()+9*3600_000).toISOString().slice(0,10)!==day)throw Error("로그 날짜를 확인해 주세요.");
  return {day,start:start.toISOString(),end:new Date(start.getTime()+86400_000).toISOString()};
}
