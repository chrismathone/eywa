// 직원명부 구글시트("2026년직원명부" 탭, gid 71189633) → eywa users 최초 이관 스크립트.
// 원장 지시(2026-07-28): 시트에 있는 직원을 사이트에 미리 등록. 지시된 필드 이외는 스킵.
//
// 탭 구조(실측 2026-07-28): 회사 블록이 세로로 이어짐 — 제목행("… 직원명부") → 헤더행(A="No.") → 데이터행들.
//   열: A No. | B 소속부서 | C 이름(줄바꿈 뒤 닉네임) | D 계약구분/직급 | E 구글 메일 | F 입사일 | G 주민번호(안 읽음)
//       H 전화번호 | I~S 계약·계좌 등(안 읽음 — 지시된 필드 이외 스킵). '재직' 열은 없음(퇴직자는 별도 탭).
//
// 사용:
//   node scripts/staff-roster-import/import-staff-from-roster.mjs            # 드라이런(변경 0) — 보고서만
//   node scripts/staff-roster-import/import-staff-from-roster.mjs --apply    # 실제 적용(승인 후에만)
//
// 규칙(원장 답변 반영):
//   · 이름이 기존 직원과 같고 이메일이 다르면(동일 인물 확신 불가) 스킵+보고 → 나중에 수동 추가.
//   · 이메일이 기존 직원과 같으면 = 같은 사람 → 병합(빈 필드만 보강, 기존 값 절대 안 덮음).
//   · 이메일 없음/형식 오류 → 스킵+보고(계정 생성 불가).
//   · 시트 안 중복(같은 이메일이 여러 블록에 등장 — 겸직)은 첫 등장만 반영.
//   · 신규 생성: 초기 비밀번호 eywa123, 역할 = 과(강사진 부서) → teacher, 그 외 → viewer(원장이 이후 조정).
//   · 지시된 필드만 이관: 이름(닉네임→english_name)·이메일·부서·근무형태·직급·입사일·전화. 주민번호·계좌·계약은 안 읽음.
//
// 원복(사고 대비): 적용 시 logs/import-<ts>.json에 생성/보강 내역(이전 값 포함)을 남긴다.
//   node scripts/staff-roster-import/revert-staff-import.mjs logs/import-<ts>.json
import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

const SPREADSHEET_ID = "1SV7pEsu9S9fRCEBTAGxNa4c3CZPCko2nFrhyGQi_yjU";
const TARGET_GID = 71189633;
const DATA_ROW_MAX = 200; // 실데이터 ~53행 + 여유. 그 아래는 안 읽음.
const INITIAL_PASSWORD = "eywa123";
// 강사진으로 보는 부서(→ 역할 teacher). 그 외(경영진·경영팀·차량팀·청소용역 등)는 viewer로 두고 원장이 조정.
const TEACHER_DEPTS = new Set(["영어과", "수학과", "국어과", "수학/과학과", "EIE"]);
const DEPT_KNOWN = new Set(["영어과", "수학과", "EIE", "경영지원팀", "개발팀", "아르바이트"]);
const DEPT_LEGACY = { 경영지원: "경영지원팀" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 계약구분/직급 혼합 열(D) → 근무형태 추출. 못 알아보면 null(직급 원문은 job_title로 보존). */
function extractEmploymentType(raw) {
  if (/프리랜서/.test(raw)) return "프리랜서";
  if (/아르바이트|알바/.test(raw)) return "아르바이트";
  if (/정규|급여제/.test(raw)) return "정규직";
  return null;
}

// ── env / 자격증명 ─────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) throw new Error(".env.local에 SUPABASE URL/SERVICE_ROLE_KEY가 없습니다");
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// 서비스계정: env(GOOGLE_/FIREBASE_SERVICE_ACCOUNT_KEY, base64 또는 raw JSON) → Downloads 폴백.
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
  throw new Error("구글 서비스계정 키를 찾지 못했습니다 (env 또는 Downloads)");
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
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`구글 토큰 발급 실패: ${JSON.stringify(json)}`);
  return json.access_token;
}

// ── 파싱 헬퍼 ─────────────────────────────────────────────────────────────────
/** 입사일 정규화 — "2026-01-05" | "2026.1.5" | "26.01.05" 등 → YYYY-MM-DD, 실패 시 null. */
function normalizeDate(v) {
  const m = String(v ?? "").match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  let [, y, mo, d] = m;
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : null;
}
const clean = (v) => String(v ?? "").trim();

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== 직원명부 시트 → eywa 직원 이관 (${APPLY ? "⚠️ 적용 모드" : "드라이런 — 변경 없음"}) ===\n`);

  // 1) 시트 읽기 (읽기 전용 스코프 — 시트는 절대 수정하지 않는다)
  const sa = loadServiceAccount();
  const token = await googleToken(sa);
  const gh = { Authorization: `Bearer ${token}` };
  const meta = await (
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`, { headers: gh })
  ).json();
  const tab = (meta.sheets ?? []).map((s) => s.properties).find((p) => p.sheetId === TARGET_GID);
  if (!tab) throw new Error(`gid=${TARGET_GID} 탭을 찾지 못했습니다`);
  console.log(`대상 탭: "${tab.title}" (gid ${TARGET_GID})`);
  const vals = await (
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tab.title}'!A1:T${DATA_ROW_MAX}`)}`,
      { headers: gh },
    )
  ).json();
  const rows = vals.values ?? [];

  // 2) 기존 직원 로드 (테넌트 확정 — 정확히 1개 전제). 0147a 미적용이면 새 컬럼 없이 폴백(적용 모드는 중단).
  const tenants = await (await fetch(`${SB_URL}/rest/v1/tenants?select=id,name`, { headers: SB_HEADERS })).json();
  if (!Array.isArray(tenants) || tenants.length !== 1) {
    throw new Error(`테넌트가 1개가 아닙니다(${Array.isArray(tenants) ? tenants.length : "?"}) — 대상 확정 불가, 중단`);
  }
  const tenantId = tenants[0].id;
  let migrationPending = false;
  let existing = await (
    await fetch(
      `${SB_URL}/rest/v1/users?tenant_id=eq.${tenantId}&select=id,display_name,email,phone,hire_date,job_title,english_name,department,employment_type,status&limit=1000`,
      { headers: SB_HEADERS },
    )
  ).json();
  if (!Array.isArray(existing)) {
    migrationPending = true; // department/employment_type 컬럼 미존재(0147a 미적용) — 기본 컬럼으로 폴백
    existing = await (
      await fetch(
        `${SB_URL}/rest/v1/users?tenant_id=eq.${tenantId}&select=id,display_name,email,phone,hire_date,job_title,english_name,status&limit=1000`,
        { headers: SB_HEADERS },
      )
    ).json();
    if (!Array.isArray(existing)) throw new Error(`users 조회 실패: ${JSON.stringify(existing).slice(0, 200)}`);
    console.log("⚠️ users.department/employment_type 컬럼이 아직 없음(0147a 미적용) — 드라이런은 계속, 적용은 마이그레이션 후에.\n");
  }
  if (APPLY && migrationPending) throw new Error("0147a 마이그레이션이 프로덕션에 적용되지 않아 --apply를 중단합니다");
  const byEmail = new Map(existing.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const namesTaken = new Map(); // name → user (동명 검사용, 먼저 온 것)
  for (const u of existing) if (!namesTaken.has(u.display_name)) namesTaken.set(u.display_name, u);
  console.log(`테넌트 ${tenants[0].name} · 기존 직원 ${existing.length}명\n`);

  // 3) 행 분류 — 블록 제목/헤더 행을 걸러내며 순회.
  const plan = { create: [], merge: [], skip: [] };
  const seenEmails = new Set();
  let block = "(블록 미상)";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNo = i + 1;
    const cellB = clean(r[1]);
    const cellC = clean(r[2]);
    if (/직원명부/.test(cellC) || /직원명부/.test(cellB)) {
      block = (cellC || cellB).replace(/\s+/g, " ").trim();
      continue;
    }
    if (clean(r[0]) === "No." || !cellC) continue; // 헤더·빈 행

    const name = cellC.split("\n")[0].trim();
    const nickname = (cellC.match(/\(([^)]+)\)/)?.[1] ?? "").trim() || null;
    const email = clean(r[4]).toLowerCase(); // E 구글 메일
    const deptRaw = clean(r[1]); // B 소속부서
    const dept = DEPT_LEGACY[deptRaw] ?? deptRaw;
    const contractRaw = clean(r[3]).replace(/\n/g, " "); // D 계약구분/직급 혼합
    const empType = extractEmploymentType(contractRaw);
    // 직급: D 원문 보존(단, 순수 계약형태 단어뿐이면 비움 — '프리랜서'만 적힌 칸은 직급이 아님).
    const jobTitle = contractRaw && !/^(프리랜서|아르바이트|정규직?)$/.test(contractRaw) ? contractRaw : null;
    const rec = {
      row: rowNo,
      block,
      name,
      nickname,
      email,
      department: dept || null,
      employmentType: empType,
      jobTitle,
      hireDate: normalizeDate(r[5]), // F 입사일
      hireDateRaw: clean(r[5]),
      phone: clean(r[7]) || null, // H 전화번호
      notes: [],
    };
    if (rec.department && !DEPT_KNOWN.has(rec.department)) rec.notes.push(`부서 '${rec.department}' 선택지 밖(원문 유지)`);
    if (contractRaw && !empType) rec.notes.push(`계약구분 '${contractRaw}' → 근무형태 미입력(직급으로 보존)`);
    if (rec.hireDateRaw && !rec.hireDate) rec.notes.push(`입사일 '${rec.hireDateRaw}' 해석 불가 → 미입력`);

    if (email && seenEmails.has(email)) {
      plan.skip.push({ ...rec, reason: "시트 안 중복(앞 블록에 이미 등장 — 겸직)" });
      continue;
    }
    if (email) seenEmails.add(email);

    if (email && byEmail.has(email)) {
      const u = byEmail.get(email);
      // 이메일 일치 = 같은 사람 → 병합(빈 필드만 보강). 이전 값을 로그에 남겨 원복 가능하게.
      const fill = {};
      const prev = {};
      const pairs = [
        ["phone", "phone"],
        ["hireDate", "hire_date"],
        ["jobTitle", "job_title"],
        ["nickname", "english_name"],
      ];
      if (!migrationPending) pairs.push(["department", "department"], ["employmentType", "employment_type"]);
      for (const [k, col] of pairs) {
        if (rec[k] && !u[col]) {
          fill[col] = rec[k];
          prev[col] = u[col] ?? null;
        }
      }
      plan.merge.push({ ...rec, userId: u.id, dbName: u.display_name, fill, prev });
      continue;
    }
    if (!email) {
      plan.skip.push({ ...rec, reason: "이메일 없음(계정 생성 불가) — 나중에 수동 추가" });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      plan.skip.push({ ...rec, reason: `이메일 형식 오류(${email})` });
      continue;
    }
    if (namesTaken.has(name)) {
      // 동일 이름 + 다른 이메일 = 동일 인물 확신 불가 → 원장 지시대로 제외+보고(나중에 수동 추가).
      plan.skip.push({ ...rec, reason: "사이트에 같은 이름 존재(이메일 불일치) — 수동 확인 필요" });
      continue;
    }
    rec.role = TEACHER_DEPTS.has(rec.department ?? "") ? "teacher" : "viewer";
    plan.create.push(rec);
  }

  // 4) 보고서
  const fmt = (r) =>
    `  ${String(r.row).padStart(3)}행 ${r.name.padEnd(5)}${r.nickname ? `(${r.nickname})` : ""} ${r.email || "(메일없음)"} · ${r.department ?? "부서-"} · ${r.employmentType ?? "형태-"} · ${r.jobTitle ?? "직급-"} · 입사 ${r.hireDate ?? "-"}${r.role ? ` · 역할 ${r.role}` : ""}\n      [${r.block}]${r.notes.length ? ` ⚠ ${r.notes.join(" / ")}` : ""}`;
  console.log(`── 신규 생성 예정 ${plan.create.length}명 (초기 비밀번호 ${INITIAL_PASSWORD}) ──`);
  for (const r of plan.create) console.log(fmt(r));
  console.log(`\n── 기존 직원과 병합(빈 필드 보강) ${plan.merge.length}명 ──`);
  for (const r of plan.merge)
    console.log(
      `  ${String(r.row).padStart(3)}행 ${r.name} = 기존 '${r.dbName}' (${r.email}) → 보강: ${
        Object.keys(r.fill).length ? Object.entries(r.fill).map(([k, v]) => `${k}=${v}`).join(", ") : "없음(이미 채워짐)"
      }`,
    );
  console.log(`\n── 스킵(수동 처리 대상) ${plan.skip.length}명 ──`);
  for (const r of plan.skip) console.log(`  ${String(r.row).padStart(3)}행 ${r.name.padEnd(5)} — ${r.reason}`);

  if (!APPLY) {
    console.log("\n드라이런 종료 — 아무것도 변경하지 않았습니다. 적용하려면 --apply.");
    return;
  }

  // 5) 적용 — 생성/병합 + 감사로그 + 원복 로그
  const log = {
    ranAt: new Date().toISOString(),
    tenantId,
    sheetTab: tab.title,
    created: [],
    merged: [],
    skipped: plan.skip.map(({ row, name, reason }) => ({ row, name, reason })),
  };
  for (const r of plan.create) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: SB_HEADERS,
      body: JSON.stringify({
        email: r.email,
        password: INITIAL_PASSWORD,
        email_confirm: true,
        app_metadata: { tenant_id: tenantId, system_role: r.role },
      }),
    });
    const created = await res.json();
    if (!res.ok || !created?.id) {
      console.log(`  ✗ ${r.name} auth 생성 실패: ${JSON.stringify(created).slice(0, 200)}`);
      log.skipped.push({ row: r.row, name: r.name, reason: `auth 생성 실패: ${created?.msg ?? res.status}` });
      continue;
    }
    // 미러 트리거가 만든 users 최소 행을 UPDATE로 보강(createStaff와 동일 규약).
    const patch = await fetch(`${SB_URL}/rest/v1/users?id=eq.${created.id}`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({
        display_name: r.name,
        system_role: r.role,
        status: "active",
        phone: r.phone,
        hire_date: r.hireDate,
        job_title: r.jobTitle,
        english_name: r.nickname,
        department: r.department,
        employment_type: r.employmentType,
      }),
    });
    if (!patch.ok) {
      // 롤백 — auth + users 양쪽 정리(고아 방지).
      await fetch(`${SB_URL}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: SB_HEADERS });
      await fetch(`${SB_URL}/rest/v1/users?id=eq.${created.id}`, { method: "DELETE", headers: SB_HEADERS });
      console.log(`  ✗ ${r.name} users 보강 실패(${patch.status}) → 롤백`);
      log.skipped.push({ row: r.row, name: r.name, reason: `users 보강 실패(${patch.status})` });
      continue;
    }
    log.created.push({ userId: created.id, ...r });
    console.log(`  ✓ 생성 ${r.name} (${r.email}, ${r.role})`);
  }
  for (const r of plan.merge) {
    if (Object.keys(r.fill).length === 0) {
      log.merged.push({ userId: r.userId, row: r.row, name: r.name, fill: {}, prev: {} });
      continue;
    }
    const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${r.userId}`, {
      method: "PATCH",
      headers: SB_HEADERS,
      body: JSON.stringify(r.fill),
    });
    if (res.ok) {
      log.merged.push({ userId: r.userId, row: r.row, name: r.name, fill: r.fill, prev: r.prev });
      console.log(`  ✓ 병합 ${r.name} ← ${Object.keys(r.fill).join(", ")}`);
    } else {
      console.log(`  ✗ 병합 실패 ${r.name} (${res.status})`);
    }
  }

  // 감사로그(시스템 이벤트 — actor null, tenant 필수) + 원복용 JSON.
  await fetch(`${SB_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: SB_HEADERS,
    body: JSON.stringify({
      tenant_id: tenantId,
      actor_id: null,
      actor_name: "직원명부 이관 스크립트",
      action: "staff_roster_import",
      target_type: "users",
      target_label: `생성 ${log.created.length} · 병합 ${log.merged.length} · 스킵 ${log.skipped.length}`,
      metadata: { createdIds: log.created.map((c) => c.userId), sheetTab: tab.title },
    }),
  });
  const logDir = join(HERE, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `import-${log.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  console.log(`\n완료 — 생성 ${log.created.length} · 병합 ${log.merged.length} · 스킵 ${log.skipped.length}`);
  console.log(`원복 로그: ${logPath}`);
  console.log(`원복 명령: node scripts/staff-roster-import/revert-staff-import.mjs "${logPath}"`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
