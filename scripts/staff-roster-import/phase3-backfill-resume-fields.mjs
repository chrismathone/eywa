// 이관 3차(원장 지시 2026-07-28) — 1·2차에서 의도적으로 뺐던 시트 필드를 **이력서 form_data**에 백필.
//   주민번호(G) · 학력(M — "학교\n전공") · 은행(N) · 계좌번호(O) + 비어 있으면 직급도.
//   ⚠️ 시트 '계약조건'(J)은 넣지 않는다 — 이력서에 그 칸이 없고, 칸 신설은 원장이 명시적으로 거부
//   ("기존 이력서에 있는 것만 넣어", 2026-07-28). 계약조건은 시트가 진실로 유지.
// users 테이블이 아니라 이력서(restricted 문서)에 넣는다 — 민감 정보는 원장·관리자 게이트 뒤.
//
//   node scripts/staff-roster-import/phase3-backfill-resume-fields.mjs            # 드라이런
//   node scripts/staff-roster-import/phase3-backfill-resume-fields.mjs --apply    # 적용
//
// 매칭: ① 이메일 일치 ② 2차 추가분은 플레이스홀더(sheet-{행}-…@imported.local)의 행 번호.
// **빈 칸만 채운다**(수기 수정 절대 안 덮음). 원복: logs/phase3-<ts>.json에 문서별 이전 form_data 전체 보존.
//   node scripts/staff-roster-import/revert-phase3.mjs logs/phase3-<ts>.json --apply
import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SPREADSHEET_ID = "1SV7pEsu9S9fRCEBTAGxNa4c3CZPCko2nFrhyGQi_yjU";
const TARGET_GID = 71189633;
const DATA_ROW_MAX = 200;

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

function loadServiceAccount() {
  for (const raw of [env.GOOGLE_SERVICE_ACCOUNT_KEY, env.FIREBASE_SERVICE_ACCOUNT_KEY]) {
    if (!raw) continue;
    try {
      const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf-8");
      const sa = JSON.parse(text);
      if (sa.client_email && sa.private_key) return sa;
    } catch {
      /* 다음 후보 */
    }
  }
  for (const p of [
    "C:/Users/aaa/Downloads/ijw-calander-firebase-adminsdk-fbsvc-8118e87054.json",
    "C:/Users/aaa/Downloads/ijw-calander-firebase-adminsdk-fbsvc-d9e39d8d2b.json",
  ]) {
    if (existsSync(p)) {
      const sa = JSON.parse(readFileSync(p, "utf-8"));
      if (sa.client_email && sa.private_key) return sa;
    }
  }
  throw new Error("구글 서비스계정 키 없음");
}
async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const json = await (
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
    })
  ).json();
  if (!json.access_token) throw new Error("구글 토큰 실패");
  return json.access_token;
}
const clean = (v) => String(v ?? "").trim();

async function main() {
  console.log(`=== 이관 3차: 이력서 민감 필드 백필 (${APPLY ? "⚠️ 적용" : "드라이런"}) ===\n`);
  const sa = loadServiceAccount();
  const token = await googleToken(sa);
  const gh = { Authorization: `Bearer ${token}` };
  const meta = await (
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`, { headers: gh })
  ).json();
  const tab = meta.sheets.map((s) => s.properties).find((p) => p.sheetId === TARGET_GID);
  const vals = await (
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tab.title}'!A1:T${DATA_ROW_MAX}`)}`,
      { headers: gh },
    )
  ).json();
  const rows = vals.values ?? [];

  const tenants = await (await fetch(`${SB_URL}/rest/v1/tenants?select=id,name`, { headers: H })).json();
  if (!Array.isArray(tenants) || tenants.length !== 1) throw new Error("테넌트 1개 아님 — 중단");
  const tenantId = tenants[0].id;
  const users = await (
    await fetch(`${SB_URL}/rest/v1/users?tenant_id=eq.${tenantId}&select=id,display_name,email&limit=1000`, { headers: H })
  ).json();
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  // 2차 추가분: sheet-{행}-… 플레이스홀더 → 행 번호로 역매칭.
  const byRow = new Map();
  for (const u of users) {
    const m = /^sheet-(\d+)-/.exec(String(u.email ?? ""));
    if (m) byRow.set(Number(m[1]), u);
  }
  const docs = await (
    await fetch(
      `${SB_URL}/rest/v1/academy_documents?form_type=eq.staff_resume&staff_user_id=not.is.null&select=id,staff_user_id,form_data&order=created_at.desc&limit=1000`,
      { headers: H },
    )
  ).json();
  const docByUser = new Map();
  for (const d of docs) if (!docByUser.has(d.staff_user_id)) docByUser.set(d.staff_user_id, d);

  // 시트 파싱 — 블록/헤더 스킵, 겸직 중복은 첫 등장만.
  const plan = [];
  const seenEmails = new Set();
  const seenUsers = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cellB = clean(r[1]);
    const cellC = clean(r[2]);
    if (/직원명부/.test(cellC) || /직원명부/.test(cellB)) continue;
    if (clean(r[0]) === "No." || !cellC) continue;
    const rowNo = i + 1;
    const name = cellC.split("\n")[0].trim();
    const email = clean(r[4]).toLowerCase();
    if (email) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
    }
    const user = (email && byEmail.get(email)) || byRow.get(rowNo) || null;
    if (!user) {
      plan.push({ rowNo, name, skip: "매칭되는 직원 없음(1차 스킵분과 동일 사유)" });
      continue;
    }
    if (seenUsers.has(user.id)) continue; // 같은 직원 중복 행(겸직) 방지
    seenUsers.add(user.id);
    const doc = docByUser.get(user.id);
    if (!doc) {
      plan.push({ rowNo, name, skip: "연결된 이력서 없음" });
      continue;
    }
    // 시트 값(원문 유지 — 줄바꿈 포함)
    const residentId = clean(r[6]);
    const eduRaw = clean(r[12]);
    const bank = clean(r[13]);
    const account = clean(r[14]);
    const jobTitleRaw = clean(r[3]).replace(/\n/g, " ");
    const eduLines = eduRaw.split("\n").map((s) => s.trim()).filter(Boolean);
    const eduSchool = eduLines[0] ?? "";
    const eduMajor = eduLines.slice(1).join(" ");

    // 빈 칸만 채우는 패치 계산 — 수기 입력 절대 안 덮음.
    const fd = doc.form_data ?? {};
    const personal = { ...(fd.personal ?? {}) };
    const contract = { ...(fd.contract ?? {}) };
    const education = Array.isArray(fd.education) ? fd.education.map((e) => ({ ...e })) : [];
    const changes = [];
    if (residentId && !clean(personal.residentId)) {
      personal.residentId = residentId;
      changes.push("주민번호");
    }
    if (bank && !clean(contract.bank)) {
      contract.bank = bank;
      changes.push("은행");
    }
    if (account && !clean(contract.account)) {
      contract.account = account;
      changes.push("계좌번호");
    }
    const eduEmpty = !education.some((e) => clean(e?.school));
    if (eduSchool && eduEmpty) {
      while (education.length < 4) education.push({ period: "", school: "", major: "", gpa: "", location: "" });
      education[0] = { ...education[0], school: eduSchool, major: eduMajor };
      changes.push("학력");
    }
    if (jobTitleRaw && !/^(프리랜서|아르바이트|정규직?)$/.test(jobTitleRaw) && !clean(contract.jobTitle)) {
      contract.jobTitle = jobTitleRaw;
      changes.push("직급");
    }
    if (changes.length === 0) {
      plan.push({ rowNo, name, skip: "채울 값 없음(이미 채워짐/시트 빈 칸)" });
      continue;
    }
    plan.push({
      rowNo,
      name,
      docId: doc.id,
      userId: user.id,
      changes,
      prevFormData: fd,
      nextFormData: { ...fd, personal, contract, education },
    });
  }

  const updates = plan.filter((p) => !p.skip);
  console.log(`── 백필 대상 ${updates.length}건 ──`);
  for (const p of updates) console.log(`  ${String(p.rowNo).padStart(3)}행 ${p.name.padEnd(6)} ← ${p.changes.join(", ")}`);
  console.log(`\n── 스킵 ${plan.length - updates.length}건 ──`);
  for (const p of plan.filter((x) => x.skip)) console.log(`  ${String(p.rowNo).padStart(3)}행 ${p.name.padEnd(6)} — ${p.skip}`);

  if (!APPLY) {
    console.log("\n드라이런 종료 — 변경 없음. 적용은 --apply.");
    return;
  }

  const log = { ranAt: new Date().toISOString(), tenantId, updated: [] };
  for (const p of updates) {
    const res = await fetch(`${SB_URL}/rest/v1/academy_documents?id=eq.${p.docId}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ form_data: p.nextFormData, updated_at: new Date().toISOString() }),
    });
    if (res.ok) {
      log.updated.push({ docId: p.docId, name: p.name, changes: p.changes, prevFormData: p.prevFormData });
      console.log(`  ✓ ${p.name} (${p.changes.join(", ")})`);
    } else {
      console.log(`  ✗ ${p.name} (${res.status})`);
    }
  }
  await fetch(`${SB_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      tenant_id: tenantId,
      actor_id: null,
      actor_name: "직원명부 이관 스크립트",
      action: "staff_roster_import",
      target_type: "academy_documents",
      target_label: `3차 백필: 이력서 ${log.updated.length}건(주민번호·학력·은행·계좌)`,
      metadata: { docIds: log.updated.map((u) => u.docId) },
    }),
  });
  const logDir = join(HERE, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `phase3-${log.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  console.log(`\n완료 — 이력서 ${log.updated.length}건 백필`);
  console.log(`원복 로그: ${logPath}`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
