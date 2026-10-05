import assert from 'node:assert/strict';
import postgres from 'postgres';
import {applyOnRealChain} from '../makeup-db/real-apply.mjs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.argv[2];if(!output)throw new Error('Synthetic S13 schema evidence path required');
const db=postgres({host:'127.0.0.1',port:55444,database:'makeup_browser',username:'makeup_test',max:1,onnotice:()=>{},prepare:false});
try{
 assert.equal((await db`select current_database() name`)[0].name,'makeup_browser');
 const result=await applyOnRealChain({db,root,assert});
 await writeFile(output,JSON.stringify(result,null,2));
 await db`select mt.seed_on()`;
 await db`update users set status='active' where id=mt.id(29)`;
 await db`update classrooms set capacity=4 where id=mt.id(43)`;
 const [absent]=await db`select mt.approved_case(mt.id(62),mt.id(51),mt.d(-50),120) id`;
 const [p]=await db`select mt.cmd(mt.id(22),'reserve',jsonb_build_object('student_id',mt.id(62),'subject_key','math','session_date',mt.d(0),'period_ids',array['1','2'],'teacher_id',mt.id(29),'classroom_id',mt.id(43),'anchor_class_id',mt.id(51),'allocations',jsonb_build_array(jsonb_build_object('case_id',${absent.id}::uuid,'minutes',50))))->>'id' id`;
 const [other]=await db`select mt.approved_case(mt.id(61),mt.id(51),mt.d(-51),120) id`;
 const [p2]=await db`select mt.cmd(mt.id(22),'reserve',jsonb_build_object('student_id',mt.id(61),'subject_key','math','session_date',mt.d(0),'period_ids',array['1','2'],'teacher_id',mt.id(26),'classroom_id',mt.id(42),'anchor_class_id',mt.id(51),'allocations',jsonb_build_array(jsonb_build_object('case_id',${other.id}::uuid,'minutes',50))))->>'id' id`;
 await db.begin(async sql=>{await sql`select mt.as_command()`;await sql`update makeup_participants set anchor_class_id=mt.id(51) where id in(${p.id}::uuid,${p2.id}::uuid)`;await sql`select mt.end_command()`;});
 await db`notify pgrst,'reload schema'`;
 console.log(JSON.stringify({chain:result.real-result.skipped.length,skipped:result.skipped.length,zeroClassTeacher:29,otherClassTeacher:26,caseId:absent.id,otherId:other.id}));
}finally{await db.end();}
