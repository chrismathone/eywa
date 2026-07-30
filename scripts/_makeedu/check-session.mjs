/**
 * scripts/_makeedu/check-session.mjs — makeedu **접속 헬스체크 → 실패 시 eywa 알림**.
 *
 * 원장 지시(2026-07-30): *"세션 로그인 풀릴 때마다 eywa에서 알림 발송받아야겠어… 워커에서 하던지
 * 로컬 PC에서 하던지 어디서든."*
 *
 * 🔴 **정정(2026-07-30 실측)**: 처음엔 "자동 로그인은 CAPTCHA 때문에 구조적으로 불가"라고 했는데 **틀렸다.**
 * 연동 PC(신뢰 IP)에서 `scrape.cjs`의 ID/PW 로그인이 **CAPTCHA 없이 통과**했다(`login ok → main.do`).
 * CAPTCHA가 걸리는 건 **낯선 IP·헤드리스**일 때다. → 연동 PC에서는 **세션 캡처가 아예 필요 없고**,
 * 매 실행마다 로그인하면 되므로 "세션 만료"라는 문제 자체가 사라진다.
 *
 * 그래서 감시 대상이 바뀐다: **세션 만료**가 아니라 **로그인 자체가 실패하는 날**
 * (비밀번호 변경 · CAPTCHA 도입 · 계정 잠금 · 사이트 개편)이 진짜 신호다. 그때 동기화가 조용히 멈추므로
 * 원장 벨에 알린다.
 *
 * ⚠️ **실패해도 재시도하지 않는다** — 반복 로그인 실패는 계정 잠금을 부른다. 1회 시도 후 결과만 기록.
 *
 * dedup(0118a `notification_events`): bucket = **상태 전이 표현**(`login_failed:<감지일>`). 같은 날 반복
 * 실행해도 한 번만 울리고, 고쳐졌다가 다시 실패하면 새 날짜라 다시 알린다.
 * 콜드스타트: (tenant, event_type) 0행이면 첫 실행 — **무발송 시드**만 하고 다음부터 알린다(벨 폭탄 방지).
 *
 * 실행(연동 PC 작업 스케줄러 권장 — 하루 1회):
 *   node --env-file=.env.local scripts/_makeedu/check-session.mjs            # 점검 + 실패면 알림
 *   node --env-file=.env.local scripts/_makeedu/check-session.mjs --dry-run  # 판정만(알림 안 보냄)
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("@playwright/test"));
}

const DRY = process.argv.includes("--dry-run");
const BASE = "https://school.makeedu.co.kr";
const EVENT_TYPE = "makeedu_login_failed";
const SESSION_FILE =
  process.env.MAKEEDU_SESSION_FILE ??
  process.argv.find((a) => a.startsWith("--session="))?.split("=")[1] ??
  path.resolve(process.cwd(), ".makeedu-tmp", "session.json");

const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * 접속 헬스체크 — `{ok, reason}`. `ok:null`은 **판정 불가**(네트워크·사이트 문제)라 알리지 않는다.
 *
 * ① 저장 세션이 있으면 그걸로 먼저 확인(로그인 시도 0회 = 가장 안전).
 * ② 세션이 없거나 만료면 **ID/PW로 1회 로그인**(연동 PC는 신뢰 IP라 통과한다 — 실측). 성공하면 세션을
 *    갱신 저장해 다음 점검은 다시 ①로 끝난다. **실패해도 재시도하지 않는다**(계정 잠금 방지).
 */
async function probeAccess() {
  const browser = await chromium.launch({ headless: true });
  try {
    // ① 저장 세션 우선
    if (fs.existsSync(SESSION_FILE)) {
      try {
        const storage = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        const ctx = await browser.newContext({ storageState: storage });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/main.do`, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (!/login/i.test(page.url())) return { ok: true, reason: "저장 세션 유효" };
        await ctx.close();
      } catch {
        /* 세션 손상·만료 → ②로 */
      }
    }
    // ② ID/PW 1회 로그인
    const id = process.env.MAKEEDU_ID;
    const pw = process.env.MAKEEDU_PW;
    if (!id || !pw) return { ok: false, reason: "세션이 없고 MAKEEDU_ID/PW도 설정돼 있지 않습니다" };
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login.do`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.waitFor({ timeout: 15000 });
    await page.locator('input[type="text"], input:not([type])').first().fill(id);
    await pwInput.fill(pw);
    await Promise.all([page.waitForLoadState("networkidle").catch(() => {}), pwInput.press("Enter")]);
    await page.waitForTimeout(2500);
    if (/login/i.test(page.url())) {
      const hint = await page
        .evaluate(() => (document.body.innerText || "").slice(0, 200))
        .catch(() => "");
      return { ok: false, reason: `ID/PW 로그인이 실패했습니다(비밀번호 변경·CAPTCHA·계정 잠금 의심). 화면: ${hint.replace(/\s+/g, " ").slice(0, 120)}` };
    }
    // 성공 → 세션 갱신 저장(다음 점검은 로그인 없이 끝난다)
    try {
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify(await ctx.storageState()));
    } catch {
      /* 저장 실패는 치명적이지 않다 */
    }
    return { ok: true, reason: "ID/PW 로그인 성공(세션 갱신 저장)" };
  } catch (e) {
    return { ok: null, reason: `점검 실패(네트워크·사이트 문제일 수 있음): ${e.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const tenants = await sql`select id from tenants`;
  const tenant = process.env.CLASSNOTE_TENANT_ID || (tenants.length === 1 ? tenants[0].id : null);
  if (!tenant) throw new Error(`테넌트 ${tenants.length}개 — CLASSNOTE_TENANT_ID를 지정하세요`);

  const probe = await probeAccess();
  const today = kstToday();
  console.log(`[makeedu-health] ${probe.ok === true ? "✅ 정상" : probe.ok === false ? "🔴 접속 실패" : "⚠️ 판정 불가"} ${probe.reason}`);

  if (probe.ok !== false) {
    // 유효하거나 판정 불가 → 아무것도 하지 않는다(모르면 안 알린다).
    process.exit(0);
  }

  // ── 만료 확정 → dedup 후 알림 ──────────────────────────────────────────────
  const bucket = `login_failed:${today}`;
  const [{ n }] = await sql`select count(*)::int as n from notification_events
    where tenant_id = ${tenant} and event_type = ${EVENT_TYPE}`;
  const coldStart = n === 0;

  const inserted = await sql`
    insert into notification_events (tenant_id, event_type, subject_key, bucket, seeded)
    values (${tenant}, ${EVENT_TYPE}, 'makeedu', ${bucket}, ${coldStart})
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing
    returning id`;
  if (!inserted.length) {
    console.log("[makeedu-health] 이미 같은 만료로 알렸습니다(재발송 안 함)");
    process.exit(0);
  }
  if (coldStart) {
    console.log("[makeedu-health] 콜드스타트 — 시드만 하고 알리지 않습니다(다음 만료부터 알림)");
    process.exit(0);
  }

  // 수신자 = master. ⚠️ 워커는 admin 직결(RLS 우회)이라 **tenant 필터 필수**.
  const admins = await sql`
    select id from users where tenant_id = ${tenant} and system_role = 'master' and status <> 'inactive'`;
  if (!admins.length) {
    console.log("[makeedu-health] 수신자(master)가 없어 알림을 만들지 않았습니다");
    process.exit(0);
  }
  const plan = admins.map((u) => ({
    tenant_id: tenant,
    recipient_id: u.id,
    type: EVENT_TYPE,
    title: "makeedu 접속이 실패했습니다",
    body: `makeedu 동기화가 멈춥니다 — 비밀번호 변경·CAPTCHA·계정 잠금을 확인해 주세요. (감지 ${today})`,
    link: null,
  }));
  if (DRY) {
    console.log(`[makeedu-health] (dry-run) 알림 ${plan.length}건 예정 — 실제로 보내지 않았습니다`);
  } else {
    await sql`insert into notifications ${sql(plan, "tenant_id", "recipient_id", "type", "title", "body", "link")}`;
    console.log(`[makeedu-health] 알림 ${plan.length}건 발송(master)`);
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
