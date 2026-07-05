// 시트 강사별영어시간표 ↔ eywa 강사뷰(현행 스케줄) 전격 패리티 검증 (2026-07-06 정식화).
// xlsx(병합 보존)를 파싱해 강사·요일·세션(start~end 반@방) 정규형으로 만들고, DB의 현행
// (valid_to null) 영어 슬롯을 같은 형태로 접어(back-to-back 동일 반 병합) 양방향 diff.
// 시각 = 행 인덱스 규칙(14:20 + (row-5)×10, Excel 1-based) — A열 라벨 미신뢰.
// 사용: node --env-file=.env.local scripts/_english_sync/verify-sheet-parity.cjs [경로.xlsx]
//   xlsx 갱신: curl -sL -o scripts/_english_sync/_artifacts/teacher-sheet-<날짜>.xlsx \
//     "https://docs.google.com/spreadsheets/d/1-rxcGRayUOJl8nU5GU93I6V19ID-FFvAQn8laI3BR0M/export?format=xlsx"
// 종료코드: diff 0이면 0, 있으면 2.
const path = require("path");
const postgres = require("postgres");
const ExcelJS = require("exceljs");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ART_DIR = process.env.ENGLISH_SYNC_ART_DIR || path.join(__dirname, "_artifacts");
const XLSX = process.argv[2] || path.join(ART_DIR, "teacher-sheet-2026-07-06.xlsx");
const TIME_ANCHOR_ROW = 5;
const ANCHOR_MIN = 14 * 60 + 20;
const DAY_KO = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat" };
const DAY_LABEL = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];
const NOISE = /^(쉬는\s*시간|수업\s*준비|교수부\s*미팅|연차\s*사용|총원|LAB실|<-|\d+(\.\d+)?$|\d{4}\.)/;
const ROOM_RE = /\b(\d{3}|SKY)\b/;
// LAB 블록: 셀에 방 미표기(인원 숫자) → 방 비교 제외. JJ=305/이주희=null은 이식 정책.
const LAB_TEACHERS = new Set(["JJ", "이주희"]);

const rowMin = (r) => ANCHOR_MIN + (r - TIME_ANCHOR_ROW) * 10;
const minHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hmMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function cellText(ws, r, c) {
  const v = ws.getRow(r).getCell(c).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.richText) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && v.result != null) return String(v.result);
  return String(v);
}
function decodeRange(ref) {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  const col = (s) => s.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  return { c0: col(m[1]), r0: +m[2], c1: col(m[3]), r1: +m[4] };
}
function leadName(header) {
  const m = header.trim().match(/^([A-Za-z]+|[가-힣]{2,4})/);
  return m ? m[1] : header.slice(0, 10);
}

/** [{start,end,cls,room}] → 인접(prev.end==next.start) 동일 반 병합 후 "start~end cls[@room]" 목록. */
function foldSessions(items, withRoom) {
  const a = [...items].sort((x, y) => hmMin(x.start) - hmMin(y.start) || x.cls.localeCompare(y.cls));
  const out = [];
  for (const it of a) {
    const p = out[out.length - 1];
    if (p && p.cls === it.cls && p.end === it.start) { p.end = it.end; continue; }
    out.push({ ...it });
  }
  return out.map((s) => `${s.start}~${s.end} ${s.cls}${withRoom && s.room ? `@${s.room}` : ""}`);
}

async function main() {
  // ── 1. 시트 파싱 ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.worksheets.find((w) => /강사별영어시간표/.test(w.name));
  if (!ws) throw new Error("강사별 탭 없음");
  const a5 = cellText(ws, TIME_ANCHOR_ROW, 1).trim();
  if (!a5.startsWith("2:20")) throw new Error(`시각 앵커 검증 실패: A5="${a5}"`);

  const merges = (ws.model.merges || []).map(decodeRange);
  const covered = new Set();
  for (const m of merges)
    for (let r = m.r0; r <= m.r1; r++)
      for (let c = m.c0; c <= m.c1; c++) if (!(r === m.r0 && c === m.c0)) covered.add(`${r}:${c}`);
  const mergeByAnchor = new Map(merges.map((m) => [`${m.r0}:${m.c0}`, m]));

  // 강사 블록(row 2 병합 헤더) — 예비 블록 제외.
  const blocks = [];
  for (const m of merges.filter((x) => x.r0 === 2).sort((a, b) => a.c0 - b.c0)) {
    const head = cellText(ws, 2, m.c0).replace(/\s+/g, " ").trim();
    if (!head || head.startsWith("예비")) continue;
    const name = /(^|\s)JJ(\s|$)/.test(head) ? "JJ" : /이주희/.test(head) ? "이주희" : leadName(head);
    blocks.push({ name, c0: m.c0, c1: m.c1, lab: LAB_TEACHERS.has(name) });
  }

  const warnings = [];
  const sheet = {}; // name → day → [{start,end,cls,room}]
  for (const b of blocks) {
    // 요일 컬럼: row 4 — 일반 블록은 열마다 1요일, LAB 블록은 6열 병합 헤더.
    const dayOfCol = new Map();
    for (let c = b.c0; c <= b.c1; c++) {
      if (covered.has(`4:${c}`)) continue;
      const label = cellText(ws, 4, c).trim();
      const day = DAY_KO[label.charAt(0)];
      if (!day) continue;
      const dm = mergeByAnchor.get(`4:${c}`);
      const span = dm && dm.r0 === 4 ? dm.c1 - dm.c0 + 1 : 1;
      for (let cc = c; cc < c + span && cc <= b.c1; cc++) dayOfCol.set(cc, day);
    }
    for (let c = b.c0; c <= b.c1; c++) {
      const day = dayOfCol.get(c);
      if (!day) continue;
      for (let r = TIME_ANCHOR_ROW; r <= ws.rowCount; r++) {
        if (covered.has(`${r}:${c}`)) continue;
        const raw = cellText(ws, r, c).trim();
        if (!raw) continue;
        const first = raw.split("\n")[0].trim();
        if (NOISE.test(first)) continue;
        const cls = first.replace(/^\*+/, "").replace(/\/$/, "").trim();
        if (!cls || NOISE.test(cls)) continue;
        const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
        if (lines.length > 2 && /\/$/.test(lines[1])) warnings.push(`셀에 반명 줄 2개: ${b.name} ${DAY_LABEL[day]} r${r} "${raw.replace(/\n/g, "⏎").slice(0, 40)}"`);
        const m = mergeByAnchor.get(`${r}:${c}`);
        const r1 = m ? m.r1 : r;
        // ⚠️ 방은 **반명을 뺀 잔여**에서만 탐색 — 반명 자체에 "SKY"가 든 반(중등E_초6 SKY)에서
        // raw 전체 매칭하면 방(303)보다 이름의 SKY가 먼저 걸린다(원 임포트 '본원SKY'의 근본 원인).
        const room = b.lab ? null : (raw.replace(first, "").match(ROOM_RE)?.[1] ?? null);
        ((sheet[b.name] = sheet[b.name] || {})[day] = sheet[b.name][day] || []).push({
          start: minHM(rowMin(r)), end: minHM(rowMin(r1) + 10), cls, room,
        });
      }
    }
  }

  // ── 2. DB 현행 슬롯 ──────────────────────────────────────────────────────────
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  let db = {};
  try {
    const rows = await sql`
      select cs.day_of_week as day, cs.start_time as st, cs.end_time as et,
             cs.slot_teacher_label as t, cs.slot_room_label as room, c.class_name as cls
      from class_schedules cs
      join classes c on c.id = cs.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english' and c.is_active = true
        and (c.closed_at is null or c.closed_at >= current_date)
        and cs.valid_to is null`;
    for (const r of rows) {
      const t = r.t ?? "—";
      ((db[t] = db[t] || {})[r.day] = db[t][r.day] || []).push({
        start: String(r.st).slice(0, 5), end: String(r.et).slice(0, 5),
        cls: r.cls.trim(), room: LAB_TEACHERS.has(t) ? null : ((r.room ?? "").replace(/^본원/, "") || null),
      });
    }
  } finally {
    await sql.end();
  }

  // ── 3. diff ──────────────────────────────────────────────────────────────────
  let diffs = 0;
  const teachers = [...new Set([...Object.keys(sheet), ...Object.keys(db)])].sort();
  for (const t of teachers) {
    if (!sheet[t]) { console.log(`⚠️ DB에만 있는 강사 라벨: ${t}`); diffs++; continue; }
    if (!db[t]) { console.log(`⚠️ 시트에만 있는 강사: ${t}`); diffs++; continue; }
    for (const d of DAYS) {
      const withRoom = !LAB_TEACHERS.has(t);
      const S = foldSessions(sheet[t][d] || [], withRoom);
      const E = foldSessions(db[t][d] || [], withRoom);
      const Sset = new Set(S), Eset = new Set(E);
      const onlyS = S.filter((x) => !Eset.has(x));
      const onlyE = E.filter((x) => !Sset.has(x));
      if (onlyS.length || onlyE.length) {
        diffs += onlyS.length + onlyE.length;
        console.log(`✗ ${t} ${DAY_LABEL[d]}`);
        for (const x of onlyS) console.log(`    시트에만: ${x}`);
        for (const x of onlyE) console.log(`    eywa에만: ${x}`);
      }
    }
  }
  for (const w of warnings) console.log(`  (참고) ${w}`);
  console.log(diffs === 0
    ? `\n✅ 패리티 OK — 강사 ${teachers.length}명 전 세션 시트=eywa 일치`
    : `\n❌ diff ${diffs}건`);
  process.exit(diffs === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
