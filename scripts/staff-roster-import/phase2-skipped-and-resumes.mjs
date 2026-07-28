// 직원명부 이관 2차(원장 지시 2026-07-28) — ① 스킵됐던 인원을 동명이라도 **직원 행으로 추가**
// (이메일은 @imported.local 플레이스홀더 = 직원관리 화면에서 편집 허용 규약) ② 시트에서 온 전원
// (1차 생성·병합 + 이번 추가)에게 **이력서 문서 자동 생성**(없는 사람만) + staff_user_id 연결.
//
//   node scripts/staff-roster-import/phase2-skipped-and-resumes.mjs            # 드라이런
//   node scripts/staff-roster-import/phase2-skipped-and-resumes.mjs --apply    # 적용
//
// · 추가되는 행은 **로그인 계정 없음**(public.users만) — 기존 ijw 이관 강사와 같은 상태.
//   이메일을 실주소로 고치고 계정이 필요해지면 직원관리에서 처리(플레이스홀더는 편집 허용).
// · 이력서 form_data는 시트에서 아는 값만 채움(이름·닉네임·전화·이메일·입사일·부서·근무형태).
//   주민번호·계좌 등은 비움. restricted=true(사무실 전용 + 재인증 게이트).
// · 원복: logs/phase2-<ts>.json — 추가한 users id·생성한 이력서 id 전부 기록.
//   node scripts/staff-roster-import/revert-phase2.mjs logs/phase2-<ts>.json --apply
import { createSign, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SPREADSHEET_ID = "1SV7pEsu9S9fRCEBTAGxNa4c3CZPCko2nFrhyGQi_yjU";
const TARGET_GID = 71189633;
const DATA_ROW_MAX = 200;
const TEACHER_DEPTS = new Set(["영어과", "수학과", "국어과", "수학/과학과", "EIE"]);
const RESUME_DEPARTMENTS = new Set(["영어과", "수학과", "EIE", "경영지원팀", "개발팀", "아르바이트"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

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
function normalizeDate(v) {
  const m = String(v ?? "").match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  let [, y, mo, d] = m;
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}
const clean = (v) => String(v ?? "").trim();
function extractEmploymentType(raw) {
  if (/프리랜서/.test(raw)) return "프리랜서";
  if (/아르바이트|알바/.test(raw)) return "아르바이트";
  if (/정규|급여제/.test(raw)) return "정규직";
  return null;
}

/** 이력서 form_data — resume.ts StaffResumeData와 동일 형태(정규화 통과분만 채움). */
function buildResumeFormData(rec, realEmail) {
  const rows = (n, make) => Array.from({ length: n }, make);
  return {
    personal: {
      name: rec.name,
      nameEn: rec.nickname ?? "",
      residentId: "",
      address: "",
      phone: rec.phone ?? "",
      email: realEmail ?? "",
    },
    photos: [],
    education: rows(4, () => ({ period: "", school: "", major: "", gpa: "", location: "" })),
    career: rows(3, () => ({ company: "", period: "", duties: "", salary: "", leaveReason: "" })),
    certificates: [{ name: "", date: "", issuer: "" }],
    languages: [{ name: "", testDate: "", score: "" }],
    checks: { sexCrime: false, childAbuse: false, eduOffice: false, etcDocs: false },
    contract: {
      company: "",
      // 이력서 근무부서 선택지에 있는 값만(밖 값은 화면 정규화에서 어차피 탈락) — 부서 원문은 users.department가 진실.
      division: RESUME_DEPARTMENTS.has(rec.department ?? "") ? rec.department : "",
      manager: "",
      workDays: [],
      salaryMonthly: "",
      salaryAnnual: "",
      employmentType: rec.employmentType ?? "",
      bank: "",
      account: "",
      startDate: rec.hireDate ?? "",
    },
  };
}

async function main() {
  console.log(`=== 이관 2차: 스킵 인원 추가 + 이력서 일괄 생성 (${APPLY ? "⚠️ 적용" : "드라이런"}) ===\n`);
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
  const existing = await (
    await fetch(`${SB_URL}/rest/v1/users?tenant_id=eq.${tenantId}&select=id,display_name,email&limit=1000`, { headers: H })
  ).json();
  const byEmail = new Map(existing.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const nameCount = new Map();
  for (const u of existing) nameCount.set(u.display_name, (nameCount.get(u.display_name) ?? 0) + 1);
  // 이미 이력서가 연결된 직원(중복 생성 방지)
  const linked = await (
    await fetch(
      `${SB_URL}/rest/v1/academy_documents?form_type=eq.staff_resume&staff_user_id=not.is.null&select=staff_user_id&limit=1000`,
      { headers: H },
    )
  ).json();
  const hasResume = new Set((Array.isArray(linked) ? linked : []).map((d) => d.staff_user_id));

  // 시트 파싱 — 1차와 동일 규약
  const recs = [];
  const seenEmails = new Set();
  let block = "";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const cellB = clean(r[1]);
    const cellC = clean(r[2]);
    if (/직원명부/.test(cellC) || /직원명부/.test(cellB)) {
      block = (cellC || cellB).replace(/\s+/g, " ").trim();
      continue;
    }
    if (clean(r[0]) === "No." || !cellC) continue;
    const name = cellC.split("\n")[0].trim();
    const nickname = (cellC.match(/\(([^)]+)\)/)?.[1] ?? "").trim() || null;
    const email = clean(r[4]).toLowerCase();
    if (email && seenEmails.has(email)) continue; // 겸직 중복은 첫 등장만
    if (email) seenEmails.add(email);
    const contractRaw = clean(r[3]).replace(/\n/g, " ");
    recs.push({
      row: i + 1,
      block,
      name,
      nickname,
      email: email && EMAIL_RE.test(email) ? email : null,
      department: cellB || null,
      employmentType: extractEmploymentType(contractRaw),
      jobTitle: contractRaw && !/^(프리랜서|아르바이트|정규직?)$/.test(contractRaw) ? contractRaw : null,
      hireDate: normalizeDate(r[5]),
      phone: clean(r[7]) || null,
    });
  }

  // 분류: 이메일 매치=기존 직원 / 그 외 = 신규 추가 대상(동명이라도, 원장 지시)
  const toAdd = [];
  const resolved = []; // { userId, rec, realEmail }
  for (const rec of recs) {
    const match = rec.email ? byEmail.get(rec.email) : null;
    if (match) {
      resolved.push({ userId: match.id, rec, realEmail: rec.email, why: "기존(이메일 일치)" });
    } else {
      const dupName = nameCount.has(rec.name);
      toAdd.push({ ...rec, dupName });
    }
  }

  console.log(`── ① 직원 행 추가 대상 ${toAdd.length}명 (로그인 계정 없음 · 이메일은 편집용 플레이스홀더) ──`);
  for (const r of toAdd)
    console.log(
      `  ${String(r.row).padStart(3)}행 ${r.name.padEnd(6)} ${r.department ?? "-"} · ${r.employmentType ?? "-"} · ${r.jobTitle ?? "-"} · 입사 ${r.hireDate ?? "-"}${r.dupName ? "  ⚠ 동명 기존 직원 있음(중복 가능성 — 확인 후 한쪽 정리)" : ""}`,
    );
  const resumeTargets = [...resolved];
  console.log(`\n── ② 이력서 생성 — 기존 직원(이메일 일치) 중 이력서 없는 사람 + 이번 추가 인원 전원 ──`);
  const existingNeeding = resolved.filter((x) => !hasResume.has(x.userId));
  console.log(`  기존 직원 이력서 생성 ${existingNeeding.length}명 + 추가 인원 ${toAdd.length}명 = 총 ${existingNeeding.length + toAdd.length}건`);

  if (!APPLY) {
    console.log("\n드라이런 종료 — 변경 없음. 적용은 --apply.");
    return;
  }

  const log = { ranAt: new Date().toISOString(), tenantId, addedUsers: [], createdResumes: [] };
  // ① users 행 추가(직접 INSERT — auth 없음, ijw 이관 강사와 동일 상태)
  for (const r of toAdd) {
    const id = randomUUID();
    const placeholder = `sheet-${r.row}-${id.slice(0, 8)}@imported.local`;
    const role = TEACHER_DEPTS.has(r.department ?? "") ? "teacher" : "viewer";
    const res = await fetch(`${SB_URL}/rest/v1/users`, {
      method: "POST",
      headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        id,
        tenant_id: tenantId,
        email: placeholder,
        display_name: r.name,
        system_role: role,
        status: "active",
        phone: r.phone,
        hire_date: r.hireDate,
        job_title: r.jobTitle,
        english_name: r.nickname,
        department: r.department,
        employment_type: r.employmentType,
      }),
    });
    if (!res.ok) {
      console.log(`  ✗ 추가 실패 ${r.name} (${res.status}) ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    log.addedUsers.push({ userId: id, name: r.name, row: r.row, placeholder });
    resumeTargets.push({ userId: id, rec: r, realEmail: null, why: "신규 추가" });
    console.log(`  ✓ 추가 ${r.name} (${role}${r.dupName ? ", ⚠동명" : ""})`);
  }
  // ② 이력서 생성(연결 없는 사람만)
  for (const t of resumeTargets) {
    if (hasResume.has(t.userId)) continue;
    const res = await fetch(`${SB_URL}/rest/v1/academy_documents`, {
      method: "POST",
      headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        tenant_id: tenantId,
        title: `직원 이력서 — ${t.rec.name}`,
        category: "hr",
        kind: "form",
        form_type: "staff_resume",
        form_data: buildResumeFormData(t.rec, t.realEmail),
        restricted: true,
        description: "직원 이력서 (직원명부 시트 이관 자동 생성)",
        uploaded_by: null,
        staff_user_id: t.userId,
      }),
    });
    if (!res.ok) {
      console.log(`  ✗ 이력서 실패 ${t.rec.name} (${res.status})`);
      continue;
    }
    const [doc] = await res.json();
    hasResume.add(t.userId);
    log.createdResumes.push({ docId: doc.id, userId: t.userId, name: t.rec.name });
    console.log(`  ✓ 이력서 ${t.rec.name}`);
  }

  await fetch(`${SB_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      tenant_id: tenantId,
      actor_id: null,
      actor_name: "직원명부 이관 스크립트",
      action: "staff_roster_import",
      target_type: "users",
      target_label: `2차: 직원 추가 ${log.addedUsers.length} · 이력서 생성 ${log.createdResumes.length}`,
      metadata: { addedIds: log.addedUsers.map((a) => a.userId), resumeIds: log.createdResumes.map((c) => c.docId) },
    }),
  });
  const logDir = join(HERE, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `phase2-${log.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  console.log(`\n완료 — 직원 추가 ${log.addedUsers.length} · 이력서 생성 ${log.createdResumes.length}`);
  console.log(`원복 로그: ${logPath}`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
