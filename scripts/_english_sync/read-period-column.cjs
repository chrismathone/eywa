// 시트 강사별영어시간표 A열(시각 라벨) + 병합 구조 = 교시 정의 정찰.
const { google } = require("googleapis");
const SS = "1-rxcGRayUOJl8nU5GU93I6V19ID-FFvAQn8laI3BR0M";
function loadKey(){const raw=process.env.GOOGLE_SERVICE_ACCOUNT_KEY||process.env.FIREBASE_SERVICE_ACCOUNT_KEY;const txt=raw.trim().startsWith("{")?raw:Buffer.from(raw,"base64").toString("utf8");return JSON.parse(txt);}
(async()=>{
  const key=loadKey();
  const auth=new google.auth.JWT({email:key.client_email,key:key.private_key,scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]});
  const sheets=google.sheets({version:"v4",auth});
  const target="강사별영어시간표(7월)";
  const g=await sheets.spreadsheets.get({spreadsheetId:SS,ranges:[`${target}!A1:A121`],includeGridData:true,fields:"sheets(data(rowData(values(formattedValue))),merges)"});
  const sh=g.data.sheets[0];
  const rows=sh.data[0].rowData||[];
  const merges=(sh.merges||[]).filter(m=>m.startColumnIndex===0).sort((a,b)=>a.startRowIndex-b.startRowIndex);
  const cell=r=>rows[r]?.values?.[0]?.formattedValue??"";
  console.log("=== A열 병합 블록(교시 = 병합된 시각 라벨) ===");
  for(const m of merges){
    const v=cell(m.startRowIndex);
    if(v) console.log(`  r${m.startRowIndex}-${m.endRowIndex-1} (${m.endRowIndex-m.startRowIndex}행): "${v}"`);
  }
  console.log("\n=== A열 비병합 개별 라벨(있으면) ===");
  const merged=new Set();
  for(const m of merges) for(let r=m.startRowIndex;r<m.endRowIndex;r++) merged.add(r);
  for(let r=3;r<121;r++){ if(!merged.has(r)&&cell(r)) console.log(`  r${r}: "${cell(r)}"`); }
})().catch(e=>{console.error("ERR:",e.message);process.exit(1)});
