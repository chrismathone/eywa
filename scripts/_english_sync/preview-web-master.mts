/** Read-only verification of the exact planner used by /timetable/english-sheet.
 * node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig scripts/_english_sync/tsconfig.preview.json scripts/_english_sync/preview-web-master.mts
 * Optional first argument: JSON MasterInput file. Never invokes apply.
 */
import fs from "node:fs";
import {readMasterSource} from "../../src/features/timetable/server/master-sheet-source";
import {openMasterDb,loadMasterContext,masterPreview} from "../../src/features/timetable/server/master-sheet-store";
import {MASTER_SHEET_ID,type MasterInput} from "../../src/features/timetable/import/master/types";
const input:MasterInput=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],"utf8")):{source:`https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/edit`,teacherTab:"강사별영어시간표(10월)",rosterTab:" 통합영어시간표(10월)",effectiveDate:"2026-10-01",maxColumn:"EU",classBindings:{}};
try {
 console.log("Reading exact sheet tabs...");
 const {grids,source}=await readMasterSource(input);
 const sql=openMasterDb();
 try {
  const ctx=await sql.begin("isolation level repeatable read read only",tx=>loadMasterContext(tx,"becaa316-e636-42e9-9d09-08b133e0b094",input.effectiveDate));
  const preview=masterPreview(input,grids,ctx,source);
  fs.mkdirSync("output/english-sheet-preview",{recursive:true});
  fs.writeFileSync("output/english-sheet-preview/latest.json",JSON.stringify({input,grids,ctx,preview},null,2));
  console.log(JSON.stringify({plan:preview.report.plan,roster:{moves:preview.roster.moves.length,adds:preview.roster.adds.length,unchanged:preview.roster.unchanged},issues:preview.issues.map(i=>({severity:i.severity,target:i.target,reason:i.reason})),mappings:preview.mappings.filter(m=>!m.classId||m.suggestedId!==m.classId)},null,2));
 }finally{await sql.end();}
}catch(e){console.error(e instanceof Error?e.message:"Preview failed");process.exitCode=1;}
