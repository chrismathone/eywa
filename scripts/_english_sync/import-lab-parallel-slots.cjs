// LAB(JJ·이주희) 병렬 수업 슬롯 이식 — 시트 xlsx(병합 보존) 기반 (2026-07-06).
// 배경: 7/3 원 임포트는 LAB 블록(요일당 6서브컬럼, 한 교시에 여러 반)에서 서브컬럼을 다 살리지
// 못해 세션 약 절반 누락(JJ 25/49·이주희 21/44). xlsx 병합 범위로 정확한 start/end를 복원해
// (강사라벨, 요일, 시작, 반) 기준 diff 후 누락분만 INSERT.
// 별표(*) 반 = 통합영어시간표가 `*LAB` 교시로 파생 표시하는 실스케줄(정규시간 밖 추가 LAB) → 별표 벗겨 포함.
// 시각 규칙: 강사별 탭 Excel row r(1-based) 시각 = 14:20 + (r-5)×10분 — A열 라벨 텍스트는 불규칙, 행 인덱스가 진실.
// 사용: node --env-file=.env.local scripts/_english_sync/import-lab-parallel-slots.cjs [--apply]
//   (xlsx: _artifacts/teacher-sheet-2026-07-06.xlsx — export?format=xlsx로 획득, 병합 보존)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("postgres");
const ExcelJS = require("exceljs");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ART_DIR = process.env.ENGLISH_SYNC_ART_DIR || path.join(__dirname, "_artifacts");
const XLSX = process.argv.find((a) => a.endsWith(".xlsx")) || path.join(ART_DIR, "teacher-sheet-2026-07-06.xlsx");
const APPLY = process.argv.includes("--apply");
const CUTOVER = "2026-07-03"; // 기존 배치와 동일(컷오버 의미론 보존)
const SHEET_TEACHER_TAB = /강사별영어시간표/;
const SHEET_INTEGRATED_TAB = /통합영어시간표/;
const TIME_ANCHOR_ROW = 5; // Excel 1-based: row 5 = 14:20
const ANCHOR_MIN = 14 * 60 + 20;
const DAY_KO = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat" };
const NOISE = /^(쉬는\s*시간|수업\s*준비|교수부\s*미팅|연차\s*사용|총원|LAB실|<-|\d+(\.\d+)?$|\d{4}\.)/;

// LAB 강사별 방 (JJ 블록 헤더 305 / 이주희는 시트 셀에 방 미표기 → 기존 슬롯 관례대로 null)
const LAB_ROOM = { JJ: "본원305", 이주희: null };

const rowMin = (r) => ANCHOR_MIN + (r - TIME_ANCHOR_ROW) * 10;
const minHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function cellText(ws, r, c) {
  const v = ws.getRow(r).getCell(c).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v.richText) return v.richText.map((t) => t.text).join("");
  if (typeof v === "object" && v.result != null) return String(v.result);
  return String(v);
}

// "CB5:CG8" → {r0,c0,r1,c1} (1-based)
function decodeRange(ref) {
  const m = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`병합 범위 해석 실패: ${ref}`);
  const col = (s) => s.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
  return { c0: col(m[1]), r0: +m[2], c1: col(m[3]), r1: +m[4] };
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const ws = wb.worksheets.find((w) => SHEET_TEACHER_TAB.test(w.name));
  if (!ws) throw new Error(`강사별 탭 없음 — 탭들: ${wb.worksheets.map((w) => w.name).join(", ")}`);
  console.log(`탭: ${ws.name} (${ws.rowCount}×${ws.columnCount})`);

  // 시각 앵커 검증: A5 라벨이 2:20으로 시작해야 행 인덱스 규칙 유효
  const a5 = cellText(ws, TIME_ANCHOR_ROW, 1).trim();
  if (!a5.startsWith("2:20")) throw new Error(`시각 앵커 검증 실패: A${TIME_ANCHOR_ROW}="${a5}" (2:20~ 기대)`);

  const merges = (ws.model.merges || []).map(decodeRange);

  // ── LAB 블록 탐지: row 2 병합 헤더에서 JJ·이주희 ─────────────────────────────
  const blocks = [];
  for (const m of merges) {
    if (m.r0 !== 2) continue;
    const head = cellText(ws, 2, m.c0).replace(/\s+/g, " ").trim();
    if (/(^|\s)JJ(\s|$)/.test(head)) blocks.push({ teacher: "JJ", c0: m.c0, c1: m.c1, head });
    else if (/이주희/.test(head)) blocks.push({ teacher: "이주희", c0: m.c0, c1: m.c1, head });
  }
  if (blocks.length !== 2) throw new Error(`LAB 블록 2개 기대, 실제 ${blocks.length}: ${JSON.stringify(blocks)}`);
  for (const b of blocks) console.log(`블록 ${b.teacher}: 열 ${b.c0}~${b.c1} "${b.head.slice(0, 30)}"`);

  // ── 요일 서브블록: row 4 병합(또는 단일 셀) 헤더 첫 글자 = 요일 ────────────────
  for (const b of blocks) {
    b.days = [];
    const dayMerges = merges.filter((m) => m.r0 === 4 && m.c0 >= b.c0 && m.c0 <= b.c1);
    for (const dm of dayMerges) {
      const label = cellText(ws, 4, dm.c0).trim();
      const day = DAY_KO[label.charAt(0)];
      if (day) b.days.push({ day, c0: dm.c0, c1: dm.c1, label });
    }
    b.days.sort((x, y) => x.c0 - y.c0);
    if (b.days.length === 0) throw new Error(`${b.teacher} 요일 헤더 0개`);
    console.log(`  ${b.teacher} 요일: ${b.days.map((d) => `${d.label}(${d.c1 - d.c0 + 1}열)`).join(" ")}`);
  }

  // ── 세션 파싱: 블록 내 값 있는 셀(병합 마스터/단일) → start/end = 병합 세로 범위 ──
  const mergeByAnchor = new Map(merges.map((m) => [`${m.r0}:${m.c0}`, m]));
  const covered = new Set(); // 병합 피복 셀(마스터 제외) — 값 중복 방지
  for (const m of merges) {
    for (let r = m.r0; r <= m.r1; r++)
      for (let c = m.c0; c <= m.c1; c++) if (!(r === m.r0 && c === m.c0)) covered.add(`${r}:${c}`);
  }

  const sessions = [];
  const warnings = [];
  const starred = [];
  for (const b of blocks) {
    for (const d of b.days) {
      for (let c = d.c0; c <= d.c1; c++) {
        for (let r = TIME_ANCHOR_ROW; r <= ws.rowCount; r++) {
          if (covered.has(`${r}:${c}`)) continue;
          const raw = cellText(ws, r, c).trim();
          if (!raw) continue;
          const firstLine = raw.split("\n")[0].trim();
          if (NOISE.test(firstLine)) continue;
          const isStar = /^\*/.test(firstLine);
          const cls = firstLine.replace(/^\*+/, "").replace(/\/$/, "").trim();
          if (!cls || NOISE.test(cls)) continue;
          const m = mergeByAnchor.get(`${r}:${c}`);
          const r1 = m ? m.r1 : r;
          if (m && m.c1 !== c) warnings.push(`${b.teacher} ${d.day} r${r}c${c} 가로 병합 발견(폭 ${m.c1 - m.c0 + 1}) — 세로만 기대`);
          const startMin = rowMin(r);
          const endMin = rowMin(r1) + 10;
          const s = { teacher: b.teacher, day: d.day, start: minHM(startMin), end: minHM(endMin), cls, star: isStar };
          sessions.push(s);
          if (isStar) starred.push(s);
          if (!m) warnings.push(`${b.teacher} ${d.day} ${s.start} ${cls}: 병합 없는 단일 셀(10분) — 확인 필요`);
        }
      }
    }
  }
  console.log(`\n시트 LAB 세션: ${sessions.length}건 (JJ ${sessions.filter((s) => s.teacher === "JJ").length} · 이주희 ${sessions.filter((s) => s.teacher === "이주희").length} · 별표 ${starred.length})`);
  for (const w of warnings) console.log(`  ⚠️ ${w}`);

  // ── 통합 탭 *LAB 크로스체크 (별표 세션 검증 — 정보성) ─────────────────────────
  const iw = wb.worksheets.find((w) => SHEET_INTEGRATED_TAB.test(w.name));
  if (iw) {
    let starLabs = 0;
    iw.eachRow((row, r) => {
      row.eachCell((cell, c) => {
        const t = cellText(iw, r, c).trim();
        if (t === "*LAB") starLabs++;
      });
    });
    console.log(`통합 탭 *LAB 셀: ${starLabs}건 ↔ 강사별 별표 세션 ${starred.length}건`);
    for (const s of starred) console.log(`  별표: ${s.teacher} ${s.day} ${s.start}~${s.end} ${s.cls}`);
  }

  // ── DB diff ────────────────────────────────────────────────────────────────
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    const classes = await sql`
      select id, class_name from classes
      where tenant_id = ${TENANT} and subject = 'english' and is_active = true`;
    const classByKey = new Map(classes.map((c) => [c.class_name.replace(/\s+/g, "").toLowerCase(), c]));
    const rooms = await sql`select id, name from classrooms where tenant_id = ${TENANT}`;
    const roomId = new Map(rooms.map((r) => [r.name, r.id]));

    const existing = await sql`
      select cs.id, cs.day_of_week as day, cs.start_time as st, cs.end_time as et,
             cs.slot_teacher_label as t, cs.class_id, c.class_name
      from class_schedules cs
      join classes c on c.id = cs.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english'
        and cs.slot_teacher_label in ('JJ', '이주희') and cs.valid_to is null`;
    const exKey = new Map(existing.map((e) => [`${e.t}|${e.day}|${String(e.st).slice(0, 5)}|${e.class_id}`, e]));

    const unknown = new Set();
    const toInsert = [];
    const already = [];
    const endMismatch = [];
    for (const s of sessions) {
      const cls = classByKey.get(s.cls.replace(/\s+/g, "").toLowerCase());
      if (!cls) { unknown.add(s.cls); continue; }
      const key = `${s.teacher}|${s.day}|${s.start}|${cls.id}`;
      const ex = exKey.get(key);
      if (ex) {
        already.push(s);
        const exEnd = String(ex.et).slice(0, 5);
        if (exEnd !== s.end) endMismatch.push(`${s.teacher} ${s.day} ${s.start} ${s.cls}: 시트 end ${s.end} ≠ DB ${exEnd} (불변)`);
      } else {
        toInsert.push({ ...s, classId: cls.id });
      }
    }
    if (unknown.size) console.log(`\n⚠️ DB에 없는 반 (스킵): ${[...unknown].join(", ")}`);
    for (const w of endMismatch) console.log(`  ⚠️ ${w}`);
    console.log(`\ndiff: 기존 일치 ${already.length} · 신규 INSERT 대상 ${toInsert.length} · DB에만 있는 것 ${existing.length - already.length}`);
    for (const t of toInsert) console.log(`  + ${t.teacher} ${t.day} ${t.start}~${t.end} ${t.cls}${t.star ? " (별표)" : ""}`);

    if (!APPLY) {
      console.log(`\n[dry-run] --apply로 실행`);
      return;
    }
    if (toInsert.length === 0) {
      console.log("삽입할 것 없음(멱등).");
      return;
    }

    fs.mkdirSync(ART_DIR, { recursive: true });
    const rows = toInsert.map((t) => ({
      id: crypto.randomUUID(),
      tenant_id: TENANT,
      class_id: t.classId,
      day_of_week: t.day,
      start_time: t.start,
      end_time: t.end,
      valid_from: CUTOVER,
      valid_to: null,
      teacher_id: null, // JJ·이주희는 users 계정 없음(핸드오프 §후속) — 라벨만
      classroom_id: LAB_ROOM[t.teacher] ? (roomId.get(LAB_ROOM[t.teacher]) ?? null) : null,
      slot_teacher_label: t.teacher,
      slot_room_label: LAB_ROOM[t.teacher],
    }));
    fs.writeFileSync(
      path.join(ART_DIR, "LAB_UNDO_2026-07-06.json"),
      JSON.stringify({ note: "복원 = insertedIds 삭제", existingBefore: existing, insertedIds: rows.map((r) => r.id), inserted: rows }, null, 1),
    );
    await sql.begin(async (tx) => {
      for (let i = 0; i < rows.length; i += 100) await tx`insert into class_schedules ${tx(rows.slice(i, i + 100))}`;
    });
    console.log(`\n적용 완료: ${rows.length}건 INSERT (undo → _artifacts/LAB_UNDO_2026-07-06.json)`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
