import { z } from "zod";

export const ARCHIVE_TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
export const archiveTypes = ["설명회", "학원행사", "전단배부", "특수마케팅", "기타"] as const;
export const statuses = { review: "확인 필요", planned: "예정", held: "진행 확인", cancelled: "취소" } as const;
export const safeUrl = z.string().max(2000).refine(v => { try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } }, "https 원본 주소를 입력해 주세요");
export const executionSchema = z.object({ id:z.uuid(),channel:z.enum(["전단","현수막","문자","블로그","SNS","택배차","엘리베이터","행사운영","기타"]),target:z.string().max(500),date:z.iso.date().nullable(),ownerId:z.uuid().nullable(),plannedQuantity:z.number().int().min(0).nullable(),actualQuantity:z.number().int().min(0).nullable(),budget:z.number().int().min(0).max(1e12).nullable(),actualCost:z.number().int().min(0).max(1e12).nullable(),reference:z.string().max(2000),result:z.string().max(2000) }).strict();
export const workSchema=z.object({id:z.uuid(),title:z.string().trim().min(1).max(300),ownerId:z.uuid().nullable(),due:z.iso.date().nullable(),state:z.enum(["todo","doing","done"]),result:z.string().max(2000)}).strict();
export const eventSchema = z.object({
  title: z.string().trim().min(1).max(300), type: z.enum(archiveTypes), date: z.iso.date().nullable(), period:z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).nullable(),
  state: z.enum(["review", "planned", "held", "cancelled"]), time: z.string().max(100), location: z.string().max(500),
  speakers: z.string().max(1000), gift: z.string().max(1000), ownerId: z.uuid().nullable(),
  reservationRaw: z.string().max(1000), attendanceRaw: z.string().max(1000), compositionRaw: z.string().max(1000),
  reservations: z.number().int().min(0).max(100000).nullable(), attendees: z.number().int().min(0).max(100000).nullable(),
  budget: z.number().int().min(0).max(1e12).nullable(), actualCost: z.number().int().min(0).max(1e12).nullable(),
  costReference: z.string().max(2000), retrospective: z.string().max(6000), nextAction: z.string().max(3000),
  dateResolution: z.string().max(1000), referenceEventId: z.uuid().nullable(),
  objective:z.enum(["acquisition","retention","cross_subject","brand"]),audience:z.string().max(1000),purpose:z.string().max(3000),brief:z.string().max(6000),
  enrollmentGoal:z.number().int().min(0).nullable(),executions:z.array(executionSchema).max(100),work:z.array(workSchema).max(100),
  raw: z.record(z.string(), z.unknown()),
}).strict();
export type EventDocument = z.infer<typeof eventSchema>;
export type EventRow = { id: string; version: number; document: EventDocument; updated_at: string };
export type SourceRow = { id: string; version: number; document: { provider: string; id: string; title: string; url: string; date: string; dateKind: string; type: string; status: string; [key: string]: unknown }; review_status: string; review_note: string | null; ingested_at: string };
export const linkSchema = z.object({ eventId: z.uuid(), studentId: z.uuid(), date: z.iso.date(), kind: z.enum(["invited", "reserved", "attended", "no_show", "test_reserved", "consulted"]), reference: z.string().trim().min(2).max(2000), result: z.string().max(2000), nextAction: z.string().max(1000) }).strict();
export type LinkRow = { id: string; version: number; event_id: string; student_id: string; document: z.infer<typeof linkSchema> };
export const linkLabels = { invited: "초대", reserved: "참석 예약", attended: "참석", no_show: "불참", test_reserved: "입학테스트 예약", consulted: "상담 완료" } as const;
export function plain(value: unknown): string { return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\\([~*-])/g, "$1").trim() : ""; }
export function titleDate(title: string): string | null {
  const m = plain(title).match(/^(2\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (!m) return null;
  const result = `20${m[1]}-${m[2]}-${m[3]}`;
  return z.iso.date().safeParse(result).success ? result : null;
}
export function dateConflict(d: EventDocument): boolean { const inferred = titleDate(plain(d.raw["설명회명 및 날짜"]) || d.title); return !!inferred && !!d.date && inferred !== d.date && !d.dateResolution.trim(); }
export function validateEvent(d: EventDocument, today: string) {
  if (d.actualCost !== null && !d.costReference.trim()) throw Error("실제 비용의 지급·배부 근거를 입력해 주세요");
  if (d.state === "held" && (!d.date || d.date > today || dateConflict(d))) throw Error("진행일과 날짜 충돌을 먼저 확인해 주세요");
  if(d.executions.some(x=>x.actualCost!==null&&!x.reference.trim()))throw Error("채널별 실제 비용에도 지급·배부 근거가 필요합니다");
  if(d.work.some(x=>x.state==="done"&&!x.result.trim()))throw Error("완료한 준비업무의 결과를 남겨 주세요");
  if(d.actualCost!==null&&d.executions.some(x=>x.actualCost!==null))throw Error("총비용 직접 입력과 채널별 비용을 함께 합산할 수 없습니다. 한 방식을 선택해 주세요");
}
export function exactCount(raw: unknown): number | null { const text = plain(raw); return /^\d+$/.test(text) ? Number(text) : null; }
export function fromNotion(row: Record<string, unknown>): EventDocument {
  const title = plain(row["설명회명 및 날짜"]); const date = plain(row["date:날짜:start"]).slice(0, 10);
  return eventSchema.parse({ ...blankEvent(), title, date: z.iso.date().safeParse(date).success ? date : null,period:z.iso.date().safeParse(date).success?date.slice(0,7):null,
    type: archiveTypes.includes(row["유형"] as typeof archiveTypes[number]) ? row["유형"] : "기타",
    time: plain(row["시간"]), location: plain(row["진행장소"]), speakers: plain(row["연사자(순서대로)"]), gift: plain(row["참가자 선물"]),
    reservationRaw: plain(row["예약인원"]), attendanceRaw: plain(row["참석인원"]), compositionRaw: plain(row["재원생/비재원생"]), raw: row,
  });
}
export function blankEvent(): EventDocument { return { title: "", type: "설명회", date: null, period:null,state: "review", time: "", location: "", speakers: "", gift: "", ownerId: null, reservationRaw: "", attendanceRaw: "", compositionRaw: "", reservations: null, attendees: null, budget: null, actualCost: null, costReference: "", retrospective: "", nextAction: "", dateResolution: "", referenceEventId: null, raw: {},objective:"acquisition",audience:"",purpose:"",brief:"",enrollmentGoal:null,executions:[],work:[] }; }
export function archiveMonth(event: EventRow): string | null {
  return dateConflict(event.document) ? null : (event.document.date ?? event.document.period)?.slice(0, 7) ?? null;
}
export function planNextYear(event: EventRow, year: number): EventDocument {
  const date = event.document.date ? `${year}${event.document.date.slice(4)}` : null;
  const month = archiveMonth(event);
  return { ...blankEvent(), title: plain(event.document.title).replace(/^\d{6}\s*/, ""), type: event.document.type, date: date && z.iso.date().safeParse(date).success ? date : null, period:month?`${year}${month.slice(4)}`:null,state: "planned", referenceEventId: event.id };
}
export function summary(events: EventRow[], links: LinkRow[]) {
  return { total: events.length, conflicts: events.filter(e => dateConflict(e.document)).length, held: events.filter(e => e.document.state === "held").length, linkedStudents: new Set(links.map(l => l.student_id)).size, costKnown: events.filter(e => e.document.actualCost !== null).length };
}
export type EnrollmentFact={id:string;name:string;enrolledAt:string|null;firstClass:string|null};
export function conversionFacts(events:EventRow[],links:LinkRow[],people:EnrollmentFact[]){
  const facts:{eventId:string;studentId:string;name:string;date:string;weight:number}[]=[];
  for(const p of people){
    if(!p.enrolledAt||!p.firstClass||p.firstClass<p.enrolledAt)continue;
    const eligible=events.filter(e=>e.document.state==="held"&&!dateConflict(e.document)&&e.document.date&&e.document.objective==="acquisition"&&p.enrolledAt!>=e.document.date&&Date.parse(p.enrolledAt!)-Date.parse(e.document.date)<=90*86400000&&links.some(l=>l.event_id===e.id&&l.student_id===p.id&&["attended","consulted"].includes(l.document.kind)&&l.document.date<=p.enrolledAt!));
    for(const e of eligible)facts.push({eventId:e.id,studentId:p.id,name:p.name,date:p.enrolledAt,weight:1/eligible.length});
  }return facts;
}
export function campaignCost(d:EventDocument):number|null{
  if(d.executions.length)return d.executions.every(x=>x.actualCost!==null)?d.executions.reduce((n,x)=>n+x.actualCost!,0):null;
  return d.actualCost;
}
