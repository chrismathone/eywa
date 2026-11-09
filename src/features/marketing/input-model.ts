import { z } from "zod";
import { channels } from "./model";

export const inputContextSchema = z.object({ type: z.enum(["consultation", "student"]), id: z.uuid() }).strict();
export type InputContext = z.infer<typeof inputContextSchema>;
export const inputDocumentSchema = z.object({
  kind: z.enum(["inquiry", "invited", "attended"]),
  channel: z.enum(Object.keys(channels) as [keyof typeof channels, ...(keyof typeof channels)[]]),
  date: z.iso.date(), basis: z.enum(["self_report", "staff_record", "qr"]),
  reference: z.string().trim().min(2, "학부모 응답이나 확인한 근거를 적어 주세요").max(1000),
  unknownReason: z.string().trim().max(300),
}).strict();
export const submitInputSchema = z.object({
  id: z.uuid(), context: inputContextSchema, campaignId: z.uuid().nullable(), document: inputDocumentSchema,
}).strict().superRefine((v, c) => {
  if (v.context.type === "student" && v.document.kind === "inquiry") c.addIssue({ code: "custom", message: "신규 문의는 입학상담 기록에 연결해 주세요" });
  if (!v.campaignId && (v.document.kind !== "inquiry" || !v.document.unknownReason)) c.addIssue({ code: "custom", message: "행사를 선택하거나, 유입 행사를 확인하지 못한 이유를 적어 주세요" });
});
export const reviewInputSchema = z.object({
  id: z.uuid(), expectedVersion: z.number().int().positive(), action: z.enum(["approve", "reject"]),
  campaignId: z.uuid().nullable(), note: z.string().trim().min(2, "확인 또는 보완 요청 사유를 적어 주세요").max(1000),
}).strict().superRefine((v, c) => {
  if (v.action === "approve" && !v.campaignId) c.addIssue({ code: "custom", message: "확정할 행사를 선택해 주세요" });
});
export type InputDocument = z.infer<typeof inputDocumentSchema>;
export type MarketingInputRecord = {
  id: string; campaign_id: string | null; student_id: string | null; consultation_id: string | null;
  actor_id: string; document: InputDocument; status: "submitted" | "approved" | "rejected";
  version: number; created_at: string; reviewed_at: string | null; reviewer_id: string | null;
  review_note: string | null; touch_id: string | null;
};
export type CampaignChoice = { id: string; title: string; channel: keyof typeof channels; start: string; end: string };
export type InputData = { context: InputContext; label: string; today: string; campaigns: CampaignChoice[]; records: MarketingInputRecord[]; legacyPath: string | null };
export const inputKindLabels = { inquiry: "신규 문의", invited: "행사 초대", attended: "실제 참석" } as const;
export const inputStatusLabels = { submitted: "확인 대기", approved: "접점 반영 완료", rejected: "보완 요청" } as const;
