/**
 * 옛 콜앤상담 구글시트(xlsx) → eywa enrollment_consultations 이관. (2026-08-04, 0177a와 짝)
 *
 * 배경: 콜앤상담 기록이 워크북 2개 + 구글폼 + 노션에 흩어져 있었고, eywa는 2024-06~2025-09가 통째로
 * 비어 있었다(makeedu 이관분이 2024-05에서 끊김). 목적은 "이달 상담 몇 건 / 작년 대비" 지표라
 * 지표에 쓰이는 필드만 가져온다(신규콜 1주·4주·출석·셔틀비·교재비 등은 소비처가 없어 일부러 제외).
 *
 * ⚠️ 데이터 파일은 리포에 안 넣는다(학생 이름·전화번호 = PII). xlsx 경로를 인자로 준다.
 *
 * 실행(eywa 루트에서):
 *   node --env-file=.env.local scripts/_poc_migration/import-legacy-consultations.cjs --xlsx "D:/tmp/s1.xlsx,D:/tmp/s2.xlsx"
 *   node --env-file=.env.local scripts/_poc_migration/import-legacy-consultations.cjs --xlsx "..." --apply
 *
 * 멱등: legacy_key(`YYYY-MM|이름|전화뒤8자`)의 부분 유니크 인덱스(0177a)로 재실행해도 중복이 안 생긴다.
 * 추가로 "같은 달·같은 이름" / "이름+전화" 가 이미 있으면(수기·makeedu·QR 유입분) 건너뛴다.
 */
const path = require("node:path");
const postgres = require("postgres");
const ExcelJS = require("exceljs");

const APPLY = process.argv.includes("--apply");
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const XLSX = (argOf("--xlsx") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const NOTION_DS = argOf("--notion"); // 노션 `입학 상담 카드 DB`의 data_source id
const DUMP = argOf("--dump"); // 병합 결과를 JSON으로 (검토용, PII 포함 — 리포 밖에만)
const TENANT_SLUG = argOf("--tenant") ?? "injaewon";

if (!XLSX.length && !NOTION_DS) {
  console.error("사용법: --xlsx \"경로1.xlsx,경로2.xlsx\" [--notion <data_source_id>] [--tenant injaewon] [--apply]");
  process.exit(1);
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const nName = (s) => String(s ?? "").replace(/[\s()（）]/g, "").trim();
const nPhone = (s) => String(s ?? "").replace(/\D/g, "").replace(/^82/, "0");
const phoneTail = (s) => nPhone(s).slice(-8);

function cellText(c) {
  const v = c && c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) {
      const p = (n) => String(n).padStart(2, "0");
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("hyperlink" in v) return String(v.text ?? v.hyperlink);
    return "";
  }
  return String(v);
}

// 헤더 라벨 → 정규 필드. 시대별 표기 흔들림(2023 / 2024 / 2025.1~7 / 2025.10~)을 여기서 전부 흡수.
const HEADER_MAP = [
  [/^(문의 ?일자|접수일)/, "receivedDate"], [/^(학생이름|이름)$/, "name"], [/^전화번호$/, "phone"],
  [/^(문의내용|상담과목)$/, "subject"], [/^학교$/, "school"], [/^학년$/, "grade"],
  [/^학교학년$/, "schoolGrade"], [/^(전화수신자?|수신자)$/, "receiver"], [/^(유입경로|상담경로)$/, "pathway"],
  [/^상담자$/, "counselor"], [/^입학점수$/, "score"], [/^(상담일자|상담일)$/, "consultDate"],
  [/^(상담내용|내용)$/, "log"], [/^결제일$/, "payDate"], [/^결제수강료/, "amount"], [/^결제금액/, "amount"],
  [/^(수학|영어|국어)수강료$/, "amountPart"], [/^등록여부$/, "regStatus"], [/^등록자$/, "registrar"],
  [/^미등록사유$/, "nonRegReason"], [/^후속조치일$/, "followUpDate"], [/^후속조치 ?내용$/, "followUpContent"],
];
const mapHeader = (label) => {
  const l = norm(label);
  for (const [re, f] of HEADER_MAP) if (re.test(l)) return f;
  return null;
};

const DATE_RE = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})|^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
function parseDate(raw, monthHint) {
  const s = norm(raw);
  if (!s) return null;
  const m = s.match(DATE_RE);
  if (m) {
    const y = m[1] ? +m[1] : 2000 + +m[4], mo = m[1] ? +m[2] : +m[5], d = m[1] ? +m[3] : +m[6];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const md = s.match(/^(\d{1,2})[.\-/](\d{1,2})(?!\d)/); // "3.4" "12/28" → 탭 연도 기준
  if (md && monthHint) {
    const yy = monthHint.slice(0, 4), mo = +md[1], d = +md[2];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${yy}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function tabMonth(name) {
  let m = name.match(/(20\d{2})[.\-\s]*(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, "0")}`;
  m = name.match(/^(\d{1,2})월$/); // 2026 워크북: 10~12월=2025, 1~8월=2026
  if (m) return `${+m[1] >= 10 ? 2025 : 2026}-${String(+m[1]).padStart(2, "0")}`;
  return null;
}

const splitSchoolGrade = (v) => {
  const m = norm(v).match(/^(.*?[초중고](?:등학교|등)?)\s*(\d)\s*$/);
  return m ? { school: m[1], grade: m[2] } : { school: norm(v) || null, grade: null };
};
const money = (v) => {
  const n = norm(v).replace(/[₩,\s원]/g, "");
  return /^\d+$/.test(n) ? Number(n) : null;
};

const TAB_RE = /입학상담$|^20\d{2}\.\d{1,2}(월)?$|^\d{1,2}월$/;

async function extract() {
  const out = [];
  for (const file of XLSX) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const tag = path.basename(file).replace(/\.xlsx$/i, "");
    for (const ws of wb.worksheets) {
      if (!TAB_RE.test(ws.name)) continue;
      const month = tabMonth(ws.name);
      if (!month) continue;

      // 헤더 행 = '학생이름'/'이름'이 있는 첫 행(최대 6행 안). 시대마다 2행 또는 3행.
      let hdrRow = 0;
      const cols = {};
      for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
        const labels = [];
        for (let c = 1; c <= ws.columnCount; c++) labels.push(norm(cellText(ws.getRow(r).getCell(c))));
        if (!labels.some((l) => l === "학생이름" || l === "이름")) continue;
        hdrRow = r;
        labels.forEach((l, i) => {
          const f = mapHeader(l);
          if (f) (cols[f] = cols[f] || []).push(i + 1);
        });
        break;
      }
      if (!hdrRow) { console.warn(`  ⚠️ ${tag}/${ws.name}: 헤더 못 찾음 — 건너뜀`); continue; }

      // 🔴 상담 기록 본문은 2023.12~2025.7 탭에서 **헤더가 없는 열**에 있다(헤더 자리엔 "전" 같은 잔해나
      //    "전화수신자 반드시 기재!!" 안내 배너). 헤더로는 못 찾으니 **평균 길이가 가장 긴 열**로 찾는다.
      //    실측상 후보가 탭마다 정확히 1개(평균 147~164자)라 오탐이 없다.
      const sum = new Array(ws.columnCount).fill(0), cnt = new Array(ws.columnCount).fill(0);
      for (let r = hdrRow + 1; r <= Math.min(ws.rowCount, hdrRow + 60); r++)
        for (let c = 1; c <= ws.columnCount; c++) {
          const s = cellText(ws.getRow(r).getCell(c));
          if (s) { sum[c - 1] += s.length; cnt[c - 1]++; }
        }
      let logCol = 0, best = 25;
      for (let i = 0; i < ws.columnCount; i++) {
        const avg = cnt[i] ? sum[i] / cnt[i] : 0;
        if (avg > best) { best = avg; logCol = i + 1; }
      }
      if (logCol) cols.log = [logCol, ...(cols.log || [])];

      const get = (row, f) => {
        for (const c of cols[f] || []) { const v = norm(cellText(row.getCell(c))); if (v) return v; }
        return "";
      };

      for (let r = hdrRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const name = get(row, "name");
        if (!name || name.length > 12 || /^(합계|총계|계)$/.test(name)) continue;

        let school = get(row, "school"), grade = get(row, "grade");
        if (!school && cols.schoolGrade) {
          const sg = splitSchoolGrade(get(row, "schoolGrade"));
          school = sg.school; grade = sg.grade || "";
        }
        let amount = money(get(row, "amount"));
        if (amount === null && cols.amountPart)
          amount = cols.amountPart.map((c) => money(cellText(row.getCell(c)))).filter(Boolean)
            .reduce((a, b) => a + b, 0) || null;

        out.push({
          src: `${tag}/${ws.name}`, month, name,
          phone: get(row, "phone") || null, school: school || null, grade: grade || null,
          subject: get(row, "subject") || null, receiver: get(row, "receiver") || null,
          pathway: get(row, "pathway") || null, counselor: get(row, "counselor") || null,
          receivedDate: parseDate(get(row, "receivedDate"), month),
          consultDate: parseDate(get(row, "consultDate"), month),
          regStatus: get(row, "regStatus") || null, registrar: get(row, "registrar") || null,
          amount, payDate: parseDate(get(row, "payDate"), month), score: get(row, "score") || null,
          log: get(row, "log") || null, nonRegReason: get(row, "nonRegReason") || null,
          followUpDate: parseDate(get(row, "followUpDate"), month),
          followUpContent: get(row, "followUpContent") || null,
          // 1열의 의미가 시대마다 다르다(2023 전반=문의일자 / 2023.12~2025.7=상태범례 / 2025.10~=No.).
          // 범례가 있는 탭(헤더 3행)에서만 상태로 인정한다.
          statusFlag: hdrRow === 3 ? norm(cellText(row.getCell(1))) || null : null,
        });
      }
    }
  }
  return out;
}

/**
 * 노션 `입학 상담 카드 DB` → 시트와 같은 중간 형태로. 2025-08·09는 **노션에만 있다**(시트에 탭이 없다).
 * 시트가 콜 기록이라면 노션은 상담 카드라 축이 다르지만, "몇 건 상담했나"는 같은 사실을 센다.
 */
async function fetchNotion(dataSourceId) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN 없음 — .env.local 확인");
  const headers = { Authorization: `Bearer ${token}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" };
  const val = (p) => {
    if (!p) return null;
    switch (p.type) {
      case "title": case "rich_text": return p[p.type].map((t) => t.plain_text).join("").trim() || null;
      case "select": return (p.select && p.select.name) || null;
      case "status": return (p.status && p.status.name) || null;
      case "multi_select": return p.multi_select.map((s) => s.name).join(", ") || null;
      case "phone_number": return p.phone_number || null;
      case "number": return p.number;
      case "date": return (p.date && p.date.start) || null;
      case "created_time": return p.created_time;
      case "formula": return (p.formula && (p.formula.string || p.formula.number)) || null;
      default: return null;
    }
  };
  const out = [];
  let cursor = null;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST", headers,
      body: JSON.stringify(Object.assign({ page_size: 100 }, cursor ? { start_cursor: cursor } : {})),
    });
    const j = await res.json();
    if (j.object === "error") throw new Error(`Notion: ${j.code} ${j.message}`);
    for (const page of j.results) {
      const P = page.properties;
      const name = val(P["학생이름"]);
      if (!name) continue;
      const iso = val(P["접수 일시"]) || val(P["생성 일시"]) || page.created_time;
      const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000); // KST 날짜로 고정
      const date = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
      out.push({
        src: "notion/입학 상담 카드 DB", month: date.slice(0, 7), name,
        phone: val(P["부모님 연락처"]) || val(P["학생 연락처"]),
        school: val(P["학교"]), grade: val(P["학년"]),
        subject: val(P["상담 과목"]), receiver: null,
        pathway: val(P["상담경로"]), counselor: val(P["⭐상담자⭐"]),
        receivedDate: date, consultDate: null,
        regStatus: val(P["등록현황"]), registrar: null,
        amount: val(P["수강료"]) || null, payDate: null, score: null,
        log: val(P["상담기록(통합)"]), nonRegReason: null,
        followUpDate: null, followUpContent: null, statusFlag: null,
      });
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  console.log(`노션 ${out.length}행 수집`);
  return out;
}

// 등록 판정: 명시 컬럼 → 상태범례 → 결제흔적. 근거가 없으면 '상담완료'(등록으로 부풀리지 않는다).
function deriveOutcome(r) {
  const reg = r.regStatus || "";
  // 노션 `등록현황`은 과목별 다중값이라 "미등록-영어, 등록-수학"처럼 섞인다 → **한 과목이라도 등록이면 등록**.
  // 단순 /등록/ 매칭은 "미등록"에도 걸리므로 토큰 단위로 본다.
  if (/[-\s]/.test(reg) && reg.includes("등록-")) {
    const tokens = reg.split(/\s*,\s*/);
    if (tokens.some((t) => t.startsWith("등록-"))) return "enrolled";
    if (tokens.some((t) => t.startsWith("미등록-"))) return "declined";
  }
  if (/입학거부/.test(reg)) return "declined";
  if (/미등록/.test(reg)) return "declined";
  if (/등록예정/.test(reg)) return "consulted";
  if (/등록/.test(reg)) return "enrolled";
  const f = (r.statusFlag || "").replace(/\s/g, "");
  if (f === "등록완료") return "enrolled";
  if (f === "미등록" || f === "등록취소") return "declined";
  if (f === "noshow") return "no_show";
  if (r.amount || r.payDate) return "enrolled";
  return "consulted";
}

async function main() {
  console.log(`${APPLY ? "★ 적용(--apply)" : "dry-run"} · xlsx ${XLSX.length}개${NOTION_DS ? " + 노션" : ""} · tenant=${TENANT_SLUG}\n`);
  const raw = (await extract()).concat(NOTION_DS ? await fetchNotion(NOTION_DS) : []);

  // 워크북 간 중복 병합(같은 달·같은 이름·같은 전화) — 필드는 "채워진 쪽"을 취한다.
  const FIELDS = ["phone","school","grade","subject","receiver","pathway","counselor","receivedDate",
    "consultDate","regStatus","registrar","amount","payDate","score","log","nonRegReason",
    "followUpDate","followUpContent","statusFlag"];
  const absorb = (cur, r) => {
    cur.srcs.push(r.src);
    for (const f of FIELDS) if (!cur[f] && r[f]) cur[f] = r[f];
  };

  // 1차: (월|이름|전화뒤8자) 정확일치.
  const merged = new Map();
  for (const r of raw) {
    const key = `${r.month}|${nName(r.name)}|${phoneTail(r.phone)}`;
    const cur = merged.get(key);
    if (!cur) merged.set(key, Object.assign({ legacyKey: key, srcs: [r.src] }, r));
    else absorb(cur, r);
  }

  // 2차: 🔴 한쪽 워크북엔 전화번호가 있고 다른 쪽엔 비어 있으면 1차에서 **다른 키가 되어 두 건으로 남는다**.
  // 전화 없는 건을 같은 (월|이름)의 전화 있는 건에 흡수시킨다. 전화가 서로 '다른' 동명이인은 건드리지 않는다.
  const withPhone = new Map();
  for (const e of merged.values())
    if (phoneTail(e.phone).length >= 8) {
      const k = `${e.month}|${nName(e.name)}`;
      withPhone.set(k, (withPhone.get(k) || []).concat(e));
    }
  let absorbed = 0;
  for (const [key, e] of [...merged]) {
    if (phoneTail(e.phone).length >= 8) continue;
    const cands = withPhone.get(`${e.month}|${nName(e.name)}`);
    if (!cands || cands.length !== 1) continue; // 후보가 여럿이면 어느 쪽인지 모른다 → 그대로 둔다
    absorb(cands[0], e);
    merged.delete(key);
    absorbed++;
  }

  // 3차: 🔴 같은 학생인데 한쪽은 **학부모 번호**, 한쪽은 **학생 번호**를 적어 1·2차를 다 빠져나가는 경우
  // (실측: 시트 `010-9422-6788` ↔ 노션 `010-8608-6788` = 달성초1 김태빈 한 명). 전화가 다르면
  // 학교+학년이 같을 때만 합친다 — 이래야 같은 달의 진짜 동명이인(경명여중1 박서진 ≠ 남산초6 박서진)이 안 뭉개진다.
  const normSchool = (s) => String(s || "").replace(/\s/g, "").replace(/^대구/, "").replace(/등학교$|학교$/, "").trim();
  const byNameMonth = new Map();
  for (const e of merged.values()) {
    const k = `${e.month}|${nName(e.name)}`;
    byNameMonth.set(k, (byNameMonth.get(k) || []).concat(e));
  }
  let pairMerged = 0;
  for (const list of byNameMonth.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (!a || !b || !merged.has(a.legacyKey) || !merged.has(b.legacyKey)) continue;
        const sa = normSchool(a.school), sb = normSchool(b.school);
        if (!sa || !sb || sa !== sb) continue;
        const ga = norm(a.grade), gb = norm(b.grade);
        if (ga && gb && ga !== gb) continue; // 학년이 둘 다 있고 다르면 남남
        absorb(a, b);
        merged.delete(b.legacyKey);
        pairMerged++;
      }
    }
  }

  const sheet = [...merged.values()];
  console.log(`원본 ${raw.length}행 → 병합 ${sheet.length}행 (전화 결측 흡수 ${absorbed} + 학교·학년 일치 흡수 ${pairMerged})`);

  // 남은 동명이인(같은 달·같은 이름·다른 전화)은 진짜 별개일 수 있으니 지우지 않고 눈에 보이게만 한다.
  const sameNameMonth = new Map();
  for (const e of sheet) {
    const k = `${e.month}|${nName(e.name)}`;
    sameNameMonth.set(k, (sameNameMonth.get(k) || 0) + 1);
  }
  const collisions = [...sameNameMonth].filter(([, n]) => n > 1).map(([k]) => k);
  if (collisions.length) {
    // 🔴 같은 달·같은 이름인데 **출처가 시트와 노션으로 갈리면** 같은 상담을 두 번 셀 위험이 크다
    //    (전화를 한쪽은 학생 번호, 한쪽은 부모 번호로 적어 키가 갈린 경우). 동명이인과 구별해 따로 센다.
    let crossSource = 0;
    for (const k of collisions) {
      const group = sheet.filter((e) => `${e.month}|${nName(e.name)}` === k);
      const srcKinds = new Set(group.map((e) => (e.srcs.some((s) => s.startsWith("notion/")) ? "notion" : "sheet")));
      if (srcKinds.size > 1) crossSource++;
    }
    console.log(`  ↳ 같은 달·같은 이름 ${collisions.length}쌍(전화가 달라 별개로 판단) ` +
      `— 그중 시트↔노션 교차 ${crossSource}쌍${crossSource ? " ⚠️ 같은 상담일 수 있음" : ""}: ` +
      collisions.slice(0, 6).join(", ") + (collisions.length > 6 ? " …" : ""));
  }
  if (DUMP) {
    require("node:fs").writeFileSync(DUMP, JSON.stringify(sheet, null, 1), "utf8");
    console.log(`  ↳ 병합 결과 ${sheet.length}행을 ${DUMP} 에 덤프(검토용, PII 포함 — 리포에 넣지 말 것)`);
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 10 });
  try {
    const [tenant] = await sql`select id from tenants where slug = ${TENANT_SLUG}`;
    if (!tenant) throw new Error(`tenant '${TENANT_SLUG}' 없음`);

    // 상담자/수신자 이름 → 직원 계정. 정확일치 → 성 생략("초롱"→"김초롱") → 원장 지시 별칭 순.
    const staff = await sql`
      select id, display_name from users where tenant_id = ${tenant.id}`;
    const byExact = new Map(), bySuffix = new Map();
    for (const u of staff) {
      const n = nName(u.display_name);
      byExact.set(n, (byExact.get(n) || []).concat(u.id));
      const short = n.slice(1); // 성 제외
      if (short.length >= 2) bySuffix.set(short, (bySuffix.get(short) || []).concat(u.id));
    }
    const ALIAS = { 대표: "원일" }; // 원장 지시(2026-08-04): 시트의 '대표'는 원일.
    const resolveStaff = (label) => {
      let n = nName((label || "").split(/[,/]/)[0]); // "정유진, 대표" → 첫 사람
      if (!n) return null;
      if (ALIAS[n]) n = ALIAS[n];
      const ex = byExact.get(n);
      if (ex && ex.length === 1) return ex[0];
      const sf = bySuffix.get(n);
      if (sf && sf.length === 1) return sf[0];
      return null; // 애매하면 연결하지 않는다 — 텍스트는 counselor/receiver에 그대로 남는다.
    };

    // 0177a 적용 전에도 dry-run이 돌아야 한다(SQL은 원장이 손으로 실행 → push와 적용 사이에 간격).
    const [{ ready }] = await sql`
      select count(*)::int > 0 as ready from information_schema.columns
      where table_schema = 'public' and table_name = 'enrollment_consultations'
        and column_name = 'legacy_key'`;
    if (!ready) {
      if (APPLY) throw new Error("0177a 마이그레이션이 아직 적용되지 않았다 — 먼저 실행할 것.");
      console.log("ℹ️ 0177a 미적용 상태 — dry-run은 진행(legacy_key 대조만 생략).\n");
    }

    const existing = await sql`
      select prospect_name, parent_phone, ${ready ? sql`legacy_key` : sql`null::text as legacy_key`},
             to_char(coalesce(consultation_date, received_date,
                     (consulted_at at time zone 'Asia/Seoul')::date), 'YYYY-MM') as m
      from enrollment_consultations where tenant_id = ${tenant.id}`;
    const exKey = new Set(existing.map((e) => e.legacy_key).filter(Boolean));
    const exMonthName = new Set(existing.map((e) => `${e.m}|${nName(e.prospect_name)}`));
    const exNamePhone = new Set(existing.filter((e) => phoneTail(e.parent_phone).length >= 8)
      .map((e) => `${nName(e.prospect_name)}|${phoneTail(e.parent_phone)}`));

    const skip = { key: 0, monthName: 0, namePhone: 0 };
    const fresh = sheet.filter((r) => {
      if (exKey.has(r.legacyKey)) { skip.key++; return false; }
      if (exMonthName.has(`${r.month}|${nName(r.name)}`)) { skip.monthName++; return false; }
      const t = phoneTail(r.phone);
      if (t.length >= 8 && exNamePhone.has(`${nName(r.name)}|${t}`)) { skip.namePhone++; return false; }
      return true;
    });
    console.log(`eywa 기존 ${existing.length}행 대조 → 건너뜀 ${skip.key}(이관済) + ${skip.monthName}(같은달·같은이름) + ${skip.namePhone}(이름+전화)`);
    console.log(`▶ 이관 대상 ${fresh.length}행\n`);

    const rows = fresh.map((r) => {
      // 지표 축 = consulted_at. 정확한 날짜가 없으면 **해당 월 1일**(원장 지시: 월만이라도 입력).
      const anchor = r.consultDate || r.receivedDate || `${r.month}-01`;
      return {
        tenant_id: tenant.id,
        prospect_name: r.name,
        prospect_school: r.school,
        prospect_grade: r.grade,
        parent_phone: r.phone,
        parent_request: r.log,
        subject: (r.subject || "").replace(/\s*[/,]\s*/g, ", ").trim() || null,
        consultation_path: r.pathway,
        counselor: r.counselor,
        consultant_id: resolveStaff(r.counselor),
        receiver: r.receiver,
        outcome: deriveOutcome(r),
        registration_status: r.regStatus,
        payment_amount: r.amount,
        payment_date: r.payDate,
        registrar: r.registrar,
        non_registration_reason: r.nonRegReason,
        follow_up_date: r.followUpDate,
        follow_up_content: r.followUpContent,
        // 정확한 날짜를 아는 것만 채운다 — 월만 아는 건 비워 둬야 상세 화면이 거짓말을 안 한다.
        consultation_date: r.consultDate,
        received_date: r.receivedDate,
        consulted_at: `${anchor}T00:00:00+09:00`,
        legacy_key: r.legacyKey,
        legacy_source: r.srcs.join(" + "),
      };
    });

    const tally = (f) => {
      const m = new Map();
      for (const r of rows) m.set(f(r), (m.get(f(r)) || 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]);
    };
    // 출처별 — 노션이 시트와 겹치는 달(2025-10~2026-05)에서 새 행을 많이 만들면 같은 상담을
    // 두 번 세고 있다는 신호다. 겹치는 달은 0에 가까워야 정상.
    const bySrc = new Map();
    for (const r of fresh) {
      const s = r.srcs.some((x) => x.startsWith("notion/")) ? "노션" : "시트";
      const e = bySrc.get(s) || new Map();
      e.set(r.month, (e.get(r.month) || 0) + 1);
      bySrc.set(s, e);
    }
    for (const [s, m] of bySrc)
      console.log(`출처 ${s}: ${[...m.values()].reduce((a, b) => a + b, 0)}행  ` +
        [...m].sort().map(([k, v]) => `${k.slice(2)}:${v}`).join(" "));

    console.log("등록판정:", tally((r) => r.outcome).map(([k, v]) => `${k}=${v}`).join("  "));
    console.log("상담자 계정 연결:", rows.filter((r) => r.consultant_id).length, "/", rows.length);
    console.log("정확한 날짜:", rows.filter((r) => r.consultation_date || r.received_date).length,
      "/ 월만:", rows.filter((r) => !r.consultation_date && !r.received_date).length);
    console.log("상담 내용 본문:", rows.filter((r) => r.parent_request).length);
    // 이관 후 월별 커버리지 — "빈 달이 언제인가"가 지표 신뢰의 전제다.
    const exMonth = new Map();
    for (const e of existing) if (e.m) exMonth.set(e.m, (exMonth.get(e.m) || 0) + 1);
    const addMonth = new Map();
    for (const r of rows) {
      const m = r.consulted_at.slice(0, 7);
      addMonth.set(m, (addMonth.get(m) || 0) + 1);
    }
    const all = [...new Set([...exMonth.keys(), ...addMonth.keys()])].sort();
    const [first, last] = [all[0], all[all.length - 1]];
    const empty = [];
    let [y, mo] = first.split("-").map(Number);
    console.log("\n이관 후 월별 (기존 → +이관 = 합계):");
    while (`${y}-${String(mo).padStart(2, "0")}` <= last) {
      const k = `${y}-${String(mo).padStart(2, "0")}`;
      const cur = exMonth.get(k) || 0, add = addMonth.get(k) || 0;
      if (cur + add === 0) empty.push(k);
      console.log(`  ${k}  ${String(cur).padStart(4)} → +${String(add).padStart(4)} = ${String(cur + add).padStart(4)}${cur + add === 0 ? "   ⚠️ 비어 있음" : ""}`);
      if (++mo > 12) { mo = 1; y++; }
    }
    console.log(empty.length ? `\n🔴 이관 후에도 비는 달 ${empty.length}개: ${empty.join(", ")}`
      : `\n✅ ${first} ~ ${last} 전 구간에 빈 달 없음`);

    console.log("\n연도별:");
    for (const [y, n] of tally((r) => r.consulted_at.slice(0, 4)).sort()) {
      const e = rows.filter((r) => r.consulted_at.startsWith(y) && r.outcome === "enrolled").length;
      console.log(`  ${y}  상담 ${String(n).padStart(4)}건  등록 ${String(e).padStart(4)}건  전환율 ${Math.round((e / n) * 100)}%`);
    }

    if (!APPLY) { console.log("\n(dry-run — 쓰지 않았다. 반영하려면 --apply)"); return; }

    let done = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const ins = await sql`
        insert into enrollment_consultations ${sql(chunk, Object.keys(rows[0]))}
        on conflict (tenant_id, legacy_key) where legacy_key is not null do nothing
        returning id`;
      done += ins.length;
      console.log(`  ...${Math.min(i + 200, rows.length)}/${rows.length} (신규 ${done})`);
    }
    console.log(`\n✅ ${done}행 적재 완료.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
