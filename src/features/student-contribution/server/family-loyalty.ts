import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isMergedStudent } from "@/features/students/status/merged";
import { personName, phoneKeyOf } from "@/features/enrollment/same-person";
import { getContributionGate } from "./access";
import { readableFactStudents } from "./fact-access";
import { buildFamilyLoyalty, unknownFamily, type FamilyStudent, type FamilyLink, type FamilyLoyalty } from "../model/family-loyalty";

/** Per-request batch; contact details never leave this module. Never cache across users. */
export const getFamilyLoyaltyDirectory = cache(async () => {
  const gate = await getContributionGate(), asOf = kstToday();
  if (!gate) return { byStudent: new Map<string, FamilyLoyalty>(), fallback: unknownFamily(asOf, "restricted") };
  const readable = await readableFactStudents();
  // Even a sibling count can disclose a student outside a teacher's scope.
  if (readable !== null) return { byStudent: new Map<string, FamilyLoyalty>(), fallback: unknownFamily(asOf, "restricted") };
  try {
    const db = createAdminClient(), tenant = gate.tenantId;
    const [students, links, enrollments, classes] = await Promise.all([
      fetchAllPaged<FamilyStudent & { is_test: boolean; notes: string | null }>((a,b) => db.from("students")
        .select("id,name,status,enrolled_at,withdrawn_at,parent_name,parent_phone,is_test,notes").eq("tenant_id",tenant).order("id").range(a,b)),
      fetchAllPaged<FamilyLink>((a,b) => db.from("student_siblings").select("student_a,student_b,linked").eq("tenant_id",tenant).order("student_a").order("student_b").range(a,b)),
      fetchAllPaged<{ student_id: string; class_id: string; on_hold: boolean; is_transferred: boolean }>((a,b) => db.from("enrollments")
        .select("student_id,class_id,on_hold,is_transferred").eq("tenant_id",tenant).lte("start_date",asOf).or(`end_date.is.null,end_date.gte.${asOf}`).order("id").range(a,b)),
      fetchAllPaged<{ id: string; is_makeup_pool: boolean; closed_at: string | null }>((a,b) => db.from("classes")
        .select("id,is_makeup_pool,closed_at").eq("tenant_id",tenant).order("id").range(a,b)),
    ]);
    const validClasses = new Set(classes.filter(c => !c.is_makeup_pool && (!c.closed_at || c.closed_at >= asOf)).map(c => c.id));
    const active = new Set(enrollments.filter(e => !e.on_hold && !e.is_transferred && validClasses.has(e.class_id)).map(e => e.student_id));
    const visible = students.filter(s => !s.is_test && !isMergedStudent(s.notes));
    const byId = new Map(visible.map(s=>[s.id,s]));
    const phones = new Map<string, FamilyStudent[]>(), names = new Map<string, FamilyStudent[]>(), pairs = new Map<string, FamilyLink[]>();
    for (const s of visible) {
      const phone=phoneKeyOf(s.parent_phone), name=personName(s.parent_name);
      if(phone)phones.set(phone,[...phones.get(phone)??[],s]);
      if(name.length>=2)names.set(name,[...names.get(name)??[],s]);
    }
    for(const link of links)for(const id of [link.student_a,link.student_b])pairs.set(id,[...pairs.get(id)??[],link]);
    return { byStudent: new Map(visible.map(s => {
      const ownLinks=pairs.get(s.id)??[];
      const manual=ownLinks.flatMap(l=>[byId.get(l.student_a===s.id?l.student_b:l.student_a)]).filter((x):x is typeof s=>!!x);
      const candidates=[s,...phones.get(phoneKeyOf(s.parent_phone)??"")??[],...names.get(personName(s.parent_name))??[],...manual];
      return [s.id,buildFamilyLoyalty(s.id,candidates,ownLinks,active,asOf)];
    })), fallback: unknownFamily(asOf) };
  } catch {
    return { byStudent: new Map<string, FamilyLoyalty>(), fallback: unknownFamily(asOf) };
  }
});
export const getFamilyLoyalty = async (studentId: string) => {
  const data = await getFamilyLoyaltyDirectory();
  return data.byStudent.get(studentId) ?? data.fallback;
};
