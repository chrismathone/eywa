/**
 * scripts/_makeedu/sync-consultations-incremental.cjs — 재원생 상담 **증분** 동기화 (makeedu → aywa).
 *
 * 초기 대량은 엑셀 부트스트랩(import-consultations-excel.cjs, 반드시 --skip-same-day)이 담당하고,
 * 이 스크립트는 매 동기화마다 **최근 창(기본 7일)만** 목록을 걷어 신규 상담만 상세 fetch해 적재한다.
 * sync-all.cjs의 5번째 도메인(consultations)으로 편입 — 자동(06/18시)·버튼·릴레이 전부에서 실행.
 *
 * 판정 파이프라인(오적재 방지가 최우선 — 설계 리뷰 F1~F10 반영):
 *   a. 상담일 < cutoff → 제외      b. 구분에 '예비' 포함 → 스킵(퇴원생 등 미지 구분은 통과+보고)
 *   c. '예비원생 상담' 템플릿 제목 → 스킵(전환 학생 입회상담=enrollment 소관)
 *   d. counselSeq ∈ 기존 makeedu_id → 스킵      e. 학생 3티어 매칭 실패 → 스킵+보고
 *   f. 상세 fetch 후: strictKey(학생|KST일|내용head60) 일치 + 그 행이 null-id 유일 → **seq 백필**만 /
 *      같은날 null-id 행(내용 상이) → 스킵+보고(ijw 표기 변형 안전판) /
 *      같은날 행 전부 다른 seq → 신규(같은 날 2번째 상담) / 같은날 없음 → 신규
 *
 * 안전장치: 서킷브레이커(신규>200 abort, --allow-large 우회) · insert는 ON CONFLICT DO NOTHING(동시 실행
 * 레이스 무해, **DO UPDATE 금지** — aywa에서 수정한 상담을 재동기화가 덮지 않게 insert-only) ·
 * 전체 데드라인 5분(Playwright 행 걸림이 워처를 블록하지 않게) · summary 포맷은 엑셀 임포터와 동일
 * (`제목\n\n본문`) — strict key 정합.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/sync-consultations-incremental.cjs                 # dry-run
 *   node --env-file=.env.local scripts/_makeedu/sync-consultations-incremental.cjs --apply
 *   옵션: --from=YYYY-MM-DD(창 수동 지정 — 백데이트 회수) · --allow-large(서킷브레이커 우회)
 * cutoff: makeedu_sync_state('consultations') ok→7일 / 비ok→30일+경고 / 일요일 오전(KST)→60일 딥패스.
 */
const postgres = require("postgres");
const L = require("./lib.cjs");
const G = require("./login-guard.cjs");
const {
  makeCounselorMatcher, loadSubjectLabels, resolveConsultationSubject, loadEnrolledSubjects, SUBJECT_REASON_LABEL,
} = require("./consultation-counselor.cjs");
// 반 매핑(0318a) — 앱과 같은 판정 한 벌. 칸이 아직 없으면(SQL 적용 전) 반 없이 적재한다([[#95]]).
const { assignClasses, hasClassColumns } = require("./consultation-class.cjs");

let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("@playwright/test")); }

const BASE = "https://school.makeedu.co.kr";
const APPLY = process.argv.includes("--apply");
const ALLOW_LARGE = process.argv.includes("--allow-large");
const FROM_ARG = (process.argv.find((a) => a.startsWith("--from=")) || "").slice("--from=".length);
const MAX_NEW = Number(process.env.MAKEEDU_CONSULT_MAX || 200); // 서킷브레이커(가드 붕괴 시 대량 오적재 방지)
const MAX_CANDIDATES = 500; // 상세 fetch 전 사전 브레이커(파싱 붕괴 시 대량 fetch 방지)
const PAGE_CAP = 30;
const DEADLINE_MS = 5 * 60_000;

// 데드라인 — Playwright가 행 걸려도 5분 내 명시적 실패(워처/스케줄러 블록 방지). unref로 정상 종료는 안 막음.
const killer = setTimeout(() => {
  console.error(`ERR 데드라인 ${DEADLINE_MS / 1000}초 초과 — 중단(다음 실행이 멱등 재시도)`);
  process.exit(1);
}, DEADLINE_MS);
killer.unref();

// ── KST 날짜 헬퍼 ──────────────────────────────────────────────────────────
const kstDateStr = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
function minusDays(ymd, days) {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - days);
  return t.toISOString().slice(0, 10);
}

// ── 정규화(엑셀 임포터 import-consultations-excel.cjs와 동일 규약 — strict key 정합) ──
function schoolCore(v) {
  const s = L.txt(v);
  if (!s) return "";
  return s
    .replace(/\s+/g, "")
    .replace(/(초등학교|중학교|고등학교|여자중학교|여자고등학교)$/u, "")
    .replace(/(초|중|고|여중|여고)$/u, "")
    .toLowerCase();
}
const normText = (s) => (s || "").replace(/\s+/g, "").slice(0, 60);
const phoneDigits = (v) => ((L.txt(v) || "").replace(/[^0-9]/g, "") || null);
function mapCategory(v) {
  const s = L.txt(v) || "";
  if (/학습|성적|학업/.test(s)) return "academic";
  if (/정서|심리/.test(s)) return "emotional";
  if (/진로|진학|입시/.test(s)) return "career";
  if (/교우|친구/.test(s)) return "social";
  return "general";
}

// ── 목록 추출(sync-consultations.cjs EXTRACT_LIST 확장: +구분·보호자연락처·상담구분) ──
function EXTRACT_LIST() {
  const tables = Array.from(document.querySelectorAll("table"));
  let best = null, br = 0;
  for (const t of tables) { const r = t.querySelectorAll("tbody tr").length; if (r > br) { br = r; best = t; } }
  if (!best) return [];
  const H = Array.from(best.querySelectorAll("thead th, thead td")).map((h) => (h.textContent || "").replace(/\s+/g, " ").trim());
  const ix = (s) => H.findIndex((h) => (h || "").includes(s));
  const I = {
    kind: ix("구분"), name: ix("이름"), school: ix("학교"), grade: ix("학년"),
    pphone: ix("보호자연락처"), cat: ix("상담구분"), title: ix("제목"), reg: ix("등록자"), cdate: ix("상담일"),
  };
  const out = [];
  for (const tr of best.querySelectorAll("tbody tr")) {
    const c = Array.from(tr.children);
    const seqEl = tr.querySelector('input[name="counselSeqTmp"]');
    const seq = seqEl ? seqEl.value : "";
    const cell = (i) => (i >= 0 && c[i] ? (c[i].innerText || "").replace(/\s+/g, " ").trim() : "");
    const name = cell(I.name);
    if (!seq || !name) continue;
    out.push({
      seq, kind: cell(I.kind), name, school: cell(I.school), grade: cell(I.grade),
      pphone: cell(I.pphone), cat: cell(I.cat), title: cell(I.title), reg: cell(I.reg), cdate: cell(I.cdate),
    });
  }
  return out;
}

// ── 상세 본문 추출(sync-consultations.cjs EXTRACT_DETAIL 동일) ──
function EXTRACT_DETAIL() {
  for (const tr of document.querySelectorAll("table tr")) {
    const c = Array.from(tr.children);
    for (let i = 0; i + 1 < c.length; i++) {
      if ((c[i].textContent || "").replace(/\s+/g, "").trim() === "내용") {
        return (c[i + 1].innerText || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim();
      }
    }
  }
  return "";
}

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  let browser;
  try {
    const tenantId = await L.resolveTenantId(sql);

    // ── cutoff 결정 ──
    let cutoff, cutWhy;
    const todayKst = kstDateStr(new Date());
    if (FROM_ARG) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM_ARG)) throw new Error(`--from 형식 오류(YYYY-MM-DD): ${FROM_ARG}`);
      cutoff = FROM_ARG; cutWhy = "--from 수동 지정";
    } else {
      const [st] = await sql`
        select synced_at, status from makeedu_sync_state
        where tenant_id = ${tenantId} and domain = 'consultations'`;
      // 일요일 오전(KST) = 딥패스 60일 — 소급 입력(백데이트) 상담 회수. 멱등 가드라 안전.
      const kstNow = new Date(Date.now() + 9 * 3600_000);
      const deep = kstNow.getUTCDay() === 0 && kstNow.getUTCHours() < 12;
      if (!st) { cutoff = minusDays(todayKst, 7); cutWhy = "state 없음(기본 7일)"; }
      else {
        let days = st.status === "ok" ? 7 : 30;
        if (st.status !== "ok") console.warn(`⚠️ 지난 동기화 status=${st.status} — 버퍼를 30일로 확대(갭 방지)`);
        if (deep) days = Math.max(days, 60);
        cutoff = minusDays(kstDateStr(new Date(st.synced_at)), days);
        cutWhy = `synced_at−${days}일${deep ? "(일요일 딥패스)" : ""}`;
      }
    }
    console.log(`창: 상담일 >= ${cutoff} (${cutWhy}) | 모드: ${APPLY ? "APPLY" : "DRY-RUN"}`);

    // ── 매칭·중복 판정용 데이터(엑셀 임포터와 동일 규약) ──
    const students = await sql`
      select id, name, school, grade, parent_phone, status from students where tenant_id = ${tenantId}`;
    const tiers = [
      (r) => (r.name && r.schoolCore ? `${L.normalizeName(r.name)}|${r.schoolCore}|${r.grade || ""}` : null),
      (r) => (r.name && r.parentPhoneD ? `${L.normalizeName(r.name)}|${r.parentPhoneD}` : null),
      (r) => (r.name ? `${L.normalizeName(r.name)}|${r.grade || ""}` : null),
    ];
    const toKeyRow = (s) => ({
      id: s.id, name: s.name, schoolCore: schoolCore(s.school), grade: L.txt(s.grade),
      parentPhoneD: phoneDigits(s.parent_phone),
    });
    const matchActive = L.tieredMatcher(students.filter((s) => s.status !== "withdrawn").map(toKeyRow), tiers);
    const matchAll = L.tieredMatcher(students.map(toKeyRow), tiers);

    // 기존 상담: seq 셋 + strict/같은날 맵(⚠️ 날짜는 반드시 KST — bare ::date는 UTC라 멱등 깨짐).
    const existing = await sql`
      select id, student_id, makeedu_id,
             to_char(consulted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d, summary
      from student_consultations where tenant_id = ${tenantId}`;
    const knownSeq = new Set(existing.filter((e) => e.makeedu_id).map((e) => String(e.makeedu_id)));
    // ⚠️ aywa가 makeedu로 역푸시한 예비상담(등록상담)의 counselSeq도 스킵 — 재원생 상담으로 되돌아오면 안 된다
    // (라운드트립 방지: push-consultations는 seq를 enrollment_consultations.makeedu_id에 기록. makeedu kind 분류에
    //  의존하지 않는 결정적 가드). '[aywa 온라인 접수]' 제목 가드(아래 c2)와 2중 방어.
    for (const e of await sql`
      select makeedu_id from enrollment_consultations
      where tenant_id = ${tenantId} and makeedu_id is not null`) {
      knownSeq.add(String(e.makeedu_id));
    }
    const strictMap = new Map(); // strictKey -> rows[]
    const dayMap = new Map(); // dayKey -> rows[]
    for (const e of existing) {
      const sk = `${e.student_id}|${e.d}|${normText(e.summary)}`;
      const dk = `${e.student_id}|${e.d}`;
      (strictMap.get(sk) ?? strictMap.set(sk, []).get(sk)).push(e);
      (dayMap.get(dk) ?? dayMap.set(dk, []).get(dk)).push(e);
    }

    // 상담사 매칭(등록자 "이지은(Amy)" → 한글명/영문명 유일 일치 — sync-consultations 로직 + 유일성 가드).
    const users = await sql`select id, display_name, english_name, subjects, status from users where tenant_id = ${tenantId} and system_role <> 'student'`;
    const matchCounselor = makeCounselorMatcher(users);
    const subjectLabels = await loadSubjectLabels(sql, tenantId);

    // ── 목록 걷기(fromYmd 검색 필터 없이 — 날짜 조기종료가 correctness 담당) ──
    browser = await chromium.launch({ headless: !process.env.HEADED });
    // 로그인 한 벌(login-guard.cjs) — sync-all 안에서는 앞 단계 scrape가 저장한 세션을 그대로 쓴다(로그인 0회).
    const { page } = await G.openMakeeduContext(browser, { log: (m) => console.log(m) });
    page.setDefaultTimeout(20000);
    await page.goto(`${BASE}/counsel/counselList.do`, { waitUntil: "networkidle" });
    const ls = page.locator('select[name="listSize"]');
    if (await ls.count()) {
      const vals = await page.$$eval('select[name="listSize"] option', (os) => os.map((o) => o.value).filter((v) => /^\d+$/.test(v)).map(Number));
      if (vals.length) {
        await ls.selectOption(String(Math.max(...vals))).catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(700);
      }
    }

    const listRows = [];
    const seen = new Set();
    let pagesWalked = 0;
    for (let p = 1; p <= PAGE_CAP; p++) {
      pagesWalked = p;
      const rows = await page.evaluate(EXTRACT_LIST);
      let added = 0, allOld = rows.length > 0;
      for (const r of rows) {
        if (seen.has(r.seq)) continue;
        seen.add(r.seq);
        listRows.push(r);
        added++;
        const d = L.parseDate(r.cdate);
        if (d && d >= cutoff) allOld = false;
      }
      // 종료: 이 페이지 전 행이 cutoff 이전(목록=상담일 desc 전제 — 틀려도 오적재 0, 누락만) OR 새 행 0.
      if (allOld || added === 0) break;
      const next = page.locator('.paging a, .pagination a, [class*="pag"] a, .page a').filter({ hasText: new RegExp(`^\\s*${p + 1}\\s*$`) });
      if ((await next.count()) === 0) break;
      await next.first().click().catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(600);
    }
    if (pagesWalked >= PAGE_CAP) console.warn(`⚠️ 페이지 캡(${PAGE_CAP}) 도달 — 창이 비정상적으로 큼(정렬/필터 확인 필요)`);
    console.log(`목록: ${listRows.length}행 (${pagesWalked}페이지)`);

    // ── 행 분기 a~e ──
    const stats = { list: listRows.length, beforeCutoff: 0, prospectKind: 0, prospectTemplate: 0, aywaOnline: 0, knownSeq: 0, noStudent: 0, unknownKind: 0 };
    const candidates = [];
    const noStudentSamples = [];
    for (const r of listRows) {
      const d = L.parseDate(r.cdate);
      if (!d || d < cutoff) { stats.beforeCutoff++; continue; } // a
      if (/예비/.test(r.kind || "")) { stats.prospectKind++; continue; } // b — '예비' 포함만 스킵(퇴원 등 보존)
      if (r.kind && r.kind !== "재원생") stats.unknownKind++; // 미지 구분은 통과하되 보고
      if (/예비원생 상담/.test((r.title || "").slice(0, 30))) { stats.prospectTemplate++; continue; } // c
      // c2 — aywa 역푸시 접수 라벨(재유입 차단). 🔴 개명(2026-09-21) 전에 보낸 건은 makeedu에 '[eywa 온라인 접수]'로 남아 있다 — 둘 다 막는다.
      if (/^\[[ae]ywa 온라인 접수\]/.test((r.title || "").trimStart())) { stats.aywaOnline++; continue; }
      if (knownSeq.has(String(r.seq))) { stats.knownSeq++; continue; } // d (등록상담 seq 포함 = 역푸시 예비상담도 스킵)
      const rec = { name: r.name, grade: L.gradeNorm(r.grade), schoolCore: schoolCore(r.school), parentPhoneD: phoneDigits(r.pphone) };
      const studentId = matchActive(rec) || matchAll(rec); // e
      if (!studentId) {
        stats.noStudent++;
        if (noStudentSamples.length < 8) noStudentSamples.push(`${r.name}(${r.school || "?"} ${r.grade || "?"})`);
        continue;
      }
      candidates.push({ ...r, dateStr: d, studentId });
    }
    console.log("[분기]", JSON.stringify(stats), "| 상세 fetch 후보:", candidates.length);
    if (noStudentSamples.length) console.log("학생 미매칭 표본:", noStudentSamples.join(", "));
    if (candidates.length > MAX_CANDIDATES && !ALLOW_LARGE) {
      throw new Error(`후보 ${candidates.length} > ${MAX_CANDIDATES} — 파싱/필터 붕괴 의심(사전 브레이커). --allow-large로만 우회.`);
    }

    // ── f. 상세 fetch 후 최종 판정(strict 백필 / 같은날 스킵 / 신규) ──
    const toBackfill = []; // { existingId, seq }
    const toInsert = []; // { r, summary }
    const sameDaySkipped = [];
    let fetchFailed = 0;
    for (const c of candidates) {
      let body;
      try {
        await page.goto(`${BASE}/counsel/counselList_detail.do?counselSeq=${c.seq}`, { waitUntil: "domcontentloaded" });
        body = await page.evaluate(EXTRACT_DETAIL);
      } catch {
        fetchFailed++; // 상세 실패 = 이번 실행 스킵(제목만 넣으면 strict key가 영구 어긋남) → 다음 실행 재시도
        continue;
      }
      const summary = c.title && body ? `${c.title}\n\n${body}` : body || c.title;
      if (!summary) { fetchFailed++; continue; }

      const strictKey = `${c.studentId}|${c.dateStr}|${normText(summary)}`;
      const dayKey = `${c.studentId}|${c.dateStr}`;
      const strictRows = strictMap.get(strictKey) || [];
      const nullIdStrict = strictRows.filter((e) => !e.makeedu_id);
      if (strictRows.length) {
        // 내용까지 동일한 기존 행 — null-id가 정확히 1건이면 counselSeq 백필(엑셀 부트스트랩분 연결).
        if (nullIdStrict.length === 1) toBackfill.push({ existingId: nullIdStrict[0].id, seq: c.seq, label: `${c.name} ${c.dateStr}` });
        continue; // 어느 쪽이든 insert는 안 함(동일 내용 존재)
      }
      const dayRows = dayMap.get(dayKey) || [];
      const dayNullId = dayRows.filter((e) => !e.makeedu_id);
      if (dayNullId.length > 0) {
        // 같은날 null-id 행(내용 상이) = ijw/엑셀 표기 변형일 가능성 → 보수적으로 스킵+보고.
        sameDaySkipped.push({ name: c.name, date: c.dateStr, 기존: (dayNullId[0].summary || "").slice(0, 50).replace(/\n/g, "⏎"), 신규: summary.slice(0, 50).replace(/\n/g, "⏎") });
        continue;
      }
      // 같은날 행이 없거나 전부 다른 seq(=같은 날 2번째 상담) → 진짜 신규.
      toInsert.push({ ...c, summary });
      // 배치 내 정합: 방금 결정한 신규를 맵에 반영(같은 학생·같은 날 중복 목록행 재판정 방지).
      (strictMap.get(strictKey) ?? strictMap.set(strictKey, []).get(strictKey)).push({ id: null, student_id: c.studentId, makeedu_id: c.seq, d: c.dateStr, summary });
      (dayMap.get(dayKey) ?? dayMap.set(dayKey, []).get(dayKey)).push({ id: null, student_id: c.studentId, makeedu_id: c.seq, d: c.dateStr, summary });
      knownSeq.add(String(c.seq));
    }

    console.log(`\n[판정] 신규 ${toInsert.length} | seq 백필 ${toBackfill.length} | 같은날 스킵 ${sameDaySkipped.length} | 상세실패 ${fetchFailed}`);
    for (const s of sameDaySkipped.slice(0, 5)) console.log(` ~ 같은날 스킵: ${s.name} ${s.date}\n     기존: ${s.기존}\n     신규: ${s.신규}`);
    for (const it of toInsert.slice(0, 10)) console.log(` + ${it.name} ${it.dateStr}: ${it.summary.slice(0, 60).replace(/\n/g, "⏎")}`);
    for (const b of toBackfill.slice(0, 10)) console.log(` ↺ 백필: ${b.label} → seq ${b.seq}`);

    // 상담사·과목 판정(2026-09-30 원장 *"동기화로 들어와도 알아서 과목 매핑"*) — makeedu 목록엔 과목 칸이 없어
    // 상담사 담당 과목 → 그날 학생 수강 과목 순으로 좁힌다. 하나로 안 좁혀지면 비운다(추측 금지).
    const enrolledBy = await loadEnrolledSubjects(sql, tenantId, toInsert.map((it) => ({ studentId: it.studentId, date: it.dateStr })));
    const subjectReasons = {};
    let counselorMatched = 0;
    for (const it of toInsert) {
      const counselor = matchCounselor(it.reg);
      it.counselorId = counselor?.id ?? null;
      if (counselor) counselorMatched++;
      const pick = resolveConsultationSubject({
        counselor,
        enrolledSubjects: enrolledBy.get(`${it.studentId}|${it.dateStr}`) || [],
        labels: subjectLabels,
      });
      it.subject = pick?.label ?? null;
      const why = pick ? SUBJECT_REASON_LABEL[pick.reason] : "비움(근거 부족)";
      subjectReasons[why] = (subjectReasons[why] || 0) + 1;
    }
    if (toInsert.length) console.log(`[상담사] 연결 ${counselorMatched}/${toInsert.length} · [과목]`, JSON.stringify(subjectReasons));

    // 반 — 상담사가 그날 가르치는 학생의 수강 반이 하나일 때만(consultation-class.cjs). 과목을 정한 **뒤에** 판정한다(과목으로 좁히므로).
    const classOn = await hasClassColumns(sql);
    let classReasons = null;
    if (classOn && toInsert.length) {
      const items = toInsert.map((it) => ({ studentId: it.studentId, date: it.dateStr, counselorId: it.counselorId, subject: it.subject }));
      classReasons = await assignClasses(sql, tenantId, items, subjectLabels);
      items.forEach((x, i) => { toInsert[i].classId = x.classId; toInsert[i].classSource = x.classSource; });
      console.log("[반]", JSON.stringify(classReasons));
    }

    // 서킷브레이커 — 가드 붕괴 시 대량 오적재 방지.
    if (toInsert.length > MAX_NEW && !ALLOW_LARGE) {
      throw new Error(`신규 ${toInsert.length} > ${MAX_NEW} — 비정상 급증(서킷브레이커). dry-run 검토 후 --allow-large로만 우회.`);
    }

    if (!APPLY) { console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }

    // ↻ 배지 규약: 성공 실행 시작에 지난 신규 라벨 클리어 → 이번 신규만 라벨(다음 동기화까지 유지).
    const cleared = await sql`
      update student_consultations set sync_added_at = null
      where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`지난 동기화 라벨 클리어: ${cleared.count}`);

    let inserted = 0, backfilled = 0, classMapped = 0;
    for (const b of toBackfill) {
      const res = await sql`
        update student_consultations set makeedu_id = ${b.seq}, updated_at = now()
        where id = ${b.existingId} and makeedu_id is null`;
      backfilled += res.count;
    }
    for (const it of toInsert) {
      // insert-only + ON CONFLICT DO NOTHING: 동시 실행(스케줄+워처 겹침)에도 같은 seq 이중 insert 불가.
      const res = await sql`
        insert into student_consultations
          (tenant_id, makeedu_id, student_id, counselor_id, consulted_at, category, subject, summary, sync_added_at
           ${classOn ? sql`, class_id, class_source` : sql``})
        values (${tenantId}, ${it.seq}, ${it.studentId}, ${it.counselorId},
                ${`${it.dateStr}T00:00:00+09:00`}, ${mapCategory(it.cat)},
                ${it.subject}, ${it.summary}, now()
                ${classOn ? sql`, ${it.classId ?? null}, ${it.classSource ?? null}` : sql``})
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null do nothing`;
      inserted += res.count;
      if (it.classId) classMapped += res.count;
    }
    await L.recordSync(sql, tenantId, "consultations", inserted + backfilled);
    // 감사로그 — 동기화가 상담을 새로 넣은 실행만(0건 실행은 남기지 않는다). 실패해도 동기화는 성공으로 둔다.
    if (inserted > 0) {
      const audit = {
        action: "student_consultation_sync_import",
        targetType: "student_consultation",
        metadata: {
          inserted,
          counselorMatched,
          subjects: subjectReasons,
          // 반을 판정했을 때만(칸이 없으면 반 이야기를 지어내지 않는다). 새로 넣은 행 중 반에 붙은 수.
          ...(classOn ? { classMapped } : {}),
        },
      };
      await sql`
        insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenantId}, null, ${"makeedu 동기화"}, ${audit.action}, ${audit.targetType}, ${`상담 ${inserted}건`}, ${sql.json(audit.metadata)})`
        .catch((e) => console.warn("감사로그 기록 실패(동기화는 완료):", e.message));
    }
    console.log(`\n✅ inserted: ${inserted} | seq 백필: ${backfilled}`);
  } finally {
    if (browser) await browser.close();
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
