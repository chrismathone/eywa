import { z } from "zod";
import { EXPLORER_KINDS, type ExplorerKind } from "./explorer";
import { studentFilters, writeStudentFilters, type StudentFilters, type StudentFilterParams } from "@/features/student-contribution/model/student-filters";
import { isMonth } from "@/features/student-contribution/model/dates";

export const LIVE_SCOPE_VERSION = "student-current-scope-v1";
export type LiveScopeRequest = { kind: ExplorerKind; id: string; page: number; month?: string } & StudentFilters;
export type LiveScopeParams = { kind?: string; entity?: string; page?: string; month?: string } & StudentFilterParams;
export function liveScopeRequest(raw: LiveScopeParams, tenant: string): LiveScopeRequest {
  const kind = EXPLORER_KINDS.includes(raw.kind as ExplorerKind) ? raw.kind as ExplorerKind : "academy";
  const requested = Number(raw.page);
  return { ...studentFilters(raw), ...(raw.month && isMonth(raw.month) ? { month: raw.month } : {}), kind, id: kind === "academy" ? tenant : (raw.entity ?? "").slice(0, 100),
    page: Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 100_000) : 1 };
}
export function liveScopeHref(request: LiveScopeRequest, embed = false) {
  const params = new URLSearchParams({ view: "current", kind: request.kind, entity: request.id });
  writeStudentFilters(params, request);
  if (request.month) params.set("month", request.month);
  if (request.page > 1) params.set("page", String(request.page));
  if (embed) params.set("embed", "1");
  return `/student-contribution/ontology?${params}`;
}

const count = z.number().int().nonnegative(), id = z.string().min(1), day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assignment = z.object({ role: z.enum(["homeroom", "scheduledTeacher", "delegatedTeacher"]), teacherId: id, name: z.string(), sourceId: id });
export const liveScopeSchema = z.object({
  version: z.literal(LIVE_SCOPE_VERSION), asOf: day, checkedAt: z.string(),
  total: count, filteredTotal: count, classCount: count, teacherCount: count, subjectCount: count, unassignedClasses: count, unresolvedAssignments: count,
  page: z.number().int().positive(), pageSize: z.literal(20),
  options: z.array(z.object({ kind: z.enum(EXPLORER_KINDS), id, label: z.string(), students: count })),
  connections: z.array(z.object({ kind: z.enum(EXPLORER_KINDS), id, label: z.string(), students: count })),
  students: z.array(z.object({ id, name: z.string(), school: z.string().nullable(), grade: z.string().nullable(),
    classes: z.array(z.object({ id, name: z.string(), subject: z.string(), onHold: z.boolean(),
      enrollmentIds: z.array(id).min(1), teachers: z.array(assignment) })) })),
});
export type LiveScopeData = z.infer<typeof liveScopeSchema>;

/** Reject malformed/mis-scoped RPC results instead of displaying plausible zero counts. */
export function validateLiveScope(value: unknown, allowedStudents: ReadonlySet<string>) {
  const data = liveScopeSchema.parse(value);
  if (data.filteredTotal > data.total || data.students.length > 20 || data.students.length > data.filteredTotal
    || data.students.some((s) => !allowedStudents.has(s.id)) || new Set(data.students.map((s) => s.id)).size !== data.students.length
    || data.options.some((o) => o.kind === "student" && !allowedStudents.has(o.id))
    || data.connections.some((o) => o.kind === "student" && !allowedStudents.has(o.id))) throw new Error("Current relation scope mismatch");
  return data;
}
