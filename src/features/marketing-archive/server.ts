import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { z } from "zod";
import type { MenuKey } from "@/lib/permissions";
import { ARCHIVE_TENANT, eventSchema, linkSchema, validateEvent, type EventRow, type SourceRow, type LinkRow } from "./model";

export async function archiveGate(write = false) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.tenantId !== ARCHIVE_TENANT || (write && !["master", "admin"].includes(user.systemRole))) throw Error("행사 자료 접근 권한을 확인해 주세요");
  const check = write ? canWriteTenant : canAccessTenant;
  const allowed = await Promise.all([check(user.systemRole, "marketing" as MenuKey), check(user.systemRole, "billing")]);
  if (allowed.some(a => !a)) throw Error("행사 자료 접근 권한을 확인해 주세요");
  return user;
}
export type ArchiveData = Awaited<ReturnType<typeof loadArchive>>;
export async function loadArchive() {
  const user = await archiveGate(), db = createAdminClient(), tenant = user.tenantId;
  const [events, sources, edges, links, staff, canWrite] = await Promise.all([
    fetchAllPaged<EventRow>((a,b) => db.from("marketing_archive_events").select("id,version,document,updated_at").eq("tenant_id",tenant).order("id").range(a,b)),
    fetchAllPaged<SourceRow>((a,b) => db.from("marketing_source_inbox").select("id,version,document,review_status,review_note,ingested_at").eq("tenant_id",tenant).order("id").range(a,b)),
    fetchAllPaged<{event_id:string;source_id:string}>((a,b) => db.from("marketing_archive_sources").select("event_id,source_id").eq("tenant_id",tenant).order("event_id").order("source_id").range(a,b)),
    fetchAllPaged<LinkRow>((a,b) => db.from("marketing_archive_students").select("id,version,event_id,student_id,document").eq("tenant_id",tenant).order("id").range(a,b)),
    db.from("users").select("id,display_name").eq("tenant_id",tenant).eq("status","active").order("display_name"),
    canWriteTenant(user.systemRole,"marketing" as MenuKey),
  ]);
  if (staff.error) throw Error("담당자 목록을 확인하지 못했습니다");
  return { events: events.map(e=>({...e,document:eventSchema.parse(e.document)})), sources, edges, links, staff:staff.data??[], canWrite:canWrite && ["master","admin"].includes(user.systemRole) && await canWriteTenant(user.systemRole,"billing"), today:kstToday() };
}
export const requestSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("event"),id:z.uuid().nullable(),version:z.number().int().min(0),document:eventSchema}).strict(),
  z.object({kind:z.literal("student"),id:z.uuid().nullable(),version:z.number().int().min(0),document:linkSchema}).strict(),
  z.object({kind:z.literal("source"),id:z.uuid(),version:z.number().int().positive(),document:z.object({status:z.enum(["review","reference","excluded","linked"]),eventId:z.uuid().nullable(),note:z.string().trim().min(2).max(2000)}).strict()}).strict(),
]);
export async function saveArchive(raw: unknown) {
  const user = await archiveGate(true), input = requestSchema.parse(raw);
  if(input.kind==="event") validateEvent(input.document,kstToday());
  if(input.kind==="student" && input.document.date>kstToday()) throw Error("실제 연락·참석일을 확인해 주세요");
  if(input.kind==="source" && input.document.status==="linked" && !input.document.eventId) throw Error("연결할 행사를 선택해 주세요");
  const {data,error}=await createAdminClient().rpc("save_marketing_archive",{p_tenant:user.tenantId,p_actor:user.id,p_kind:input.kind,p_id:input.id,p_version:input.version,p_document:input.document});
  if(error) throw Error(error.message==="archive_version_conflict"?"다른 담당자가 수정했습니다. 새로고침 후 확인해 주세요.":error.code==="23505"?"동일한 학생·행사·날짜·상태 기록이 있습니다.":"저장하지 못했습니다. 날짜·연결 대상·권한을 확인해 주세요.");
  return data;
}
export async function findArchiveStudents(query:string) {
  const user=await archiveGate(); const q=z.string().trim().min(1).max(50).parse(query).replace(/[%_,()]/g,"");
  if(!q)return [];
  const {data,error}=await createAdminClient().from("students").select("id,name,school,grade").eq("tenant_id",user.tenantId).eq("is_test",false).ilike("name",`%${q}%`).order("name").limit(20);
  if(error)throw Error("원생을 검색하지 못했습니다");
  return data??[];
}
