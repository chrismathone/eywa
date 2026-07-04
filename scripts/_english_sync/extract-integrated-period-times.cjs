// 통합영어시간표 col A(시각 라벨) 전수 수집 → 24h 변환 → 시작→끝 빈도 집계 = 교시 정의.
const { google } = require("googleapis");
const SS = "1-rxcGRayUOJl8nU5GU93I6V19ID-FFvAQn8laI3BR0M";
function loadKey(){const raw=process.env.GOOGLE_SERVICE_ACCOUNT_KEY||process.env.FIREBASE_SERVICE_ACCOUNT_KEY;const txt=raw.trim().startsWith("{")?raw:Buffer.from(raw,"base64").toString("utf8");return JSON.parse(txt);}
// "2:20" (오후) → "14:20"
function to24(hm){
  const m=/^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if(!m) return null;
  let h=+m[1]; const mm=+m[2];
  if(h!==12 && h<12) h+=12; // 오후
  return String(h).padStart(2,"0")+":"+String(mm).padStart(2,"0");
}
(async()=>{
  const key=loadKey();
  const auth=new google.auth.JWT({email:key.client_email,key:key.private_key,scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"]});
  const sheets=google.sheets({version:"v4",auth});
  const target="통합영어시간표(7월)";
  const res=await sheets.spreadsheets.values.get({spreadsheetId:SS,range:`${target}!A1:A194`});
  const col=(res.data.values||[]).map(r=>r[0]||"");
  const byStart={}; // start24 -> { end24: count }
  const rawLabels=new Set();
  for(const v of col){
    const m=/^(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})$/.exec(String(v).trim());
    if(!m) continue;
    rawLabels.add(v.trim());
    const s=to24(m[1]), e=to24(m[2]);
    if(!s||!e) continue;
    byStart[s]=byStart[s]||{};
    byStart[s][e]=(byStart[s][e]||0)+1;
  }
  const starts=Object.keys(byStart).sort();
  console.log(`=== 통합 col A 시각 라벨 (distinct ${rawLabels.size}) ===`);
  console.log("distinct starts:", starts.length);
  const toMin=t=>{const[h,m]=t.split(":").map(Number);return h*60+m;};
  starts.sort((a,b)=>toMin(a)-toMin(b));
  for(const s of starts){
    const ends=Object.entries(byStart[s]).sort((a,b)=>b[1]-a[1]).map(([e,c])=>`${e}(${c})`).join("  ");
    console.log(`  ${s}  →  ${ends}`);
  }
})().catch(e=>{console.error("ERR:",e.message);process.exit(1)});
