// 시트 강사별영어시간표(7월) 실구조 정찰 — 서비스계정 readonly, includeGridData(병합+색).
// 사용: node --env-file=.env.local scripts/_english_sync/read-teacher-grid.cjs [탭이름]
const { google } = require("googleapis");
const fs = require("fs");

const SS = "1-rxcGRayUOJl8nU5GU93I6V19ID-FFvAQn8laI3BR0M";
const WANT = process.argv[2] || null;

function loadKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(txt);
}

(async () => {
  const key = loadKey();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SS,
    fields: "sheets.properties(title,sheetId,gridProperties)",
  });
  console.log("SA:", key.client_email);
  console.log("탭 목록:");
  for (const s of meta.data.sheets) {
    const gp = s.properties.gridProperties;
    console.log(`  - ${s.properties.title} (${gp.rowCount}×${gp.columnCount})`);
  }

  const target =
    WANT || meta.data.sheets.find((s) => /강사별/.test(s.properties.title))?.properties.title;
  if (!target) return console.log("강사별 탭 못 찾음 — 탭 이름 인자로 지정");
  console.log("\n대상 탭:", target);

  // 그리드 데이터(값+병합+배경색) 일부만
  const grid = await sheets.spreadsheets.get({
    spreadsheetId: SS,
    ranges: [`${target}!A1:EZ12`],
    includeGridData: true,
    fields:
      "sheets(data(rowData(values(formattedValue,userEnteredFormat(backgroundColor)))),merges)",
  });
  const sheet = grid.data.sheets[0];
  const rowData = sheet.data[0].rowData || [];
  const merges = sheet.merges || [];

  console.log(`\n병합 셀 ${merges.length}건 (상위 12행 스코프)`);
  // 헤더 3행(강사번호/강사헤더/메모) + 요일행 구조 덤프
  const cell = (r, c) => rowData[r]?.values?.[c]?.formattedValue ?? "";
  const bg = (r, c) => {
    const b = rowData[r]?.values?.[c]?.userEnteredFormat?.backgroundColor;
    if (!b) return null;
    const h = (x) => Math.round((x ?? 0) * 255).toString(16).padStart(2, "0");
    return `#${h(b.red)}${h(b.green)}${h(b.blue)}`;
  };
  for (let r = 0; r < 6; r++) {
    const cells = [];
    for (let c = 0; c < 20; c++) {
      const v = cell(r, c);
      if (v) cells.push(`c${c}="${v.replace(/\n/g, "⏎").slice(0, 14)}"${bg(r, c) ? `[${bg(r, c)}]` : ""}`);
    }
    console.log(`r${r}: ${cells.join("  ")}`);
  }

  // 강사 헤더행(row1) 병합 = 강사 블록(좌→우). 이름·색·시작열·폭 추출.
  const row1merges = merges
    .filter((m) => m.startRowIndex === 1)
    .sort((a, b) => a.startColumnIndex - b.startColumnIndex);
  const blocks = row1merges.map((m) => ({
    startCol: m.startColumnIndex,
    width: m.endColumnIndex - m.startColumnIndex,
    header: cell(1, m.startColumnIndex),
    color: bg(1, m.startColumnIndex),
    note: cell(2, m.startColumnIndex),
  }));
  console.log("\n=== 강사 블록(시트 좌→우 순서) ===");
  for (const b of blocks) console.log(`  c${b.startCol}(폭${b.width}) "${b.header.replace(/\n/g, " ")}" [${b.color}]`);

  fs.writeFileSync(
    "D:/영어시간표/_english-sync-artifacts/teacher_grid_blocks.json",
    JSON.stringify(blocks, null, 1),
  );
  console.log("\n저장: teacher_grid_blocks.json");
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
