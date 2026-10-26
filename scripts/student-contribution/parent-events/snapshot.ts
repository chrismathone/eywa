import type { Sql } from "postgres";
import type { EventSiblingLink } from "../../../src/features/student-contribution/model/parent-events/types";
export type EventProfileRow = { id: string; tenant_id: string; name: string; parent_name: string | null; parent_phone: string | null;
  student_phone: string | null; school: string | null; grade: string | null; status: string; notes: string | null; is_test: boolean;
  enrolled_at: string | null; withdrawn_at: string | null; withdrawal_metadata: unknown };
export type EventDatabaseSnapshot = { tenantId: string; students: EventProfileRow[]; siblings: EventSiblingLink[];
  settings: { revision: number; config: unknown }[]; enrollments: { student_id: string; start_date: string; end_date: string | null }[] };
/** Caller supplies a read-only transaction for prepare, or a locked serializable transaction for apply. */
export async function readEventDatabase(sql: Pick<Sql, "unsafe">, tenantId: string): Promise<EventDatabaseSnapshot> {
  const read = async <T>(query: string) => (await sql.unsafe(`select to_jsonb(r) as data from (${query}) r`, [tenantId])).map(r => r.data as T);
  const students = await read<EventProfileRow>("select id,tenant_id,name,parent_name,parent_phone,student_phone,school,grade,status,notes,is_test,enrolled_at,withdrawn_at,withdrawal_metadata from public.students where tenant_id=$1 order by id");
  const siblings = await read<EventSiblingLink>("select student_a,student_b,linked from public.student_siblings where tenant_id=$1 order by student_a,student_b");
  const settings = await read<EventDatabaseSnapshot["settings"][number]>("select revision,config from public.student_contribution_settings where tenant_id=$1");
  const enrollments = await read<EventDatabaseSnapshot["enrollments"][number]>("select student_id,start_date,end_date from public.enrollments where tenant_id=$1 order by student_id,start_date,end_date,id");
  return { tenantId, students, siblings, settings, enrollments };
}
