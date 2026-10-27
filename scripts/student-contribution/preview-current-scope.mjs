/** Review-only SQL preview, enforced by BEGIN READ ONLY. Does not install the proposed RPC. */
// node --import tsx --env-file=<local-env> scripts/student-contribution/preview-current-scope.mjs
import postgres from "postgres";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { contributionRoster } from "../../src/features/student-contribution/model/roster.ts";
import { buildStudentIdentityIndex } from "../../src/features/students/ontology/identity-index.ts";
import { isEnrollmentOnRosterOn } from "../../src/features/enrollments/eligibility.ts";
import { validateLiveScope } from "../../src/features/students/ontology/live-scope.ts";
import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";
const connection = new URL(process.env.DATABASE_URL ?? "missing:");
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing:").hostname.split(".")[0];
if (!ref || !(connection.hostname === `db.${ref}.supabase.co` || decodeURIComponent(connection.username).endsWith(`.${ref}`))) throw new Error("Database project mismatch");
const tenant = "becaa316-e636-42e9-9d09-08b133e0b094";
const migration = readMigration("0446a_student_ontology_current_scope.sql");
let query = migration.slice(migration.indexOf("with roster as"), migration.indexOf("into result from counts c;")) + "from counts c";
for(const [name,parameter] of Object.entries({p_tenant:"$1::uuid",p_students:"$2::uuid[]",p_kind:"$3::text",p_entity:"$4::text",p_search:"$5::text",p_page:"$6::integer",today:"$7::date"}))
  query=query.replace(new RegExp(`\\b${name}\\b`,"g"),parameter);
if (!query.startsWith("with roster as") || /\b(insert|update|delete|alter|drop|create)\b/i.test(query)) throw new Error("Unexpected preview statement");
const db=postgres(connection.toString(),{ssl:"require",prepare:false,max:1,connect_timeout:15,onnotice:()=>{}});
try {
  const result=await db.begin("read only",async sql=>{
    await sql`set local statement_timeout='15s'`;
    const [{today}]=await sql`select ((now() at time zone 'Asia/Seoul')::date)::text today`;
    const students=await sql`select id,name,school,grade,status,is_test,notes,withdrawal_metadata from students where tenant_id=${tenant}`;
    const enrollments=await sql`select e.id,e.student_id,e.class_id,e.start_date::text,e.end_date::text,e.is_transferred,c.is_makeup_pool,c.closed_at::text
      from enrollments e join classes c on c.id=e.class_id and c.tenant_id=e.tenant_id where e.tenant_id=${tenant}`;
    const identity=buildStudentIdentityIndex(students), enrolled=new Set(enrollments.filter(e=>!e.is_makeup_pool).map(e=>e.student_id));
    const allowed=new Set(contributionRoster(students,enrolled).filter(s=>identity.resolve(s.id)===s.id).map(s=>s.id));
    const rows=await sql.unsafe(query,[tenant,`{${[...allowed].join(",")}}`,"academy",tenant,"",1,today]);
    const data=validateLiveScope(Object.values(rows[0])[0],allowed);
    const expected=new Set(enrollments.filter(e=>allowed.has(e.student_id)&&!e.is_makeup_pool&&(!e.closed_at||e.closed_at>=today)
      &&isEnrollmentOnRosterOn({startDate:e.start_date,endDate:e.end_date,isTransferred:e.is_transferred},today)).map(e=>e.student_id));
    assert.equal(data.total,expected.size);
    return {readOnly:true,checkedAt:new Date().toISOString(),scope:"pilot tenant, unrestricted authorized preview",data,
      expectedStudents:expected.size,quarantined:identity.issues.length};
  });
  mkdirSync("work",{recursive:true});writeFileSync("work/ontology-current-scope-preview.json",JSON.stringify(result,null,2));
  console.log(JSON.stringify({readOnly:result.readOnly,asOf:result.data.asOf,students:result.data.total,classes:result.data.classCount,
    teachers:result.data.teacherCount,subjects:result.data.subjectCount,unassigned:result.data.unassignedClasses,unresolved:result.data.unresolvedAssignments,
    firstPage:result.data.students.length,quarantined:result.quarantined,sourceParity:result.expectedStudents===result.data.total}));
} catch(error) { console.error(JSON.stringify({code:error.code??"PREVIEW_FAILED"}));process.exitCode=1; }
finally {await db.end({timeout:5});}
