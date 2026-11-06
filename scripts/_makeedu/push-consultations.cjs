/**
 * scripts/_makeedu/push-consultations.cjs — 역동기화(aywa→makeedu) writer.
 *
 * QR 공개접수 상담(enrollment_consultations.from_public_intake)을 makeedu 예비상담 등록 폼
 * (/counsel/counselList_regist.do?callpage=res)에 제출한다. aywa가 원본이라 makeedu에 없는 것을
 * 사무실이 손으로 재입력하던 것을 자동화 — 단, **자동 아님**: 사무실이 "makeedu로 보내기" 버튼으로
 * 건별 큐잉하면(makeedu_push_requests) 동기화 PC 워처가 이 스크립트를 실행한다(makeedu 신뢰 IP 필요).
 *
 * 멱등: makeedu_pushed_at IS NOT NULL이면 스킵(재푸시 차단). 성공 시 pushed_at=now() + counselSeq(잡히면)→makeedu_id.
 *
 * ⚠️ **dry-run 기본** — `--apply` 없으면 폼을 실제로 채워서 값만 확인하고 **제출하지 않는다**(makeedu에 안 씀).
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/push-consultations.cjs               # pending 요청 전부 dry-run
 *   node --env-file=.env.local scripts/_makeedu/push-consultations.cjs --apply       # 실제 제출
 *   node --env-file=.env.local scripts/_makeedu/push-consultations.cjs --ids=<uuid>  # 특정 상담만(요청 무관, 검증용)
 * env: 저장 세션(MAKEEDU_SESSION_FILE · 옛 MAKEEDU_STORAGE_STATE) 또는 MAKEEDU_ID/PW(login-guard.cjs) · DATABASE_URL · HEADED=1(브라우저 표시).
 */
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const G = require("./login-guard.cjs");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

const BASE = "https://school.makeedu.co.kr";
const APPLY = process.argv.includes("--apply");
const HEADED = !!process.env.HEADED;
const IDS = (process.argv.find((a) => a.startsWith("--ids=")) || "").split("=")[1];
const REGIST_URL = "/counsel/counselList_regist.do?callpage=res";

// 상담 + **연결 학생의 makeedu_id**(= makeedu 원생목록 등록 여부). enrolled 가드가 이 값을 본다 —
// 등록완료라도 학생이 makeedu에 없으면 예비상담으로 보내야 한다(2026-07-21 권도현 케이스).
// 🔴 **이 워커의 지점 것만** — id만으로 읽으면 다른 지점 상담(학생·보호자 연락처)이 이 지점 makeedu 계정에 제출된다(감사 2026-09-21).
const fetchConsultations = (sql, ids, tenantId) => sql`
  select ec.*, s.makeedu_id as student_makeedu_id
    from enrollment_consultations ec
    left join students s on s.id = ec.student_id
   where ec.id in ${sql(ids)} and ec.tenant_id = ${tenantId}`;

// aywa 학년 라벨 → makeedu preGrade 코드(정찰 확정). 없으면 99(일반).
const GRADE_MAP = {
  유치원: "01", 초1: "11", 초2: "12", 초3: "13", 초4: "14", 초5: "15", 초6: "16",
  중1: "21", 중2: "22", 중3: "23", 고1: "31", 고2: "32", 고3: "33",
};
const gradeCode = (label) => GRADE_MAP[(label || "").trim()] || "99";
// aywa parent_relation → makeedu prePKind(M=모/F=부/E=기타).
const relationCode = (rel) => (rel === "모" ? "M" : rel === "부" ? "F" : "E");
// 과목 키 → 한글 라벨(노트 표기용). 미매핑은 원문.
const SUBJECT_LABEL = { math: "수학", english: "영어", korean: "국어", science: "과학" };

// makeedu 업로드 전화번호 = 000-0000-0000 하이픈 형식(사용자 요청). lib.normPhone(11자리 3-4-4 / 10자리 3-3-4,
// 형식 모르면 원문 보존). makeedu 폼 JS는 공백만 제거하므로 하이픈은 그대로 저장된다.
const phone = (s) => L.normPhone(s) || "";

/**
 * makeedu '상담일'(counselYmd) — 항상 **KST 'YYYY-MM-DD' 문자열**로 넘긴다.
 *
 * 🔴 문자열로 못박는 이유: 종전엔 `c.consultation_date || c.received_date`를 그대로 `el.value =`에 넣었는데,
 *    postgres.js가 date/timestamptz를 **Date 객체**로 주기 때문에 브라우저가 로케일 문자열
 *    (`Mon Sep 29 2026 …`)로 바꿔 담았고 makeedu가 거기서 숫자만 뽑아 앞 8자리를 취해 상담일이
 *    **`2920-26-09`** 로 찍혔다(원장 제보 2026-09-14, 화면 캡처 4건).
 * 🔴 `toISOString()`을 쓰지 않는 이유: UTC라 **KST 자정~오전 9시 접수분이 전날로** 나간다.
 * 🔴 무엇을 보내나(원장 결정 2026-09-14 *"접수 시각을 쓴다"*): **`consulted_at` → 없으면 `created_at`**(KST 날짜).
 *    `received_date`·`consultation_date`는 **보지 않는다** — 2026-08-04 일괄 이관 행 21개가 `received_date`에
 *    **2023-02-17~23**을 담고 있고 그중 12행은 `consultation_date`도 2023이다(이관 잔재, 실제 상담한 날이 아니다).
 *    지금 큐에 들어올 수 있는 건 QR 접수분뿐이라(주간·수동 모두 `from_public_intake`로 거른다) 그 행들은 못
 *    들어오지만, `--ids=` 검증 경로엔 그 필터가 없어 두 칸을 읽으면 2023이 그대로 나간다(적대적 리뷰 2026-09-14).
 *    QR 접수분은 `consulted_at`과 `created_at`이 같은 값이다(실측: 아직 안 나간 5건 전부).
 * ⚠️ postgres.js는 date 컬럼을 **UTC 자정** Date로, timestamptz는 그 순간으로 준다 — KST로 포맷해도 연동 PC
 *    타임존과 무관하게 같은 날짜가 나온다.
 */
const KST_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
function kstYmd(v) {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : KST_YMD.format(v);
  return L.parseDate(v) || ""; // 'YYYYMMDD' · 'YYYY.MM.DD(요일)' 등 어떤 꼴로 와도 한 꼴로
}
const counselYmd = (c) => kstYmd(c.consulted_at) || kstYmd(c.created_at) || KST_YMD.format(new Date());

// makeedu 상담 노트(HTML) — parent_request + 메타데이터를 사람이 읽기 좋게.
function buildNoteHtml(c) {
  // 제목이 "[aywa 온라인 접수]" 고정 라벨이라 본문엔 중복 헤더 없이 메타부터.
  const lines = [];
  if (c.consultation_path) lines.push(`<p>상담 경로: ${esc(c.consultation_path)}</p>`);
  if (c.subject) lines.push(`<p>희망 과목: ${esc(SUBJECT_LABEL[c.subject] || c.subject)}</p>`);
  lines.push(`<p>셔틀버스: ${c.shuttle_bus_request ? "필요" : "불필요"}</p>`);
  if (c.address) lines.push(`<p>주소: ${esc(c.address)}</p>`);
  if (c.siblings) lines.push(`<p>형제: ${esc(c.siblings)}</p>`);
  if (c.career_goal) lines.push(`<p>진로: ${esc(c.career_goal)}</p>`);
  if (c.parent_request) lines.push(`<hr/><p>${esc(c.parent_request).replace(/\n/g, "<br/>")}</p>`);
  return lines.join("");
}
function buildNoteText(c) {
  const p = [];
  if (c.consultation_path) p.push(`상담 경로: ${c.consultation_path}`);
  if (c.subject) p.push(`희망 과목: ${SUBJECT_LABEL[c.subject] || c.subject}`);
  p.push(`셔틀버스: ${c.shuttle_bus_request ? "필요" : "불필요"}`);
  if (c.address) p.push(`주소: ${c.address}`);
  if (c.siblings) p.push(`형제: ${c.siblings}`);
  if (c.career_goal) p.push(`진로: ${c.career_goal}`);
  if (c.parent_request) p.push("", c.parent_request);
  return p.join("\n");
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// makeedu 로그인 한 벌(login-guard.cjs) — 저장 세션(MAKEEDU_SESSION_FILE · 옛 MAKEEDU_STORAGE_STATE) → 자동 로그인 멈춤 표시 → ID/PW 한 번.
async function makeContext(browser) {
  return G.openMakeeduContext(browser, { log: (m) => console.log(m) });
}

// 폼 필드 채우기(공용, dry-run·apply 둘 다). 채운 뒤 값 되읽어 반환(검증).
async function fillForm(page, c) {
  await page.goto(BASE + REGIST_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const setVal = async (name, value) => {
    await page.evaluate(({ name, value }) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, { name, value: value ?? "" });
  };
  const setSelect = async (name, value) => {
    await page.selectOption(`select[name="${name}"]`, value).catch(async () => { await setVal(name, value); });
  };
  await setVal("preStudName", c.prospect_name);
  await setVal("preSchoolName", c.prospect_school);
  await setSelect("preGrade", gradeCode(c.prospect_grade));
  await setVal("prePName", c.parent_name);
  await setVal("prePHpNo", phone(c.parent_phone));
  await setSelect("prePKind", relationCode(c.parent_relation));
  await setVal("preHpNo", phone(c.student_phone));
  await setVal("counselYmd", counselYmd(c));
  // 제목 = 고정 라벨(사용자 지정) — 학생명은 목록의 원생명 컬럼에 이미 뜬다.
  await setVal("title", "[aywa 온라인 접수]");
  await setVal("contents", buildNoteHtml(c));
  await setVal("contentsText", buildNoteText(c));
  // 되읽기(검증) — 실제 폼에 어떤 값이 들어갔는지.
  return page.evaluate(() => {
    const g = (n) => { const el = document.querySelector(`[name="${n}"]`); return el ? (el.tagName === "SELECT" ? `${el.value}(${el.options[el.selectedIndex]?.text || ""})` : el.value) : "(없음)"; };
    const radios = Array.from(document.querySelectorAll('input[type=radio], input[type=checkbox]'))
      .filter((r) => r.name).map((r) => `${r.name}=${r.value}${r.checked ? "✓" : ""}`);
    return {
      preStudName: g("preStudName"), preSchoolName: g("preSchoolName"), preGrade: g("preGrade"),
      prePName: g("prePName"), prePHpNo: g("prePHpNo"), prePKind: g("prePKind"), preHpNo: g("preHpNo"),
      counselYmd: g("counselYmd"), title: g("title"), contentsText: (g("contentsText") || "").slice(0, 80),
      studNoArr: g("studNoArr"), counselType_states: radios.filter((r) => /counselType|counsel/i.test(r)).slice(0, 10),
    };
  });
}

// 실제 제출 — makeedu 자신의 ajaxSubmit(폼 직렬화 재사용)으로 InsProc 호출. 응답 "OK"면 성공.
async function submit(page) {
  return page.evaluate(() => new Promise((resolve) => {
    try {
      // eslint-disable-next-line no-undef
      $("#form").ajaxSubmit({
        dataType: "text",
        url: "/counsel/counselList_regist_InsProc.do",
        success: (data) => resolve({ ok: String(data).trim() === "OK", data: String(data).slice(0, 200) }),
        error: (xhr, status) => resolve({ ok: false, data: `ajax error: ${status} ${xhr && xhr.status}` }),
      });
    } catch (e) {
      resolve({ ok: false, data: "no jQuery/ajaxSubmit: " + (e && e.message) });
    }
  }));
}

// 방금 등록한 예비상담의 counselSeq를 목록에서 회수(best-effort) — 이름+보호자연락처 최신 매칭.
async function captureCounselSeq(page, c) {
  try {
    await page.goto(BASE + "/member/student/resList.do", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    return await page.evaluate(({ name, phone }) => {
      const nd = (s) => (s || "").replace(/[^0-9]/g, "");
      // 행에서 seq 추출: 히든 input 우선, 없으면 첫 셀 No(예비원생 목록은 No=counselSeq — import-prospects와 동일 전제).
      const seqOf = (tr) => {
        const h = tr.querySelector('input[name="counselSeqTmp"], input[type="hidden"]');
        if (h && /^\d+$/.test(h.value)) return h.value;
        const first = nd((tr.children[0] && tr.children[0].innerText) || "");
        return first || null;
      };
      let best = null;
      for (const tr of document.querySelectorAll("tbody tr")) {
        const txt = tr.innerText || "";
        if (!txt.includes(name)) continue;
        if (phone && nd(txt).includes(nd(phone))) return seqOf(tr); // 이름+연락처 일치 = 확정
        if (!best) best = seqOf(tr); // 이름만 일치 = 후보(계속 탐색)
      }
      return best;
    }, { name: c.prospect_name, phone: c.parent_phone });
  } catch { return null; }
}

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const results = [];
  let browser;
  try {
    // 이 워커가 맡은 지점(env MAKEEDU_TENANT_ID → 없으면 학원이 정확히 1개일 때만). 못 풀면 throw = 아무것도 안 집는다.
    const tenantId = await L.resolveTenantId(sql);
    // 대상 결정: --ids 지정 시 그 상담들(요청 무관, 검증용) / 아니면 **이 지점의** pending push_requests.
    let targets; // [{ requestId|null, consultation }]
    if (IDS) {
      const ids = IDS.split(",").map((s) => s.trim()).filter(Boolean);
      const rows = await fetchConsultations(sql, ids, tenantId);
      targets = rows.map((c) => ({ requestId: null, consultation: c }));
    } else {
      const reqs = await sql`
        update makeedu_push_requests set status = 'running', started_at = now()
        where status = 'pending' and tenant_id = ${tenantId} returning id, consultation_id`;
      if (reqs.length === 0) { console.log("pending 푸시 요청 없음."); return; }
      // 같은 상담이 한 묶음에 둘(화면 두 곳에서 동시에 눌러 대기 행이 겹침) — 첫 요청만 제출하고 나머지는 큐에서 지운다.
      // 상담 행을 아래에서 한 번만 읽어 두 번째도 미전송으로 보이므로, 거르지 않으면 makeedu에 두 건 등록된다(lib 주석).
      const { unique, duplicates } = L.splitDuplicatePushRequests(
        reqs.map((r) => ({ requestId: r.id, consultationId: r.consultation_id })),
      );
      if (duplicates.length > 0) {
        const dupIds = duplicates.map((d) => d.requestId);
        // dry-run은 큐를 그대로 돌려놓는 모드라(아래 루프가 pending으로 되돌린다) 지우지 않고 대기로만 되돌린다.
        if (APPLY) {
          await sql`delete from makeedu_push_requests
                     where id in ${sql(dupIds)} and tenant_id = ${tenantId} and status = 'running'`;
        } else {
          await sql`update makeedu_push_requests set status = 'pending', started_at = null
                     where id in ${sql(dupIds)} and tenant_id = ${tenantId} and status = 'running'`;
        }
        console.log(`⏭  같은 상담 중복 요청 ${duplicates.length}건 — 한 번만 보냅니다`);
      }
      const cids = unique.map((r) => r.consultationId);
      const rows = await fetchConsultations(sql, cids, tenantId);
      const byId = new Map(rows.map((c) => [c.id, c]));
      targets = unique.map((r) => ({ requestId: r.requestId, consultation: byId.get(r.consultationId) }));
    }

    console.log(`대상 ${targets.length}건 · 모드: ${APPLY ? "APPLY(실제 제출)" : "DRY-RUN(제출 안 함)"}`);
    let page;
    try {
      // 브라우저 실행 실패도 여기서 받는다(리뷰 12 — 집은 요청이 running에 남지 않게).
      browser = await chromium.launch({ headless: !HEADED });
      ({ page } = await makeContext(browser));
    } catch (e) {
      // 로그인 못 함(자동 로그인 멈춤 · 사람 확인 · 판정 불가 — 2026-11-06) · 브라우저 못 띄움. 집어 온 요청을 'running'에 묶어 두지 않고
      // **기존 마감 문장**으로 닫는다(예전엔 running으로 남아 주간 자동 적재가 그 상담을 영영 건너뛰었다 — weekly-push는 pending·running만 거른다).
      // ⚠️ 마감이 로그인 시도를 늘리지 않는다: 워처는 'pending'만 세어 이 스크립트를 부르고(error는 안 집는다), 주간 적재가 주 1회 다시 실어도
      //    login-guard가 세션 → 멈춤 표시 순으로 막아 같은 자격의 ID/PW는 다시 나가지 않는다(push-consultations-login.test.ts가 고정).
      // 사람이 읽을 사유 — 로그인 한 벌의 한글 사유(e.reason · 코드 꼬리표 없이) 또는 접속 준비 실패의 첫 줄(경로는 가림). 아이디·비밀번호 없음.
      const why = (
        e instanceof G.MakeeduLoginError
          ? `makeedu에 로그인하지 못해 보내지 못했습니다 — ${String(e.reason).replace(/\s+/g, " ").trim()}`
          : `makeedu 접속 준비(브라우저)에 실패해 보내지 못했습니다 — ${String(e.message || e).split("\n")[0].replace(/[A-Za-z]:\\[^\s]*/g, "…").replace(/\s+/g, " ").trim()}`
      ).slice(0, 300);
      for (const { requestId } of targets) {
        if (!requestId) continue;
        if (APPLY) await finish(sql, requestId, "error", null, why);
        else await sql`update makeedu_push_requests set status = 'pending', started_at = null where id = ${requestId}`;
      }
      throw e;
    }

    for (const { requestId, consultation: c } of targets) {
      if (!c) { results.push({ requestId, skip: "상담 없음" }); if (requestId) await finish(sql, requestId, "error", null, "상담 레코드 없음"); continue; }
      const label = `${c.prospect_name}(${c.prospect_school} ${c.prospect_grade})`;
      // 멱등: 이미 푸시됨이면 스킵.
      if (c.makeedu_pushed_at) {
        console.log(`⏭  ${label} — 이미 푸시됨(pushed_at) 스킵`);
        if (requestId) await finish(sql, requestId, "skipped", null, "이미 makeedu에 전송됨");
        results.push({ label, skip: "already pushed" });
        continue;
      }
      // 등록완료 가드(실행 시점 재검사): 큐잉~실행 사이(PC 꺼짐 등)에 학원 등록이 됐으면 스킵 — 예비원생
      // 단계를 지난 학생을 신규 문의로 넣는 군더더기 방지(액션 쪽 가드와 이중).
      // ⚠️ 단, **학생이 makeedu 원생일 때만** 스킵한다(2026-07-21 권도현 케이스). makeedu 어디에도 없는
      // 등록 학생은 예비상담으로라도 들어가야 사무실이 원생 전환→청구로 이을 수 있다.
      // 판정은 lib.isPushableConsultation 한 벌(주간 자동 적재 weekly-push.cjs와 공유) —
      // 앱 쪽 단일 규칙은 src/features/integrations/push-eligibility.ts(같은 판정을 유지할 것).
      if (!L.isPushableConsultation(c.outcome, c.student_makeedu_id)) {
        console.log(`⏭  ${label} — 등록완료 + makeedu 원생(${c.student_makeedu_id}) 스킵`);
        if (requestId) await finish(sql, requestId, "skipped", null, "학원 등록 완료 + makeedu 원생으로 이미 존재");
        results.push({ label, skip: "enrolled" });
        continue;
      }
      if (c.outcome === "enrolled") {
        console.log(`⚠  ${label} — 등록완료지만 makeedu에 학생 기록 없음 → 예비상담으로 전송(원생 전환은 사무실이 수동)`);
      }
      try {
        const filled = await fillForm(page, c);
        console.log(`\n▷ ${label}\n   채워진 값:`, JSON.stringify(filled, null, 1));
        if (!APPLY) {
          results.push({ label, dryRun: filled });
          if (requestId) {
            // dry-run에선 요청을 다시 pending으로 되돌린다(실제 제출은 --apply에서).
            await sql`update makeedu_push_requests set status = 'pending', started_at = null where id = ${requestId}`;
          }
          continue;
        }
        const res = await submit(page);
        if (!res.ok) throw new Error(`makeedu 거부: ${res.data}`);
        const seq = await captureCounselSeq(page, c);
        // aywa 갱신: 멱등 플래그 + (잡히면)counselSeq → makeedu_id.
        await sql`
          update enrollment_consultations
          set makeedu_pushed_at = now(), makeedu_id = coalesce(makeedu_id, ${seq})
          where id = ${c.id} and tenant_id = ${tenantId}`;
        if (requestId) await finish(sql, requestId, "done", seq, null);
        console.log(`✅ ${label} — makeedu 등록 완료${seq ? ` (counselSeq ${seq})` : " (seq 미회수 — 다음 읽기 동기화가 백필)"}`);
        results.push({ label, ok: true, seq });
        await page.waitForTimeout(800); // 봇 탐지 회피 — 건당 약간의 간격
      } catch (e) {
        console.error(`✖ ${label} — ${e.message}`);
        if (requestId) await finish(sql, requestId, "error", null, e.message);
        results.push({ label, error: e.message });
      }
    }
  } finally {
    if (browser) await browser.close();
    await sql.end();
  }
  const ok = results.filter((r) => r.ok).length;
  const err = results.filter((r) => r.error).length;
  console.log(`\n요약: 성공 ${ok} · 실패 ${err} · 스킵 ${results.filter((r) => r.skip).length} · dry-run ${results.filter((r) => r.dryRun).length}`);
  if (err) process.exit(1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

async function finish(sql, requestId, status, seq, error) {
  await sql`
    update makeedu_push_requests
    set status = ${status}, finished_at = now(), makeedu_counsel_seq = ${seq}, error = ${error}
    where id = ${requestId}`.catch(() => {});
}
