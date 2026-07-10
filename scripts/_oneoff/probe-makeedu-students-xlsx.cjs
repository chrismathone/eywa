// Read-only probe of makeedu 원생목록 xlsx — status/school/grade/noise distribution.
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");

const FILE =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || "C:/Users/user", "Downloads", "원생목록_20260710153700.xlsx");

function txt(v) {
  if (v == null) return null;
  if (typeof v === "object") return (v.text || v.result || "").toString().trim() || null;
  const s = String(v).trim();
  return s || null;
}
function parseDate(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return null;
}

(async () => {
  if (!fs.existsSync(FILE)) throw new Error("file not found: " + FILE);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];
  const head = (ws.getRow(1).values || []).map((v) => txt(v));
  const col = {};
  head.forEach((h, i) => {
    if (h) col[h] = i;
  });
  console.log("file:", path.basename(FILE));
  console.log("headers sample:", head.filter(Boolean).slice(0, 30).join(" | "));

  const buckets = {
    total: 0,
    noId: 0,
    noName: 0,
    enrolled: 0,
    on_hold: 0,
    withdrawn: 0,
    otherStatus: 0,
    schoolEmpty: 0,
    gradeEmpty: 0,
    schoolAndGradeEmpty: 0,
    dummyName: 0,
    withdrawnNoPhone: 0,
    withdrawnOld: 0, // withdrawn_at before 2024-01-01
    withdrawn4m: 0, // withdrawn within ~4 months of 2026-07
    enrolledNoSchool: 0,
  };
  const withdrawnYears = {};
  const gradeVals = {};
  const schoolEmptyNames = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const get = (name) => (col[name] != null ? txt(vals[col[name]]) : null);
    const id = get("원생고유번호");
    if (!id) {
      buckets.noId++;
      continue;
    }
    buckets.total++;
    const name = get("이름");
    if (!name) buckets.noName++;
    const isEnrolled = get("재원여부") === "O";
    const onHold = get("휴원여부") === "O";
    const withdrawnDate = parseDate(get("퇴원일"));
    let status = "enrolled";
    if (isEnrolled) status = "enrolled";
    else if (onHold) status = "on_hold";
    else if (withdrawnDate) status = "withdrawn";
    else status = "other";

    if (status === "enrolled") buckets.enrolled++;
    else if (status === "on_hold") buckets.on_hold++;
    else if (status === "withdrawn") buckets.withdrawn++;
    else buckets.otherStatus++;

    const school = get("학교");
    const grade = get("학년");
    if (!school) buckets.schoolEmpty++;
    if (!grade) buckets.gradeEmpty++;
    if (!school && !grade) {
      buckets.schoolAndGradeEmpty++;
      if (schoolEmptyNames.length < 10) schoolEmptyNames.push({ name, status, id });
    }
    if (name && /^(학원|테스트|test|demo)/i.test(name)) buckets.dummyName++;
    gradeVals[grade || "(empty)"] = (gradeVals[grade || "(empty)"] || 0) + 1;

    if (status === "withdrawn") {
      const phone = get("보호자연락처") || get("원생연락처");
      if (!phone) buckets.withdrawnNoPhone++;
      if (withdrawnDate) {
        const y = withdrawnDate.slice(0, 4);
        withdrawnYears[y] = (withdrawnYears[y] || 0) + 1;
        if (withdrawnDate < "2024-01-01") buckets.withdrawnOld++;
        if (withdrawnDate >= "2026-03-01") buckets.withdrawn4m++;
      }
    }
    if (status === "enrolled" && !school) buckets.enrolledNoSchool++;
  }

  console.log("\n=== counts ===");
  console.log(buckets);
  console.log("\nwithdrawn by year:", withdrawnYears);
  console.log("\ngrade top:", Object.entries(gradeVals).sort((a, b) => b[1] - a[1]).slice(0, 20));
  console.log("\nschool+grade empty samples:", schoolEmptyNames);

  // Suggested filter sets
  const keep = {
    enrolled_onhold: buckets.enrolled + buckets.on_hold,
    plus_withdrawn_4m: buckets.enrolled + buckets.on_hold + buckets.withdrawn4m,
    plus_withdrawn_2024plus: buckets.enrolled + buckets.on_hold + (buckets.withdrawn - buckets.withdrawnOld),
    all_with_status: buckets.enrolled + buckets.on_hold + buckets.withdrawn,
  };
  console.log("\n=== suggested keep sizes ===");
  console.log(keep);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
