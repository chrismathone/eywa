/**
 * scripts/_makeedu/sync-prospects.cjs — 예비원생(신입생) 상담 **내용까지** 동기화 (Playwright).
 *
 * makeedu 예비원생 목록(resList.do)은 기본 정보만 있고, 상담 본문(상담경로·진로·주소·셔틀·남매·혈액형·
 * 상담과목·동의 등)은 **상세 페이지**에 있다. 상세 URL은 재원생 상담과 동일한 `counselList_detail.do?counselSeq=N`이고,
 * aywa enrollment_consultations.makeedu_id 가 곧 그 counselSeq라 매칭이 1:1이다(import-prospects가 r[0]=seq를 저장).
 *
 * 따라서: aywa에 이미 적재된 makeedu 예비상담(makeedu_id=counselSeq)을 가져와 → 상세 fetch → ◆-구조 파싱 →
 * enrollment_consultations의 풍부 필드를 **COALESCE(빈 값만 채움)·boolean은 OR**로 백필(ijw 값 보존).
 *
 *   node --env-file=.env.local scripts/_makeedu/sync-prospects.cjs          # dry(표본 파싱만, DB write 0)
 *   node --env-file=.env.local scripts/_makeedu/sync-prospects.cjs --apply  # 상세 fetch + 백필
 */
const postgres = require("postgres");
const L = require("./lib.cjs");
const G = require("./login-guard.cjs");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

const BASE = "https://school.makeedu.co.kr";
const APPLY = process.argv.includes("--apply");
const CONC = Number(process.env.MAKEEDU_CONC || 8);

// 상세 페이지: META 셀(보호자명·원생명(성별)·보호자연락처(관계)) + '내용' 셀(◆-구조 본문) 추출.
function EXTRACT_DETAIL() {
  const meta = {};
  let content = "";
  for (const tr of document.querySelectorAll("table tr")) {
    const c = Array.from(tr.children);
    for (let i = 0; i + 1 < c.length; i++) {
      const label = (c[i].textContent || "").replace(/\s+/g, "").trim();
      const cell = c[i + 1];
      if (!cell) continue;
      if (label === "내용") {
        content = (cell.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim();
      } else if (label === "보호자명" || label === "원생명" || label === "보호자연락처") {
        const v = (cell.innerText || "").replace(/\s+/g, " ").trim();
        if (v && v.length < 60) meta[label] = v;
      }
    }
  }
  return { meta, content };
}

// ◆-구조 본문 → key:value 맵(마커 제거 + 첫 콜론 분리 + 키 공백 제거). 빈 값은 제외.
function parseContent(content) {
  const kv = {};
  const clean = (s) => (s || "").replace(/[\u200B\uFEFF\u00A0]/g, "").trim(); // zero-width·BOM·nbsp 제거
  for (const raw of (content || "").split("\n")) {
    const line = clean(raw.replace(/^[\s◆▪▹‣•\-]+/, ""));
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const key = line.slice(0, ci).replace(/\s+/g, "");
    const val = clean(line.slice(ci + 1));
    if (key && val) kv[key] = val;
  }
  return kv;
}

const parenTail = (s, re) => { const m = (s || "").match(re); return m ? m[1] : null; };

// 파싱된 META+본문 → enrollment_consultations 필드(빈 값 null).
// ⚠️ makeedu 내용은 텍스트 블록 → 본문 전체를 parent_request(상담 내용/학부모 요구사항 카드)에 그대로 담고,
//    인식 가능한 구조화 항목(경로·주소·혈액형·과목·셔틀·동의)은 추가로 전용 필드(학생 상세 정보)에도 파싱한다.
function toFields(meta, content) {
  const kv = parseContent(content);
  const cleaned = (content || "").replace(/[\u200B\uFEFF\u00A0]/g, "").trim();
  const subjRaw = kv["상담과목(주)"] || kv["상담과목"] || null;
  // parent_request = makeedu 상담 내용 본문 전체(텍스트). 화면 상담 내용/학부모 요구사항 카드에 그대로 노출.
  const parentRequest = cleaned.length > 5 ? cleaned : null;
  return {
    parentName: meta["보호자명"] || null,
    gender: L.gender(parenTail(meta["원생명"], /[(（]\s*([남여])\s*[)）]/)),
    parentRelation: parenTail(meta["보호자연락처"], /[(（]\s*([^)）]+?)\s*[)）]/), // 모/부/조부…
    consultationPath: kv["알게된경로"] || null,
    careerGoal: kv["희망진로"] || null,
    address: kv["자택주소"] || null,
    siblings: kv["남매"] || null,
    bloodType: kv["혈액형"] || null,
    subject: subjRaw ? L.subjectFromName(subjRaw) : null,
    registrationStatus: kv["상담상태"] || null,
    parentRequest,
    followUpContent: kv["상담완료과목"] ? `상담 완료 과목: ${kv["상담완료과목"]}` : null,
    shuttleBus: /신청/.test(kv["셔틀버스신청"] || ""),
    installmentAgree: /동의/.test(kv["할부규정동의"] || ""),
    privacyAgree: /동의/.test(kv["개인정보동의"] || ""),
  };
}

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const tenantId = await L.resolveTenantId(sql);
  // aywa에 적재된 makeedu 예비상담(makeedu_id=counselSeq)만 대상.
  const targets = await sql`
    select makeedu_id from enrollment_consultations
    where tenant_id = ${tenantId} and makeedu_id is not null`;
  console.log("대상 예비상담(makeedu_id):", targets.length);

  const browser = await chromium.launch({ headless: !process.env.HEADED });
  try {
    // 로그인 한 벌(login-guard.cjs) — 저장 세션 → 자동 로그인 멈춤 표시 → ID/PW 한 번.
    const { ctx, page } = await G.openMakeeduContext(browser, { log: (m) => console.log(m) });

    if (!APPLY) {
      // dry: 앞 3건만 fetch해 파싱 결과 표본.
      for (const t of targets.slice(0, 3)) {
        await page.goto(`${BASE}/counsel/counselList_detail.do?counselSeq=${t.makeedu_id}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        const { meta, content } = await page.evaluate(EXTRACT_DETAIL);
        console.log(`\n[seq ${t.makeedu_id}] fields:`, JSON.stringify(toFields(meta, content)));
      }
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }

    // 상세 동시 fetch
    const items = targets.map((t) => ({ seq: t.makeedu_id }));
    let idx = 0, failed = 0;
    async function worker() {
      const pg = await ctx.newPage();
      while (true) {
        const my = idx++;
        if (my >= items.length) break;
        const it = items[my];
        try {
          await pg.goto(`${BASE}/counsel/counselList_detail.do?counselSeq=${it.seq}`, { waitUntil: "domcontentloaded", timeout: 20000 });
          const { meta, content } = await pg.evaluate(EXTRACT_DETAIL);
          it.f = toFields(meta, content);
        } catch { failed++; }
        if (my % 100 === 0) console.log(`  detail ${my}/${items.length}`);
      }
      await pg.close();
    }
    await Promise.all(Array.from({ length: CONC }, () => worker()));
    console.log("detail fetched, failed:", failed);

    // 백필: 텍스트는 coalesce(빈 값만), boolean은 OR(켜기만) → ijw 값 보존.
    let up = 0;
    for (const it of items) {
      if (!it.f) continue;
      const f = it.f;
      const res = await sql`
        update enrollment_consultations set
          parent_name = coalesce(parent_name, ${f.parentName}),
          gender = coalesce(gender, ${f.gender}),
          parent_relation = coalesce(parent_relation, ${f.parentRelation}),
          consultation_path = coalesce(consultation_path, ${f.consultationPath}),
          career_goal = coalesce(career_goal, ${f.careerGoal}),
          address = coalesce(address, ${f.address}),
          siblings = coalesce(siblings, ${f.siblings}),
          blood_type = coalesce(blood_type, ${f.bloodType}),
          subject = coalesce(subject, ${f.subject}),
          registration_status = coalesce(registration_status, ${f.registrationStatus}),
          -- parent_request: 빈 값이거나 목록-동기화 안내문구(sentinel)면 실제 본문으로 덮어씀(그 외 ijw/기존 본문은 보존).
          parent_request = coalesce(nullif(parent_request, ${L.PROSPECT_LIST_NOTE}), ${f.parentRequest}, parent_request),
          follow_up_content = coalesce(follow_up_content, ${f.followUpContent}),
          shuttle_bus_request = shuttle_bus_request or ${f.shuttleBus},
          installment_agreement = installment_agreement or ${f.installmentAgree},
          privacy_agreement = privacy_agreement or ${f.privacyAgree},
          updated_at = now()
        where tenant_id = ${tenantId} and makeedu_id = ${it.seq}`;
      up += res.count;
    }
    await L.recordSync(sql, tenantId, "prospects", up);
    console.log("백필된 예비상담:", up);
  } finally {
    await browser.close();
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
