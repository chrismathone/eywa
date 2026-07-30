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
const STATUS_KO = { unpaid: "미수", partial: "부분납", paid: "완납", refunded: "환불", void: "무효" };

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
 * - heldPeriods:   커버리지 < STALE_COVERAGE_MIN 월 — 부분 스크랩 의심, 그 월 부재 전건 보류
 *
 * @param existing        각 행에 `updated_at`(마지막 갱신 = 마지막으로 스크랩에 잡힌 시각) 포함 필요
 * @param activeStudentIds 활성 수강(end_date null · on_hold false)이 있는 학생 id Set
 * @param now             부재 지속일 계산 기준(테스트 결정성 위해 주입)
 */
function classifyStale({ existing, scrapedKeys, unmatchedNameKeys, normalizeName, activeStudentIds, now }) {
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
    holdRecent: [], holdActive: [], heldPeriods: [],
  };
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
      else b.voidable.push(e);
    }
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
  for (const h of stale.heldPeriods)
    console.log(`⚠️ ${h.period} 스크랩 커버리지 ${h.coverage}% < ${STALE_COVERAGE_MIN * 100}% — 부분 스크랩 의심, 그 월 부재 ${h.count}건 판단 보류.`);
  return remain;
}

// makeedu_sync_state.error에 남길 한 줄 요약(연동 이력 추적용) — 이슈 없으면 null.
function issueSummary({ stale, unmatchedLines, voidStale, voided }) {
  const parts = [];
  if (unmatchedLines.length) parts.push(`학생 미매칭 ${unmatchedLines.length}라인`);
  if (stale.voidable.length)
    parts.push(`makeedu 부재 미완납 ${stale.voidable.length}건${voidStale ? `(void ${voided})` : "(보류)"}`);
  if (stale.settled.length) parts.push(`부재 완납 ${stale.settled.length}건(보존)`);
  // ⚠️ 활성 수강 보류는 **사람이 봐야 하는 신호**다 — 화면 배지의 '확인 필요'로 올라간다.
  if (stale.holdActive.length) parts.push(`재원생 청구 부재 ${stale.holdActive.length}건(확인 필요)`);
  if (stale.holdRecent.length) parts.push(`부재 ${STALE_MIN_ABSENT_DAYS}일 미만 ${stale.holdRecent.length}건(보류)`);
  if (stale.heldPeriods.length) parts.push(`커버리지 보류 ${stale.heldPeriods.length}개월`);
  return parts.length ? parts.join(" · ") : null;
}

// 리포트 2종: 최신 상세 JSON(덮어쓰기 — 부재 행 원본(line_items 포함) = void 백업·복원 근거) +
// 한 줄 히스토리 로그(append, 실행당 1줄이라 무한 증식 없음).
function writeReport(outDir, report) {
  const jsonPath = path.join(outDir, "import-invoices-report.json");
  const logPath = path.join(outDir, "import-invoices-issues.log");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  const b = report.stale;
  fs.appendFileSync(
    logPath,
    `${report.ranAt} apply=${report.apply} voidStale=${report.voidStale} | 미매칭 ${report.unmatchedLines.length} | 부재 미완납 ${b.voidable.length}·완납 ${b.settled.length} | 보류 매칭 ${b.holdUnmatched.length}·수동 ${b.holdManual.length}·월 ${b.heldPeriods.length} | void ${report.voidedCount}\n`,
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
  STALE_COVERAGE_MIN,
  STALE_MIN_ABSENT_DAYS,
};
