/**
 * scripts/_makeedu/import-students.cjs
 *
 * makeedu 원생목록 엑셀(47컬럼) → eywa `students` **additive 동기화**(makeedu_id 외부키, 0057a).
 * ⚠️ ijw 베이스가 정본. makeedu 학생을 (이름+학교+학년)로 ijw 학생에 매칭 → 매칭되면 makeedu_id만
 *    백필(ijw 값 절대 덮어쓰지 않음), ijw에 없는 학생만 신규 추가. dry-run도 DB를 읽어 매칭 건수를 측정.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --recommended
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --recommended --apply
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --all          # 필터 없음(비권장)
 *   node --env-file=.env.local scripts/_makeedu/import-students.cjs --enrolled-only
 *   --withdrawn-since=2025-01-01  (recommended 기본값)
 *   --file=C:/path/원생목록_….xlsx
 *
 * 입력: --file 또는 Downloads(또는 $MAKEEDU_DL)의 최신 '원생목록_*.xlsx'.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const postgres = require("postgres");
const L = require("./lib.cjs");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const RECOMMENDED = argv.includes("--recommended");
const ENROLLED_ONLY = argv.includes("--enrolled-only");
const ALL = argv.includes("--all");
const fileArg = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length);
const sinceArg = argv.find((a) => a.startsWith("--withdrawn-since="))?.slice("--withdrawn-since=".length);
const WITHDRAWN_SINCE = sinceArg || (RECOMMENDED ? "2025-01-01" : null);

const DL = process.env.MAKEEDU_DL || "C:/Users/user/Downloads";

function latestFile(prefix) {
  const cand = fs
    .readdirSync(DL)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".xlsx"))
    .map((n) => ({ n, m: fs.statSync(path.join(DL, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!cand.length) throw new Error(`no '${prefix}*.xlsx' in ${DL}`);
  return path.join(DL, cand[0].n);
}

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
function gender(v) {
  const s = txt(v);
  if (s === "남") return "male";
  if (s === "여") return "female";
  return null;
}

/** 잡음 이름 — 학부모·설명회·업장·테스트 등 (원생 아님). */
function isJunkName(name) {
  if (!name) return true;
  const n = name.trim();
  if (n.length <= 1) return true;
  if (n === "?" || n === "-" || n === "—") return true;
  if (/^\(모\)/.test(n)) return true;
  if (/설명회|알바|식당|기사|학부모|교사|선생|직원|셔틀|버스|지원|풍미|단디|꼬치/.test(n)) return true;
  if (/^\d/.test(n)) return true; // 0903설명회… / 1호차…
  if (/^학원[일이삼사오육칠팔구십\dA-Za-z]/.test(n)) return true;
  if (/^(테스트|test|demo)/i.test(n)) return true;
  return false;
}

function mapRows(ws) {
  const head = (ws.getRow(1).values || []).map((v) => txt(v));
  const col = {};
  head.forEach((h, i) => {
    if (h) col[h] = i;
  });
  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const get = (name) => (col[name] != null ? txt(vals[col[name]]) : null);
    const id = get("원생고유번호");
    if (!id) continue;
    const isEnrolled = get("재원여부") === "O";
    const onHold = get("휴원여부") === "O";
    const withdrawnDate = parseDate(get("퇴원일"));
    let status = "enrolled";
    if (isEnrolled) status = "enrolled";
    else if (onHold) status = "on_hold";
    else if (withdrawnDate) status = "withdrawn";
    const withdrawnAt = status === "withdrawn" ? withdrawnDate : null;
    rows.push({
      makeedu_id: id,
      name: get("이름"),
      gender: gender(get("성별")),
      attendance_code: get("출결번호"),
      school: get("학교"),
      grade: get("학년"),
      student_phone: get("원생연락처"),
      parent_phone: get("보호자연락처"),
      parent_name: get("보호자이름"),
      birth_date: parseDate(get("생일")),
      enrolled_at: parseDate(get("입학일")),
      address: [get("주소1"), get("주소2")].filter(Boolean).join(" ") || null,
      email: get("원생이메일"),
      status,
      withdrawn_at: withdrawnAt,
      notes: get("메모"),
    });
  }
  return rows;
}

/**
 * 추천 필터:
 *  - 재원·휴원 전부
 *  - 퇴원: 학교·학년 있음 + withdrawn_at >= since (기본 2025-01-01, --recommended 시)
 *  - 잡음 이름 제외
 * --enrolled-only: 재원·휴원만
 * --all: 잡음 이름만 제외(퇴원 전량 — 비권장)
 */
function filterRows(rows) {
  const stats = {
    in: rows.length,
    junkName: 0,
    noName: 0,
    droppedWithdrawnOld: 0,
    droppedWithdrawnNoSg: 0,
    droppedOther: 0,
    keptEnrolled: 0,
    keptOnHold: 0,
    keptWithdrawn: 0,
  };
  const out = [];
  for (const r of rows) {
    if (!r.name) {
      stats.noName++;
      continue;
    }
    if (isJunkName(r.name)) {
      stats.junkName++;
      continue;
    }
    if (r.status === "enrolled" || r.status === "on_hold") {
      if (r.status === "enrolled") stats.keptEnrolled++;
      else stats.keptOnHold++;
      out.push(r);
      continue;
    }
    if (r.status === "withdrawn") {
      if (ENROLLED_ONLY) {
        stats.droppedOther++;
        continue;
      }
      if (!ALL) {
        // recommended / withdrawn-since 경로: 학교·학년 필수
        if (!r.school || !r.grade) {
          stats.droppedWithdrawnNoSg++;
          continue;
        }
        if (WITHDRAWN_SINCE && (!r.withdrawn_at || r.withdrawn_at < WITHDRAWN_SINCE)) {
          stats.droppedWithdrawnOld++;
          continue;
        }
      }
      stats.keptWithdrawn++;
      out.push(r);
      continue;
    }
    stats.droppedOther++;
  }
  stats.out = out.length;
  return { rows: out, stats };
}

(async () => {
  if (!RECOMMENDED && !ENROLLED_ONLY && !ALL && !WITHDRAWN_SINCE) {
    console.log(
      "필터 미지정 — 기본은 전체 파싱 후 additive(레거시).\n" +
        "권장: --recommended  (재원 + 퇴원≥2025-01-01·학교학년 + 잡음제외)\n" +
        "  또는 --enrolled-only / --all / --withdrawn-since=YYYY-MM-DD",
    );
  }

  const file = fileArg || latestFile("원생목록");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  let rows = mapRows(wb.worksheets[0]);

  console.log("file:", path.basename(file));
  console.log("parsed (raw):", rows.length);
  console.log(
    "status dist raw:",
    rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
  );

  const useFilter = RECOMMENDED || ENROLLED_ONLY || ALL || !!WITHDRAWN_SINCE;
  if (useFilter) {
    const mode = ENROLLED_ONLY
      ? "enrolled-only"
      : ALL
        ? "all(junk-name only)"
        : `recommended/withdrawn-since=${WITHDRAWN_SINCE || "—"}`;
    console.log("filter mode:", mode);
    const filtered = filterRows(rows);
    console.log("filter stats:", filtered.stats);
    rows = filtered.rows;
    console.log(
      "status dist filtered:",
      rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
    );
  }

  console.log("dup makeedu_id:", rows.length - new Set(rows.map((r) => r.makeedu_id)).size);
  console.log("missing name:", rows.filter((r) => !r.name).length);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    console.log("target tenant:", tenantId);
    const existing = await sql`
      select id, makeedu_id, name, school, grade, status from students where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existing.filter((e) => e.makeedu_id).map((e) => [e.makeedu_id, e.id]));
    const activeNatural = new Set(
      existing.filter((e) => e.status !== "withdrawn").map((e) => `${L.normalizeName(e.name)}|${e.school || ""}|${e.grade || ""}`),
    );
    const match = L.tieredMatcher(existing, [
      (r) => `${L.normalizeName(r.name)}|${r.school || ""}|${r.grade || ""}`,
      (r) => `${L.normalizeName(r.name)}|${r.grade || ""}`,
      (r) => L.normalizeName(r.name),
    ]);

    const toLink = [];
    const toInsert = [];
    let alreadyLinked = 0;
    let skippedDup = 0;
    for (const r of rows) {
      if (byMakeedu.has(r.makeedu_id)) {
        alreadyLinked++;
        continue;
      }
      const id = match(r);
      if (id) {
        toLink.push({ id, makeedu_id: r.makeedu_id });
        continue;
      }
      if (activeNatural.has(`${L.normalizeName(r.name)}|${r.school || ""}|${r.grade || ""}`)) {
        skippedDup++;
        continue;
      }
      toInsert.push(r);
    }
    console.log(`\n[additive] eywa 기존 학생 ${existing.length} | makeedu(필터후) ${rows.length}`);
    console.log(`  이미 연결됨(재실행): ${alreadyLinked}`);
    console.log(`  eywa 매칭 → makeedu_id 백필: ${toLink.length}`);
    console.log(`  eywa에 없음 → 신규 추가: ${toInsert.length}`);
    if (skippedDup) console.log(`  활성 동일 자연키 존재(모호 미연결) → 스킵: ${skippedDup}`);
    if (toInsert.length) {
      const bySt = toInsert.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
      console.log("  신규 status:", bySt);
      console.log(
        "  신규 표본:",
        toInsert
          .slice(0, 8)
          .map((r) => `${r.name}/${r.school || "?"}/${r.grade || "?"}/${r.status}`)
          .join(", "),
      );
    }

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    let linked = 0;
    let inserted = 0;
    for (const t of toLink) {
      const res = await sql`
        update students set makeedu_id = ${t.makeedu_id}, updated_at = now()
        where id = ${t.id} and makeedu_id is null`;
      linked += res.count;
    }
    for (const r of toInsert) {
      try {
        await sql`
          insert into students
            (tenant_id, makeedu_id, name, gender, attendance_code, school, grade,
             student_phone, parent_phone, parent_name, birth_date, enrolled_at,
             address, email, status, withdrawn_at, notes)
          values
            (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.gender}, ${r.attendance_code},
             ${r.school}, ${r.grade}, ${r.student_phone}, ${r.parent_phone}, ${r.parent_name},
             ${r.birth_date}, ${r.enrolled_at}, ${r.address}, ${r.email}, ${r.status},
             ${r.withdrawn_at}, ${r.notes})
          on conflict (tenant_id, makeedu_id) where makeedu_id is not null do nothing`;
        inserted++;
      } catch (e) {
        if (/ux_students_active_natural_key|unique|duplicate/i.test(e.message)) {
          skippedDup++;
          continue;
        }
        throw e;
      }
    }
    await L.recordSync(sql, tenantId, "students", linked + inserted);
    console.log(
      `\nbackfilled makeedu_id: ${linked} | inserted new: ${inserted}` +
        (skippedDup ? ` | skipped(자연키 중복): ${skippedDup}` : ""),
    );
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
