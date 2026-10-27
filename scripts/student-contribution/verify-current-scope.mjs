// Disposable PostgreSQL only; no env load or external connection.
// node --import tsx scripts/student-contribution/verify-current-scope.mjs <isolated-pglite-module>
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isEnrollmentOnRosterOn } from "../../src/features/enrollments/eligibility.ts";
import { isDelegationActiveOn } from "../../src/features/classes/delegation-window.ts";
import { addDays } from "../../src/lib/date-kst.ts";
import { readMigration } from "../../src/lib/db/migrations-corpus.mjs";
if (!process.argv[2]) throw new Error("Pass the isolated PGlite module path");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite(), uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = uid(1), other = uid(2), teacher = uid(3), delegate = uid(4), foreignTeacher = uid(5);
const classA = uid(10), classB = uid(11), pool = uid(12), closed = uid(13), unassigned = uid(14), damaged = uid(15);
let checks = 0;
const check = (condition) => { assert.ok(condition); checks++; };
async function call(students, kind = "academy", entity = tenant, search = "", page = 1) {
  return (await db.query("select student_ontology_current_scope($1,$2::uuid[],$3,$4,$5,$6) result", [tenant, students, kind, entity, search, page])).rows[0].result;
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table students(id uuid primary key,tenant_id uuid,name text,school text,grade text,is_test boolean);
    create table users(id uuid primary key,tenant_id uuid,display_name text);
    create table classes(id uuid primary key,tenant_id uuid,class_name text,subject text,teacher_id uuid,is_makeup_pool boolean,closed_at date);
    create table enrollments(id uuid primary key,tenant_id uuid,student_id uuid,class_id uuid,start_date date,end_date date,is_transferred boolean,on_hold boolean);
    create table class_schedules(id uuid primary key,tenant_id uuid,class_id uuid,teacher_id uuid,valid_from date,valid_to date);
    create table class_delegations(id uuid primary key,tenant_id uuid,class_id uuid,delegate_user_id uuid,from_date date,to_date date,revoked_at timestamptz);
    grant select on all tables in schema public to service_role;`);
  const today = (await db.query("select ((now() at time zone 'Asia/Seoul')::date)::text today")).rows[0].today;
  await db.query("insert into users values($1,$2,'담임'),($3,$2,'위임'),($4,$5,'다른 지점 강사')", [teacher,tenant,delegate,foreignTeacher,other]);
  for (const [id,name,subject,tid,isPool,ends] of [
    [classA,"수학 A","math",teacher,false,null], [classB,"영어 B","english",teacher,false,null],
    [pool,"숨은 반","math",teacher,true,null], [closed,"종강 반","math",teacher,false,addDays(today,-1)],
    [unassigned,"담당 미지정","math",null,false,null], [damaged,"잘못된 담당 연결","math",foreignTeacher,false,null],
  ]) await db.query("insert into classes values($1,$2,$3,$4,$5,$6,$7)",[id,tenant,name,subject,tid,isPool,ends]);
  let index = 100;
  const fixtures = [];
  for (const startOffset of [-1,0,1]) for (const endOffset of [-1,0,1,null]) for (const transferred of [false,true]) {
    const id = uid(index++), studentId = uid(index++);
    const startDate = addDays(today,startOffset), endDate = endOffset === null ? null : addDays(today,endOffset);
    if (endDate && endDate < startDate) continue;
    const row = { id, studentId, startDate, endDate, isTransferred: transferred };
    fixtures.push(row);
    await db.query("insert into students values($1,$2,$3,'학교','초1',false)",[studentId,tenant,`학생 ${index}`]);
    await db.query("insert into enrollments values($1,$2,$3,$4,$5,$6,$7,true)",[id,tenant,studentId,classA,startDate,endDate,transferred]);
  }
  for(let n=0;n<25;n++) {
    const id=uid(index++),studentId=uid(index++),startDate=today,endDate=null;
    fixtures.push({id,studentId,startDate,endDate,isTransferred:false});
    await db.query("insert into students values($1,$2,'동명이인','학교','초1',false)",[studentId,tenant]);
    await db.query("insert into enrollments values($1,$2,$3,$4,$5,null,false,false)",[id,tenant,studentId,classA,today]);
  }
  const eligible = fixtures.filter(r => isEnrollmentOnRosterOn(r,today));
  const ids = fixtures.map(r=>r.studentId), selected = eligible[0].studentId;
  // Same student in another subject and duplicate source enrollment: no duplicate headcount.
  for (const [n,cid] of [[801,classA],[802,classB],[803,pool],[804,closed],[805,unassigned],[806,damaged]])
    await db.query("insert into enrollments values($1,$2,$3,$4,$5,null,false,false)",[uid(n),tenant,selected,cid,today]);
  await db.query("insert into class_schedules values($1,$2,$3,$4,$5,null),($6,$2,$3,$4,$5,null)",[uid(810),tenant,classA,teacher,today,uid(811)]);
  const delegations = [
    { id:uid(820),fromDate:today,toDate:today,revokedAt:null },
    { id:uid(821),fromDate:addDays(today,1),toDate:addDays(today,2),revokedAt:null },
    { id:uid(822),fromDate:addDays(today,-1),toDate:today,revokedAt:new Date().toISOString() },
  ];
  for(const d of delegations) await db.query("insert into class_delegations values($1,$2,$3,$4,$5,$6,$7)",[d.id,tenant,classA,delegate,d.fromDate,d.toDate,d.revokedAt]);
  const migration = readMigration("0446a_student_ontology_current_scope.sql");
  await db.exec(migration); await db.exec(migration); checks++;
  for(const role of ["anon","authenticated"]) { await db.exec(`set role ${role}`); await assert.rejects(call(ids)); checks++; await db.exec("reset role"); }
  await db.exec("set role service_role");
  const academy = await call(ids);
  const secondPage = await call(ids,"academy",tenant,"",2);
  check(academy.students.length===20); check(secondPage.students.length===eligible.length-20);
  check(new Set([...academy.students,...secondPage.students].map(s=>s.id)).size===eligible.length);
  check((await call(ids,"academy",tenant,"동명이인")).filteredTotal===25);
  check(academy.total===eligible.length); check(academy.teacherCount===2); check(academy.subjectCount===2); check(academy.classCount===4);
  check(academy.unassignedClasses===1); check(academy.unresolvedAssignments===1);
  check(!JSON.stringify(academy).includes("숨은 반")); check(!JSON.stringify(academy).includes("종강 반")); check(!JSON.stringify(academy).includes("다른 지점 강사"));
  const student = await call(ids,"student",selected);
  check(student.total===1); check(student.students[0].classes.length===4);
  const a = student.students[0].classes.find(c=>c.id===classA);
  check(a.enrollmentIds.length===2); check(a.onHold===false);
  check(a.teachers.filter(t=>t.role==="delegatedTeacher").length===delegations.filter(d=>isDelegationActiveOn(d,today)).length);
  check((await call(ids,"teacher",teacher)).total===eligible.length);
  check((await call(ids,"subject","english")).total===1);
  check((await call(ids.filter(id=>id!==selected),"subject","english")).total===0);
  check((await call([])).total===0); check((await call(ids,"student",uid(999))).total===0);
  check((await call(ids,"academy",tenant,"no matching student")).filteredTotal===0);
  check((await call(ids,"academy",tenant,"",100000)).page===Math.max(1,Math.ceil(eligible.length/20)));
  await assert.rejects(call(null)); checks++;
  await assert.rejects(call(ids,"academy",other)); checks++;
  // No permission widening from a supplied student ID that belongs to another tenant.
  await db.exec("reset role");
  await db.query("insert into students values($1,$2,'다른 학생',null,null,false)",[uid(990),other]);
  await db.query("insert into enrollments values($1,$2,$3,$4,$5,null,false,false)",[uid(991),other,uid(990),classA,today]);
  await db.exec("set role service_role"); check((await call([...ids,uid(990)])).total===eligible.length);
  console.log(JSON.stringify({checks,status:"passed",fixtures:fixtures.length,database:"disposable in-memory PostgreSQL",productionWrites:0}));
} finally { await db.close(); }
