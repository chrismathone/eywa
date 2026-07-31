/**
 * scripts/_makeedu/invoice-stale.cjs — import-invoices.cjs 구조적 사각 보완 공유 모듈(2026-07-13, 머지 적대 리뷰 I4).
 * ① 삭제 미반영: makeedu에서 그 달 라인이 전부 삭제돼 스크랩에 안 나타나는 (학생,월)을 분류(classifyStale).
 * ② 미매칭 가시화: 학생 매칭 실패 라인·부재 행 상세를 리포트 파일로 기록(writeReport).
 * 순수 분류 + 로컬 파일 IO만 — DB 접근 없음(조회·void 실행은 호출부 import-invoices.cjs).
 */
const fs = require("fs");
const path = require("path");

// 스크랩 (학생,월) 커버리지가 이 비율 미만인 월 = 부분 스크랩(페이지 유실·필터 이상) 의심 → 그 월 전건 판단 보류.
// (정상 스크랩 실측 2026-07-13: 현재 청구월 364/400 = 91%. 대량 오탐-void 방지의 핵심 가드.)
const STALE_COVERAGE_MIN = 0.8;

// ⚠️⚠️ 2026-07-30 실측으로 추가된 2중 가드 — 커버리지 가드만으로는 **전혀 충분하지 않다.**
// 그날 무효 후보 18건을 실제로 뜯어보니 **14건이 재원생**이었다(활성 수강 1~3개, 최근 14일 출결 있음,
// 7월 청구는 완납). 그중 2건은 "어제까진 makeedu에 있다가 오늘 사라진" 행이었다. 커버리지는 95.1%로
// 80% 가드를 여유롭게 통과했다 — 즉 **소수 행 누락과 실제 삭제는 커버리지로 구분되지 않는다.**
// 그대로 켰다면 실재하는 미수 ₩4.2M이 화면에서 사라져 수금 대상에서 빠졌을 것이다.
//
// 그래서 voidable은 아래 **셋 다** 만족해야 한다:
//   ① makeedu형 라인    ② 미완납(unpaid|partial)
//   ③ 최소 부재 지속일 이상 연속 부재    ④ 그 학생에게 **활성 수강이 없음**
// ③은 "한 번 못 잡힌 것"과 "지워진 것"을 가른다(하루 2회 동기화 → 7일 = 연속 14회 부재).
// ④는 "지금도 수업을 다니는 학생의 이번 달 청구가 삭제됐다"는 설명하기 어려운 전제를 거른다.
// 둘 중 하나라도 미달이면 void가 아니라 **리포트로만** 남긴다(놓친 게 아니라 보류한 것).
const STALE_MIN_ABSENT_DAYS = 7;

// ⚠️⚠️ 대량 무효 서킷브레이커 (2026-07-31 실측으로 추가).
// 스크랩 **범위를 넓힌 첫 실행**에서 17건이 한 번에 void됐다(₩5.4M). 새로 범위에 들어온 달의 행들은
// 그동안 스크랩 밖이었다는 이유만으로 "부재 지속일"이 길게 잡혀 ③가드를 그냥 통과한다 —
// 즉 **범위 변경 = 대량 오탐의 조건**이다. 개별 가드로는 이 상황을 못 막는다(각 행은 전부 정상 통과한다).
// 그래서 "한 실행에서 이보다 많이 지우려 하면 전부 보류하고 사람을 부른다"는 상위 브레이커를 둔다.
// 돈을 지우는 판정에서 **대량은 그 자체로 신호**다. 의도된 대량 정리는 --allow-bulk-void로 명시한다.
const STALE_MAX_VOID_PER_RUN = 10;
const STATUS_KO = { unpaid: "미수", partial: "부분납", paid: "완납", refunded: "환불", void: "무효" };

// ⚠️⚠️ 2026-07-30(2차) 5번째 가드 — **makeedu 퇴원 목록**(scrape.cjs --list=withdrawn, 실측 4,427행).
// 위 4중 가드는 전부 **eywa가 가진 정황**뿐이다(활성 수강이 없다·며칠째 안 보인다). 그런데 그날 부재 18건을
// 실제로 뜯어보니 13명이 **재원생**이었고, 그중 둘은 06:00엔 있다가 18:00에 사라졌다 — 12시간 만의 이탈은
// '삭제'가 아니라 **다른 청구월로 옮겨졌거나 수납 처리된 것**에 가깝다. 정황만으로는 이 둘을 못 가른다.
// 퇴원 목록은 **makeedu가 직접 "이 원생은 퇴원"이라고 말하는 유일한 증거**라, 판정을 추측에서 사실로 바꾼다.
//
// 규칙: 목록을 **읽을 수 있을 때만** 이 가드가 켜진다(파일 없음·헤더 불일치 = 가드 비활성 → 기존 4중 가드로).
//       매칭은 `makeedu_id`(원생번호)만 — 이름 매칭은 동명이인·개명으로 틀리고, 틀리면 **남의 청구를 지운다**.
//       그래서 makeedu_id가 없는 학생은 통과시키지 않는다(안전한 쪽으로 실패).

// makeedu 임포트 라인 판별: 현행 스키마는 paid/unpaid 필드 보유, 07-01 옛 additive 스키마는 {kind,description,amount}뿐이나
// kind가 한글 구분(수업/교재/차량비…)이다. eywa 수동 청구(createInvoice)는 kind가 영문 카테고리(tuition/material…) + paid 없음.
// (실측: 2026-07 stale 25건 중 07-01산(産) 구스키마가 다수 — paid만 보면 전부 수동으로 오분류돼 영구 보류된다.)
function isMakeeduShape(lineItems) {
  const li = Array.isArray(lineItems) ? lineItems : [];
  return li.length > 0 &&
    li.some((it) => it && typeof it === "object" && ("paid" in it || /[가-힣]/.test(String(it.kind || ""))));
}

// 표시용 잔액(청구-할인-수납, 음수 clamp). status 판정에는 절대 안 씀 — status는 makeedu 미납 합이 진실(doctrine).
const remainWon = (e) =>
  Math.max(0, Number(e.amount_total) - Number(e.amount_paid) - Number(e.amount_discount || 0));

/**
 * eywa에만 남은 (학생,월) 분류. existing = 스크랩 커버 월의 eywa 인보이스(+학생 join, void 제외).
 * - voidable:      makeedu형 + 미완납 + **{@link STALE_MIN_ABSENT_DAYS}일 이상 연속 부재 + 활성 수강 없음**
 *                  → --void-stale 시 무효 전환 대상(유령 미수 해소)
 * - settled:       완납/환불 — 돈 받은 기록이라 항상 보존(리포트만)
 * - holdUnmatched: 같은 이름이 미매칭 라인에 있음 — makeedu엔 있는데 학생 매칭이 실패했을 수 있어 보류
 * - holdManual:    라인 형태가 수동 청구(paid 필드 없음) — makeedu에 원래 없는 eywa 자체 청구라 보류
 * - holdRecent:    부재 지속일 < STALE_MIN_ABSENT_DAYS — "한 번 못 잡힌 것"일 수 있어 보류
 * - holdActive:    그 학생에게 활성 수강이 있음 — 수업을 다니는 학생의 청구 삭제는 전제가 약해 보류
 * - holdNotWithdrawn: makeedu **퇴원 목록에 없다** — 삭제가 아니라 다른 청구월 이동일 수 있어 보류
 * - heldPeriods:   커버리지 < STALE_COVERAGE_MIN 월 — 부분 스크랩 의심, 그 월 부재 전건 보류
 *
 * @param existing        각 행에 `updated_at`(마지막 갱신 = 마지막으로 스크랩에 잡힌 시각) 포함 필요
 * @param activeStudentIds 활성 수강(end_date null · on_hold false)이 있는 학생 id Set
 * @param withdrawnMakeeduIds makeedu 퇴원 목록의 원생번호 Set. **null이면 가드 비활성**(목록을 못 읽은 실행)
 * @param now             부재 지속일 계산 기준(테스트 결정성 위해 주입)
 */
function classifyStale({
  existing, scrapedKeys, unmatchedNameKeys, normalizeName, activeStudentIds, withdrawnMakeeduIds,
  allowBulkVoid, now,
}) {
  const active = activeStudentIds || new Set();
  const nowMs = (now ? new Date(now) : new Date()).getTime();
  const absentDays = (e) =>
    e.updated_at ? (nowMs - new Date(e.updated_at).getTime()) / 86_400_000 : Infinity;

  const byPeriod = new Map();
  for (const e of existing) {
    let g = byPeriod.get(e.period);
    if (!g) byPeriod.set(e.period, (g = { total: 0, present: 0, rows: [] }));
    g.total++;
    if (scrapedKeys.has(`${e.student_id}|${e.period}`)) g.present++;
    else g.rows.push(e);
  }
  const b = {
    voidable: [], settled: [], holdUnmatched: [], holdManual: [],
    holdRecent: [], holdActive: [], holdNotWithdrawn: [], holdBulk: [], heldPeriods: [],
    // 목록을 못 읽은 실행인지 리포트·요약이 알 수 있게 남긴다(가드가 조용히 꺼진 걸 숨기지 않는다).
    withdrawnGuard: withdrawnMakeeduIds ? { enabled: true, size: withdrawnMakeeduIds.size } : { enabled: false },
  };
  // makeedu가 "퇴원"이라고 확인해 주는가. 목록이 없으면(가드 비활성) 항상 true로 두어 기존 4중 가드만 적용.
  const confirmedWithdrawn = (e) =>
    !withdrawnMakeeduIds || (!!e.makeedu_id && withdrawnMakeeduIds.has(String(e.makeedu_id).trim()));
  for (const [period, g] of byPeriod) {
    if (!g.rows.length) continue;
    const coverage = g.present / g.total;
    if (coverage < STALE_COVERAGE_MIN) {
      b.heldPeriods.push({ period, coverage: Math.round(coverage * 100), count: g.rows.length });
      continue;
    }
    for (const e of g.rows) {
      if (unmatchedNameKeys.has(`${normalizeName(e.name)}|${e.period}`)) b.holdUnmatched.push(e);
      else if (!isMakeeduShape(e.line_items)) b.holdManual.push(e);
      else if (e.status !== "unpaid" && e.status !== "partial") b.settled.push(e);
      // ⚠️ 순서 주의: 완납 보존 판정을 먼저 하고, 그 다음에 미완납만 부재일·활성수강 가드를 태운다.
      else if (absentDays(e) < STALE_MIN_ABSENT_DAYS) b.holdRecent.push({ ...e, absentDays: absentDays(e) });
      else if (active.has(e.student_id)) b.holdActive.push(e);
      // ⑤ makeedu 퇴원 목록 대조 — 정황(위 4개)의 마지막 확인. 목록에 없으면 '이동'일 수 있어 지우지 않는다.
      else if (!confirmedWithdrawn(e)) b.holdNotWithdrawn.push(e);
      else b.voidable.push(e);
    }
  }
  // 상위 브레이커 — 개별 가드를 다 통과했어도 **한 번에 너무 많이** 지우려 하면 전부 보류한다.
  if (!allowBulkVoid && b.voidable.length > STALE_MAX_VOID_PER_RUN) {
    b.holdBulk = b.voidable;
    b.voidable = [];
  }
  return b;
}

// void 시 notes 앞에 붙일 한글 마커 — UI에 근거 노출 + 직전 상태·금액 보존(수동 복원 근거).
// makeedu에 라인이 재등장하면 upsert가 status 복원 + 이 마커를 자동 제거(import-invoices.cjs의 notes CASE).
function voidMarker(e, today) {
  const won = (n) => Number(n).toLocaleString("ko-KR");
  return `[동기화] ${today} makeedu 청구 삭제 반영 — 무효 처리(직전 ${STATUS_KO[e.status] || e.status} · 청구 ₩${won(e.amount_total)} · 수납 ₩${won(e.amount_paid)})`;
}

const won = (n) => `₩${Number(n).toLocaleString("ko-KR")}`;
const fmtRow = (e) =>
  `${e.name}(${e.grade || "?"}) ${STATUS_KO[e.status] || e.status} 청구${won(e.amount_total)} 수납${won(e.amount_paid)} [${e.period}]`;

// 콘솔 요약(연동 PC 로그·수동 dry-run에서 사람이 바로 읽는 용도). 반환값 = 무효 대상 잔액 합계.
function printIssues({ stale, unmatchedLines }) {
  if (unmatchedLines.length) {
    console.log(`\n⚠️ 학생 미매칭 라인 ${unmatchedLines.length}건 — eywa 학생의 makeedu_id 누락 또는 동명 모호(학생 연결 후 다음 동기화에 자동 반영):`);
    for (const u of unmatchedLines.slice(0, 15))
      console.log(`  - ${u.name}(${u.grade || "?"}) ${u.period} ${u.kind}/${u.item} 청구${won(u.total)} 미납${won(u.unpaid)}`);
    if (unmatchedLines.length > 15) console.log(`  … 외 ${unmatchedLines.length - 15}건(리포트 파일에 전체)`);
  }
  const remain = stale.voidable.reduce((s, e) => s + remainWon(e), 0);
  if (stale.voidable.length) {
    console.log(`\n⚠️ makeedu 부재(삭제 추정) 미완납 ${stale.voidable.length}건 · 잔액 ${won(remain)} — --void-stale 시 무효 전환 대상:`);
    for (const e of stale.voidable.slice(0, 15)) console.log(`  - ${fmtRow(e)}`);
    if (stale.voidable.length > 15) console.log(`  … 외 ${stale.voidable.length - 15}건`);
  }
  if (stale.settled.length) console.log(`ℹ️ makeedu 부재지만 완납/환불 ${stale.settled.length}건 — 수납 기록 보존(리포트만).`);
  if (stale.holdUnmatched.length) console.log(`ℹ️ 보류(미매칭 의심) ${stale.holdUnmatched.length}건 — 같은 이름이 미매칭 라인에 있어 판단 유보.`);
  if (stale.holdManual.length) console.log(`ℹ️ 보류(수동 청구 추정) ${stale.holdManual.length}건 — eywa에서 직접 만든 청구로 보임.`);
  if (stale.holdRecent.length) {
    const r = stale.holdRecent.reduce((s2, e) => s2 + remainWon(e), 0);
    console.log(`ℹ️ 보류(부재 ${STALE_MIN_ABSENT_DAYS}일 미만) ${stale.holdRecent.length}건 · 잔액 ${won(r)} — 한 번 못 잡힌 것일 수 있어 유보:`);
    for (const e of stale.holdRecent.slice(0, 10)) console.log(`  - ${fmtRow(e)} (부재 ${e.absentDays.toFixed(1)}일)`);
  }
  if (stale.holdActive.length) {
    const r = stale.holdActive.reduce((s2, e) => s2 + remainWon(e), 0);
    console.log(`⚠️ 보류(활성 수강 있음) ${stale.holdActive.length}건 · 잔액 ${won(r)} — 지금도 수업을 다니는 학생이라 '청구 삭제' 전제가 약함. **사람이 확인할 것**:`);
    for (const e of stale.holdActive.slice(0, 15)) console.log(`  - ${fmtRow(e)}`);
  }
  if (stale.holdBulk?.length) {
    const r = stale.holdBulk.reduce((s2, e) => s2 + remainWon(e), 0);
    console.log(`🔴 보류(대량 무효 차단) ${stale.holdBulk.length}건 · 잔액 ${won(r)} — 한 실행 한도 ${STALE_MAX_VOID_PER_RUN}건을 넘어 **전부 보류**했습니다.`);
    console.log(`   스크랩 범위를 방금 넓혔다면 정상입니다(새 달의 행은 부재일이 길게 잡힙니다). 목록을 확인한 뒤 의도한 정리면 --allow-bulk-void 로 다시 실행하세요:`);
    for (const e of stale.holdBulk.slice(0, 20)) console.log(`  - ${fmtRow(e)}`);
    if (stale.holdBulk.length > 20) console.log(`  … 외 ${stale.holdBulk.length - 20}건(리포트 파일에 전체)`);
  }
  if (stale.holdNotWithdrawn?.length) {
    const r = stale.holdNotWithdrawn.reduce((s2, e) => s2 + remainWon(e), 0);
    console.log(`ℹ️ 보류(makeedu 퇴원 목록에 없음) ${stale.holdNotWithdrawn.length}건 · 잔액 ${won(r)} — 삭제가 아니라 다른 청구월로 옮겨졌을 수 있어 유보:`);
    for (const e of stale.holdNotWithdrawn.slice(0, 10)) console.log(`  - ${fmtRow(e)}`);
  }
  if (stale.withdrawnGuard && !stale.withdrawnGuard.enabled)
    console.log(`ℹ️ makeedu 퇴원 목록을 못 읽어 5번째 가드는 꺼진 채 판정했습니다(scrape --list=withdrawn 확인).`);
  for (const h of stale.heldPeriods)
    console.log(`⚠️ ${h.period} 스크랩 커버리지 ${h.coverage}% < ${STALE_COVERAGE_MIN * 100}% — 부분 스크랩 의심, 그 월 부재 ${h.count}건 판단 보류.`);
  return remain;
}

// makeedu_sync_state.error에 남길 한 줄 요약(연동 이력 추적용) — 이슈 없으면 null.
// ⚠️ 대조 불일치(reconcile)는 **맨 앞**에 둔다 — 화면 배지가 앞부분을 먼저 보여주고, 금액이 안 맞는 건
//    보류 몇 건보다 항상 먼저 알아야 하는 사실이다.
function issueSummary({ stale, unmatchedLines, voidStale, voided, reconcile, truncation }) {
  const parts = [];
  // ⚠️ 절단은 대조보다도 먼저다 — 목록을 덜 받은 상태의 판정은 전부 신뢰할 수 없다.
  if (truncation)
    parts.push(
      truncation.collected < truncation.reported
        ? `🔴 스크랩 절단 의심(화면 ${truncation.reported}건 · 수집 ${truncation.collected}건)`
        : `스크랩 초과 수집(화면 ${truncation.reported}건 · 수집 ${truncation.collected}건 — 합계행 혼입 가능)`,
    );
  const mism = reconcileSummary(reconcile);
  if (mism) parts.push(mism);
  if (unmatchedLines.length) parts.push(`학생 미매칭 ${unmatchedLines.length}라인`);
  if (stale.voidable.length)
    parts.push(`makeedu 부재 미완납 ${stale.voidable.length}건${voidStale ? `(void ${voided})` : "(보류)"}`);
  if (stale.settled.length) parts.push(`부재 완납 ${stale.settled.length}건(보존)`);
  // ⚠️ 활성 수강 보류는 **사람이 봐야 하는 신호**다 — 화면 배지의 '확인 필요'로 올라간다.
  if (stale.holdActive.length) parts.push(`재원생 청구 부재 ${stale.holdActive.length}건(확인 필요)`);
  if (stale.holdBulk?.length)
    parts.push(`🔴 대량 무효 차단 ${stale.holdBulk.length}건(전부 보류 — 확인 필요)`);
  if (stale.holdNotWithdrawn?.length) parts.push(`퇴원 목록에 없음 ${stale.holdNotWithdrawn.length}건(보류)`);
  if (stale.holdRecent.length) parts.push(`부재 ${STALE_MIN_ABSENT_DAYS}일 미만 ${stale.holdRecent.length}건(보류)`);
  if (stale.heldPeriods.length) parts.push(`커버리지 보류 ${stale.heldPeriods.length}개월`);
  if (stale.withdrawnGuard && !stale.withdrawnGuard.enabled) parts.push("퇴원 목록 없음(가드 비활성)");
  return parts.length ? parts.join(" · ") : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 층 2 — 대조(reconciliation). "동기화가 맞는지" 를 실행 안에서 스스로 검산한다.
//
// 🔴 이 프로젝트에서 동기화는 지금까지 **넣고 끝**이었다. 그래서 2026-07이 07-16에 통째로 멈춘 뒤에도
//    화면 배지는 2주 내내 초록불이었다 — 맞는지 아무도 확인하지 않았기 때문이다.
//    "완벽하게 일치"를 말하려면 먼저 **측정 가능한 정의**가 있어야 한다. 그게 아래 3지점 대조다.
//      ① scraped    makeedu 라인 원본 합 (학생 매칭에 성공한 라인만)
//      ② aggregated eywa가 (학생×월) 1행으로 집계한 합
//      ③ stored     저장 후 DB에서 되읽은 합
//    ①≠② = 집계 버그 · ②≠③ = 저장 버그. **허용 오차는 0원**이다(돈이라 반올림 여지를 두지 않는다).
// ⚠️ 건수는 ②↔③만 비교한다 — ①은 라인 수라 집계 건수와 다른 게 정상이다.
// ⚠️ 미매칭 라인은 애초에 저장 대상이 아니므로 ①에서 제외하고, 별도로 `학생 미매칭 N라인`이 보고한다.
// ─────────────────────────────────────────────────────────────────────────────
const MONEY_FIELDS = ["total", "discount", "paid", "points"];
const zeroAgg = () => ({ count: 0, total: 0, discount: 0, paid: 0, points: 0 });

/** rows를 월별 합계 Map<period, {count,total,discount,paid,points}>로. pick은 각 필드 추출자. */
function aggregateByPeriod(rows, pick) {
  const m = new Map();
  for (const r of rows) {
    const p = pick.period(r);
    if (!p) continue;
    let a = m.get(p);
    if (!a) m.set(p, (a = zeroAgg()));
    a.count += 1;
    for (const f of MONEY_FIELDS) a[f] += Number(pick[f]?.(r) ?? 0) || 0;
  }
  return m;
}

const diffOf = (a, b) => Object.fromEntries(MONEY_FIELDS.map((f) => [f, (b[f] || 0) - (a[f] || 0)]));
const isZero = (d) => MONEY_FIELDS.every((f) => d[f] === 0);

/**
 * 월별 3지점 대조. 반환 = 월별 행 배열(불일치 여부 포함). 순수 함수.
 * @param scraped/aggregated/stored Map<period, agg> (aggregateByPeriod 산출물)
 */
function reconcilePeriods({ scraped, aggregated, stored }) {
  const periods = [...new Set([...scraped.keys(), ...aggregated.keys(), ...stored.keys()])].sort();
  return periods.map((period) => {
    const s = scraped.get(period) || zeroAgg();
    const a = aggregated.get(period) || zeroAgg();
    const d = stored.get(period) || zeroAgg();
    const aggDiff = diffOf(s, a); // ①→② 집계에서 생긴 차
    const saveDiff = diffOf(a, d); // ②→③ 저장에서 생긴 차
    const countDiff = d.count - a.count;
    return {
      period, scraped: s, aggregated: a, stored: d, aggDiff, saveDiff, countDiff,
      ok: isZero(aggDiff) && isZero(saveDiff) && countDiff === 0,
    };
  });
}

const FIELD_KO = { total: "청구", discount: "할인", paid: "수납", points: "적립" };

/** 불일치만 한 줄로. 전부 일치면 null(요약에 아무것도 안 붙는다). */
function reconcileSummary(rows) {
  if (!rows || !rows.length) return null;
  const bad = rows.filter((r) => !r.ok);
  if (!bad.length) return null;
  const detail = bad
    .map((r) => {
      const bits = [];
      if (r.countDiff) bits.push(`건수 ${r.countDiff > 0 ? "+" : ""}${r.countDiff}`);
      for (const f of MONEY_FIELDS) {
        const v = (r.aggDiff[f] || 0) + (r.saveDiff[f] || 0);
        if (v) bits.push(`${FIELD_KO[f]} ${v > 0 ? "+" : ""}${Number(v).toLocaleString("ko-KR")}원`);
      }
      return `${r.period}(${bits.join(" ") || "차이"})`;
    })
    .join(" · ");
  return `🔴 makeedu와 불일치 ${detail}`;
}

/** 콘솔용 월별 대조표. 사람이 연동 PC 로그에서 바로 읽는다. */
function printReconcile(rows) {
  if (!rows || !rows.length) return;
  console.log("\n── 월별 대조(makeedu 라인 → 집계 → 저장, 허용 오차 0원) ──");
  for (const r of rows) {
    const head = `${r.ok ? "✅" : "🔴"} ${r.period}  건수 ${r.aggregated.count}→${r.stored.count}`;
    const nums = MONEY_FIELDS.map((f) => `${FIELD_KO[f]} ${won(r.stored[f])}`).join(" · ");
    console.log(`  ${head}  ${nums}`);
    if (!r.ok) {
      if (r.countDiff) console.log(`      건수 차 ${r.countDiff}`);
      if (!isZero(r.aggDiff)) console.log(`      집계 차(라인→집계): ${JSON.stringify(r.aggDiff)}`);
      if (!isZero(r.saveDiff)) console.log(`      저장 차(집계→DB): ${JSON.stringify(r.saveDiff)}`);
    }
  }
}

/**
 * makeedu 퇴원 목록 JSON({headers, rows}) → 원생번호 Set. 읽을 수 없으면 **null**(가드 비활성).
 * ⚠️ 열 이름이 목록마다 다르다 — 퇴원 목록은 `원생번호`, 재원 목록은 `원생고유번호`(실측). 둘 다 받는다.
 * ⚠️ 이 파일에는 보호자 전화·퇴원 사유(실 PII)가 들어 있다. **여기서는 번호만 뽑고 나머지는 절대 안 읽는다.**
 */
function buildWithdrawnIndex(doc) {
  const headers = doc && Array.isArray(doc.headers) ? doc.headers : null;
  const rows = doc && Array.isArray(doc.rows) ? doc.rows : null;
  if (!headers || !rows || !rows.length) return null;
  const ci = headers.findIndex((h) => /원생고유번호|원생번호/.test(String(h || "")));
  if (ci < 0) return null;
  const set = new Set();
  for (const r of rows) {
    const v = String((Array.isArray(r) ? r[ci] : "") ?? "").trim();
    if (v) set.add(v);
  }
  return set.size ? set : null;
}

// 리포트 2종: 최신 상세 JSON(덮어쓰기 — 부재 행 원본(line_items 포함) = void 백업·복원 근거) +
// 한 줄 히스토리 로그(append, 실행당 1줄이라 무한 증식 없음).
function writeReport(outDir, report) {
  const jsonPath = path.join(outDir, "import-invoices-report.json");
  const logPath = path.join(outDir, "import-invoices-issues.log");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  const b = report.stale;
  const rec = report.reconcile?.length
    ? `${report.reconcile.filter((r) => r.ok).length}/${report.reconcile.length}월 일치`
    : "대조 없음";
  fs.appendFileSync(
    logPath,
    `${report.ranAt} apply=${report.apply} voidStale=${report.voidStale} | 대조 ${rec} | 미매칭 ${report.unmatchedLines.length} | 부재 미완납 ${b.voidable.length}·완납 ${b.settled.length} | 보류 매칭 ${b.holdUnmatched.length}·수동 ${b.holdManual.length}·퇴원목록 ${b.holdNotWithdrawn?.length ?? 0}·대량차단 ${b.holdBulk?.length ?? 0}·월 ${b.heldPeriods.length} | void ${report.voidedCount}\n`,
    "utf8",
  );
  return { jsonPath, logPath };
}

module.exports = {
  classifyStale,
  voidMarker,
  printIssues,
  issueSummary,
  writeReport,
  isMakeeduShape,
  remainWon,
  aggregateByPeriod,
  reconcilePeriods,
  reconcileSummary,
  printReconcile,
  buildWithdrawnIndex,
  STALE_COVERAGE_MIN,
  STALE_MIN_ABSENT_DAYS,
  STALE_MAX_VOID_PER_RUN,
};
