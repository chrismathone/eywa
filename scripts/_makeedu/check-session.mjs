/**
 * scripts/_makeedu/check-session.mjs — makeedu **접속 헬스체크 → 실패 시 aywa 알림**.
 *
 * 원장 지시(2026-07-30): *"세션 로그인 풀릴 때마다 aywa에서 알림 발송받아야겠어… 워커에서 하던지
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
 * 🔴 **2026-11-06**: makeedu가 로그인 화면에 봇 확인(login-bot-check.js)을 붙여 자동 로그인(navigator.webdriver)에
 * `CAPTCHA_REQUIRED`를 돌려준다 — 신뢰 IP여도 자동 ID/PW 로그인은 이제 통과하지 못한다. 그래서 다시 **세션 재사용**이 기본이고,
 * 세션이 죽으면 사람이 연동 앱 'makeedu 다시 로그인'으로 한 번 확인한다. 이 점검은 그 순간을 사유별로 알린다
 * (사람 확인 · 비밀번호 틀림(남은 횟수) · 그 밖 — `notificationTextFor`). 로그인 규칙은 login-guard.cjs 한 벌.
 *
 * ⚠️ **실패해도 재시도하지 않는다** — 반복 로그인 실패는 계정 잠금을 부른다. 1회 시도 후 결과만 기록하고,
 * OK가 아니면 자동 로그인 멈춤 표시(login-blocked.json)를 남겨 다음 점검부터 같은 자격으로는 시도조차 하지 않는다.
 *
 * dedup(0118a `notification_events`): bucket = **상태 전이 표현**(`login_failed:<감지일>`). 같은 날 반복
 * 실행해도 한 번만 울리고, 고쳐졌다가 다시 실패하면 새 날짜라 다시 알린다.
 *
 * 🔴 **콜드스타트 무발송 시드는 여기 적용하지 않는다(2026-07-30 수정).** 처음엔 다른 Phase 3 이벤트를 그대로
 * 베껴 (tenant, event_type) 0행이면 시드만 하고 넘어가게 했는데, 그러면 **첫 로그인 실패가 통째로 침묵한다** —
 * 원장이 알고 싶다고 한 바로 그 순간이다. 콜드스타트 규칙의 목적은 "결석 마일스톤처럼 **이미 쌓인 과거 상태
 * 수백 건**이 한꺼번에 울리는 벨 폭탄" 방지인데, 이 이벤트는 주체가 `makeedu` **하나뿐**이고 발화 조건이
 * "지금 이 순간 접속이 깨졌다"라 **막을 폭탄 자체가 없다**(최대 하루 1건·수신자 master 1명).
 * → 규칙을 이름만 보고 옮기지 말 것. 콜드스타트는 **누적 상태를 감지하는 배치**에만 의미가 있다.
 *
 * 실행(연동 PC 작업 스케줄러 권장 — 하루 1회):
 *   node --env-file=.env.local scripts/_makeedu/check-session.mjs            # 점검 + 실패면 알림
 *   node --env-file=.env.local scripts/_makeedu/check-session.mjs --dry-run  # 판정만(알림 안 보냄)
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import postgres from "postgres";

const require = createRequire(import.meta.url);
const G = require("./login-guard.cjs");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("@playwright/test"));
}

const DRY = process.argv.includes("--dry-run");
const EVENT_TYPE = "makeedu_login_failed";
const SESSION_FILE =
  process.env.MAKEEDU_SESSION_FILE ??
  process.argv.find((a) => a.startsWith("--session="))?.split("=")[1] ??
  G.defaultSessionFile(process.env);

const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * 접속 헬스체크 — `{ok, code, remaining, reason}`. `ok:null`은 **판정 불가**(네트워크·사이트 문제)라 알리지 않는다.
 *
 * 로그인 규칙은 login-guard.cjs 한 벌(2026-11-06 — makeedu가 자동 로그인에 사람 확인을 요구하기 시작):
 * ① 저장 세션이 있으면 그걸로 먼저 확인(로그인 시도 0회 = 가장 안전) — 살아 있으면 정상.
 * ② 세션이 죽었고 **자동 로그인 멈춤 표시**가 같은 자격에 걸려 있으면 로그인하지 않고 그 사유로 실패(벨은 아래 bucket 규칙대로 하루 1번).
 * ③ 아니면 ID/PW로 **한 번** 로그인. 성공하면 세션 저장 · OK가 아니면 멈춤 표시를 남긴다. **재시도하지 않는다**(계정 잠금 방지).
 *
 * 세션 유지(원장 2026-11-06 "10분마다 하지말고 하루마다로 그냥 해"): 따로 깨우는 타이머는 두지 않는다 — 이 하루 1번 점검(①에서 살아 있으면
 * 세션 파일을 원자적으로 다시 저장)과 하루 2번 정기 동기화가 그 역할을 한다.
 * 세션 수명 실측: 점검마다 "makeedu 세션 살아 있음/끊김 — 로그인 후 N시간"을 로컬 로그(makeedu.log)에 한 줄(login-guard `sessionStatusLine` ·
 * 로그인 시각 = session-meta.json · 점검 **전에** 읽는다 — ID/PW로 새로 들어가면 덮이므로). 끊긴 걸 처음 알면 '세션 저장 후 몇 시간'도 한 줄
 * (`noteSessionDead`). 개인정보·쿠키 값 없음 · 서버로 보내지 않음.
 */
async function probeAccess() {
  const browser = await chromium.launch({ headless: true });
  try {
    const { via } = await G.openMakeeduContext(browser, { sessionFile: SESSION_FILE, log: (m) => console.log(`[makeedu-health] ${m}`) });
    return { ok: true, code: "OK", via, reason: via === "session" ? "저장 세션 유효" : "ID/PW 로그인 성공(세션 갱신 저장)" };
  } catch (e) {
    if (e instanceof G.MakeeduLoginError) return { ok: e.ok, code: e.code, remaining: e.remaining, readError: e.readError, reason: e.message };
    return { ok: null, code: null, reason: `점검 실패(네트워크·사이트 문제일 수 있음): ${e.message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const tenants = await sql`select id from tenants`;
  const tenant = process.env.CLASSNOTE_TENANT_ID || (tenants.length === 1 ? tenants[0].id : null);
  if (!tenant) throw new Error(`테넌트 ${tenants.length}개 — CLASSNOTE_TENANT_ID를 지정하세요`);

  // 세션 수명 실측용 — 점검 전 상태(ID/PW로 새로 들어가면 세션 파일·로그인 시각이 바뀐다).
  const hadSession = fs.existsSync(SESSION_FILE);
  const metaBefore = G.readMeta(SESSION_FILE);
  const probe = await probeAccess();
  const state = G.sessionStateAfterProbe({ hadSession, via: probe.via, ok: probe.ok, errorCode: probe.code });
  console.log(`[makeedu-health] ${G.sessionStatusLine({ state, meta: metaBefore })}`);
  const today = kstToday();
  console.log(`[makeedu-health] ${probe.ok === true ? "✅ 정상" : probe.ok === false ? "🔴 접속 실패" : "⚠️ 판정 불가"} ${probe.reason}`);

  if (probe.ok !== false) {
    // 유효하거나 판정 불가 → 아무것도 하지 않는다(모르면 안 알린다).
    process.exit(0);
  }

  // ── 접속 실패 확정 → dedup 후 알림 ─────────────────────────────────────────
  // 같은 날 반복 실행은 1건만(unique 충돌) · 고쳐졌다 다시 깨지면 새 날짜라 다시 울린다.
  // ⚠️ 콜드스타트 시드는 쓰지 않는다(위 주석) — 첫 실패도 즉시 알린다.
  const bucket = `login_failed:${today}`;
  const inserted = await sql`
    insert into notification_events (tenant_id, event_type, subject_key, bucket, seeded)
    values (${tenant}, ${EVENT_TYPE}, 'makeedu', ${bucket}, false)
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing
    returning id`;
  if (!inserted.length) {
    console.log("[makeedu-health] 오늘 같은 실패로 이미 알렸습니다(재발송 안 함)");
    process.exit(0);
  }

  // 수신자 = master. ⚠️ 워커는 admin 직결(RLS 우회)이라 **tenant 필터 필수**.
  const admins = await sql`
    select id from users where tenant_id = ${tenant} and system_role = 'master' and status <> 'inactive'`;
  if (!admins.length) {
    console.log("[makeedu-health] 수신자(master)가 없어 알림을 만들지 않았습니다");
    process.exit(0);
  }
  // 사유별 문구(사람 확인 · 비밀번호 틀림 · 그 밖) — INSERT 문장은 그대로, 값만 바뀐다(login-guard.notificationTextFor).
  const text = G.notificationTextFor(probe, today);
  const plan = admins.map((u) => ({
    tenant_id: tenant,
    recipient_id: u.id,
    type: EVENT_TYPE,
    title: text.title,
    body: text.body,
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
