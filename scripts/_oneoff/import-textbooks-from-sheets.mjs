/**
 * scripts/_oneoff/import-textbooks-from-sheets.mjs — 영어 강사 시트에 이미 적혀 있는 교재명을
 * 교재목록(`textbooks`, 0266a)으로 **1회** 옮긴다.
 *
 * 원장 2026-09-16(교재목록 도입 문답): *"자주 쓰인 것만 1회 가져오기"*.
 * 배경: `class_sheet_plan_lines.textbook`이 자유 텍스트라 실측 2,550행에 **372종**이 쌓였다. 목록이
 * 비어 있으면 아무도 안 쓰므로, 자주 쓰인 이름부터 넣어 첫날부터 고를 게 있게 한다.
 *
 * 🔴 **드라이런이 기본**이다(`--apply` 없으면 아무것도 안 쓴다).
 * 🔴 **멱등** — 이미 있는 제목(`lower(btrim(title))`, 유니크 인덱스와 같은 키)은 건너뛴다. 절대 UPDATE하지 않는다.
 * 🔴 **이름을 고치거나 합치지 않는다** — `그래머인사이드 3`·`그래머인사이드3`은 두 행으로 들어간다.
 *    비슷한 이름은 경고 목록으로만 뽑는다(병합은 사람이 화면에서 폐지→흡수로).
 * 🔴 **차수는 만들지 않는다**(`session_count = 0`) — 차수별 진도·과제는 사람이 적는다.
 * 🔴 테넌트 `injaewon`은 **프로덕션 실데이터**다 — 드라이런은 완전한 읽기 전용, `--apply`는 INSERT만.
 * ⚠️ 0266a가 아직 안 걸려 있으면 `--apply`는 멈추고, 드라이런은 "이미 있는 행 = 0"으로 계획만 보여 준다([[#95]]).
 * ⚠️ `class_sheet_plan_lines`는 1,000행을 넘으므로 반드시 페이지네이션한다(PostgREST 조용한 절단, B2).
 *
 * 사용(워크트리 루트의 .env.local을 스스로 읽는다):
 *   node scripts/_oneoff/import-textbooks-from-sheets.mjs                 # 드라이런
 *   node scripts/_oneoff/import-textbooks-from-sheets.mjs --min=5         # 5회 이상 쓰인 교재만
 *   node scripts/_oneoff/import-textbooks-from-sheets.mjs --apply         # 실제 INSERT
 *   옵션: --tenant=<slug> (기본 injaewon) · --min=N (기본 3)
 * env: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 또는 --env-file)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePlanLines, planImport, SUBJECT } from "./import-textbooks-from-sheets.rules.mjs";

const APPLY = process.argv.includes("--apply");
const arg = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const tenantSlug = arg("tenant", "injaewon");
const MIN_COUNT = Math.max(1, Number(arg("min", "3")) || 3);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** .env.local을 직접 읽는다(이미 process.env에 있으면 그것이 이긴다 — --env-file도 그대로 통한다). */
function loadEnv() {
  const out = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
  if (out.url && out.key) return out;
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !out.url) out.url = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !out.key) out.key = v;
    }
  } catch {
    /* 파일이 없으면 아래에서 안내하고 멈춘다 */
  }
  return out;
}

const { url: SUPABASE_URL, key: SERVICE_KEY } = loadEnv();

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(4, 64 - title.length))}`);
}

/** PostgREST 표가 아직 없을 때의 코드([[#95]]). */
function isMissingTable(body) {
  const code = body?.code ?? "";
  const msg = body?.message ?? "";
  return code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(msg);
}

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  return { ok: res.ok, status: res.status, body };
}

/** 1,000행 한도를 넘어 전건을 가져온다(B2 — 무페이징 select 금지). */
async function selectAll(path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes("?") ? "&" : "?";
    const { ok, body } = await rest(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!ok) throw Object.assign(new Error(body?.message ?? "조회 실패"), { body });
    rows.push(...body);
    if (body.length < pageSize) break;
  }
  return rows;
}

const pad = (s, n) => {
  // 한글은 2칸으로 세어야 표가 안 어긋난다.
  const width = [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + " ".repeat(Math.max(0, n - width));
};

(async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다 — 워크트리 루트에 .env.local을 두세요");
    process.exit(1);
  }
  console.log(`모드: ${APPLY ? "APPLY(실제 INSERT)" : "DRY-RUN(쓰기 없음)"} · 테넌트 slug=${tenantSlug} · 임계값 min=${MIN_COUNT}회`);

  const tenantRes = await rest(`tenants?select=id,slug&slug=eq.${encodeURIComponent(tenantSlug)}`);
  if (!tenantRes.ok || !tenantRes.body?.length) {
    console.error(`테넌트 ${tenantSlug}를 찾지 못했습니다`);
    process.exit(1);
  }
  const tenantId = tenantRes.body[0].id;
  console.log(`테넌트: ${tenantSlug} (${tenantId})`);

  // ── 1) 원본: ECS 계획 줄 ──────────────────────────────────────
  const lines = await selectAll(
    `class_sheet_plan_lines?select=textbook,skill_area,page_range&tenant_id=eq.${tenantId}&textbook=not.is.null&order=id.asc`,
  );
  const aggregates = aggregatePlanLines(lines);
  console.log(`계획 줄 ${lines.length}행 · 교재명 ${aggregates.size}종`);

  // ── 2) 이미 있는 교재 ─────────────────────────────────────────
  let tableReady = true;
  let existing = [];
  const existingRes = await rest(
    `textbooks?select=title&tenant_id=eq.${tenantId}&subject=eq.${SUBJECT}&limit=1000`,
  );
  if (!existingRes.ok) {
    if (isMissingTable(existingRes.body)) {
      tableReady = false;
      const msg = "교재목록 표가 없습니다 — supabase/migrations/0266a_textbooks.sql을 먼저 적용하세요";
      if (APPLY) {
        console.error(`\n${msg}`);
        process.exit(1);
      }
      console.log(`\n⚠️ ${msg}\n   (드라이런이라 "이미 있는 교재 = 0"으로 가정하고 계획만 보여 줍니다)`);
    } else {
      console.error(`교재목록 조회 실패: ${existingRes.body?.message ?? existingRes.status}`);
      process.exit(1);
    }
  } else {
    existing = await selectAll(`textbooks?select=title&tenant_id=eq.${tenantId}&subject=eq.${SUBJECT}&order=title.asc`);
    console.log(`이미 있는 교재 ${existing.length}권`);
  }
  const existingKeys = new Set(existing.map((r) => String(r.title).trim().toLowerCase()));

  // ── 3) 계획 ───────────────────────────────────────────────────
  const plan = planImport({ aggregates, existingKeys, minCount: MIN_COUNT });

  section(`넣을 교재 ${plan.insert.length}권 (subject=${SUBJECT} · session_count=0 — 차수별 진도·과제는 사람이 적는다)`);
  console.log(`  ${pad("교재명", 44)}${pad("쓰인 횟수", 12)}${pad("구분", 12)}페이지/시간`);
  for (const r of plan.insert) {
    console.log(`  ${pad(r.title, 44)}${pad(r._count, 12)}${pad(r.skill_area ?? "—", 12)}${r.page_time ?? "—"}`);
  }

  const belowTotal = plan.skipBelowMin.reduce((n, a) => n + a.count, 0);
  section("건너뜀");
  console.log(`  · 이미 있음        ${plan.skipExisting.length}권`);
  console.log(`  · ${MIN_COUNT}회 미만       ${plan.skipBelowMin.length}종 (계획 줄 ${belowTotal}행 분)`);
  console.log(`  · 교재가 아님      ${plan.skipNonBook.length}종 ${plan.skipNonBook.map((a) => `"${a.title}"(${a.count})`).join(" · ") || ""}`);

  if (plan.dupClusters.length > 0) {
    section(`비슷한 이름 ${plan.dupClusters.length}묶음 — 🔴 합치지 않았습니다(사람이 확인하세요)`);
    for (const list of plan.dupClusters) {
      console.log(`  · ${list.map((a) => `"${a.title}"(${a.count})`).join("  ↔  ")}`);
    }
    console.log("    → 같은 책이면 화면에서 하나를 폐지하세요. 스크립트가 고르면 LV1·1 같은 진짜 차이를 지웁니다.");
  }

  if (!APPLY) {
    console.log(`\n드라이런 끝 — 아무것도 쓰지 않았습니다. 실제 반영은 --apply.`);
    return;
  }
  if (!tableReady) return;

  // ── 4) 적용 (INSERT만) ────────────────────────────────────────
  section("적용");
  let inserted = 0;
  let duplicated = 0;
  const failed = [];
  for (const r of plan.insert) {
    const { subject, skill_area, title, page_time, session_count } = r;
    const res = await rest("textbooks", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ tenant_id: tenantId, subject, skill_area, title, page_time, session_count }),
    });
    if (res.ok) {
      inserted += 1;
    } else if (res.body?.code === "23505") {
      // 그 사이 누가 같은 이름을 넣었다 — 실패가 아니라 "이미 있음"이다(멱등).
      duplicated += 1;
    } else {
      failed.push({ title, error: res.body?.message ?? res.status });
    }
  }
  console.log(`  넣음 ${inserted}권 · 이미 있어 건너뜀 ${duplicated}권 · 실패 ${failed.length}권`);
  for (const f of failed) console.log(`  !! "${f.title}": ${f.error}`);
  if (failed.length > 0) process.exitCode = 1;
})().catch((e) => {
  console.error(e?.body ?? e);
  process.exit(1);
});
