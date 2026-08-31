/**
 * scripts/_makeedu/reconcile-plan.cjs — **묵은 미납 재대조**의 판단부(순수 함수 · Vitest).
 *
 * 원장 2026-08-31: *"완납은 당연히 건너뛰고, 스마트하게 상태가 변경(재원 → 퇴원 혹은 휴원으로 환불)
 * 혹은 장기미납자만 주기적으로 동기화한다던지 말이야. 모두 동기화하는건 상당한 낭비니까."*
 * + *"makeedu에 없으면 그냥 삭제시켜버리는게 맞을거야. makeedu에서도 삭제시켰다는 뜻이니까."*
 * + *"하지만 혹시 모르니까 3회정도는 삭제시키지말고 대기시키고, 4회째 동기화에도 makeedu에 없으면
 *   eywa 쪽에서도 삭제하는 방향으로 가드를 두자"* + *"대신 해당 학생의 수납이력에는 메모같은식으로 넣어두고"*.
 *
 * 🔴 **왜 따로 필요한가** — 매일 도는 동기화는 **최근 3개 청구월**만 긁는다(`MAKEEDU_INVOICE_MONTHS`).
 *    그 창 밖의 청구는 최초 임포트 값에서 **영원히 얼어붙는다**(실측 2026-08-31: 윤나연 3월 654,000원 ↔
 *    makeedu 277,000원 · 4월 163,500 ↔ 133,500 · 김시윤 2월 30,000 ↔ 15,000 = eywa가 422,000원 과다).
 *    그렇다고 전 기간을 매번 긁는 것은 낭비이자 위험(범위를 넓힌 첫 실행에서 17건이 한 번에 무효 처리된
 *    전례가 있다) — 그래서 **대상을 좁혀** 주기적으로 본다.
 *
 * 대상 두 축(합집합):
 *   ① **장기미납** — 아직 미수가 남은 (학생,월) 중 **동기화 창 밖**. 완납·무효는 대상이 아니다.
 *   ② **상태 변경자** — 최근 N일 안에 재원 → **퇴원·휴원**으로 바뀐 학생. 이 축만 **완납도 본다** —
 *      존재 이유가 **환불**이라서다(퇴원하며 환불하면 완납이던 금액이 바뀐다). 그 대신 창(최근 M개월)으로 좁힌다.
 *
 * 부재 판정(4회 가드):
 *   스크랩에 그 (학생,월)이 없으면 지우지 않고 **미확인 횟수를 센다**(메모로 남긴다). {@link MISS_LIMIT}회째에
 *   비로소 무효 처리한다. ⚠️ 단 **관측을 못 믿는 실행에서는 세지도 않는다** — 그 달 스크랩 커버리지가 낮거나
 *   (부분 스크랩) 이름 매칭 실패율이 높으면 '부재'는 관측이 아니라 잡음이다(둘 다 실제로 오탐을 낸 적이 있다).
 */

/** 몇 번째 미확인에서 무효 처리하나 — 원장 지시: 3회는 대기, 4회째 삭제. */
const MISS_LIMIT = 4;
/** 그 달 스크랩이 이만큼도 안 잡혔으면 부분 스크랩 의심 — 그 달은 세지 않는다. */
const COVERAGE_MIN = 0.8;
/** 학생 매칭 실패가 이 비율을 넘으면 '부재' 관측 자체를 못 믿는다. */
const MAX_UNMATCHED_RATIO = 0.05;
/** 상태 변경 축 — 최근 며칠 안에 퇴원·휴원으로 바뀐 사람을 볼 것인가. */
const STATUS_CHANGE_DAYS = 90;
/**
 * 상태 변경 축 — **바뀐 달을 포함해 몇 달**을 볼 것인가(기본 2 = 바뀐 달 + 직전 달).
 * 🔴 "최근 6개월 전부"로 잡으면 안 된다 — 실측(2026-08-31) 440건이 대상이 되는데 그중 437건이 **완납**이고,
 *    원장 지시는 정확히 그 낭비를 줄이라는 것이었다. 환불은 **퇴원한 그 달(과 직전 달)** 청구에서 난다.
 */
const STATUS_CHANGE_MONTHS = 2;

/** notes 맨 앞 `[동기화] …` 마커 한 줄. 재대조·기존 임포터가 같은 자리를 쓴다. */
const MARKER_RE = /^\[동기화\][^\n]*\n?/;

/** `YYYY-MM`을 n개월 뒤로. */
function shiftMonth(period, n) {
  const [y, m] = String(period).split("-").map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 미수 잔액 — 무효/완납/환불은 0(앱 `invoiceOutstanding`과 같은 규약). */
function outstanding(inv) {
  if (["paid", "void", "refunded"].includes(String(inv.status))) return 0;
  return Math.max(0, Number(inv.amount_total || 0) - Number(inv.amount_discount || 0) - Number(inv.amount_paid || 0));
}

/** notes에 적힌 미확인 횟수(없으면 0). 사람이 메모를 지우면 0으로 돌아간다 — 안전한 방향(삭제가 늦어질 뿐). */
function parseMissCount(notes) {
  const m = MARKER_RE.exec(String(notes || ""));
  if (!m) return 0;
  const n = /확인 안 됨 (\d+)\/\d+회/.exec(m[0]);
  return n ? Number(n[1]) : 0;
}

/** 미확인 메모 — 수납 이력에 그대로 보이는 문장(원장 지시: 메모로 남길 것). */
function missMarker(count, today) {
  const left = MISS_LIMIT - count;
  return left > 0
    ? `[동기화] ${today} makeedu에서 확인 안 됨 ${count}/${MISS_LIMIT}회 — ${left}회 더 안 보이면 무효 처리`
    : `[동기화] ${today} makeedu에서 확인 안 됨 ${count}/${MISS_LIMIT}회`;
}

/** 무효 메모 — 무엇이 얼마짜리였는지 남긴다(되돌릴 때 근거가 된다). */
function voidMarker(inv, today, count) {
  const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;
  return `[동기화] ${today} makeedu에서 삭제 확인(${count}회 연속 미확인) — 무효 처리 (직전 ${inv.status} · 청구 ${won(inv.amount_total)} · 미수 ${won(outstanding(inv))})`;
}

/** notes 맨 앞 `[동기화]` 한 줄만 떼어낸다(사용자 메모는 보존). 남는 게 없으면 null. */
function stripMarker(notes) {
  const rest = String(notes || "").replace(MARKER_RE, "");
  return rest.trim() ? rest : null;
}

/** 마커를 새 것으로 갈아 끼운다(중복 누적 방지). */
function withMarker(marker, notes) {
  const rest = stripMarker(notes);
  return rest ? `${marker}\n${rest}` : marker;
}

/**
 * 재대조 대상 (학생,월) 고르기.
 *
 * @param invoices  [{ id, student_id, period, status, amount_total, amount_discount, amount_paid, notes }]
 * @param students  [{ id, status, changed_on }] — `changed_on`은 퇴원일(없으면 갱신일) `YYYY-MM-DD`
 * @param today     `YYYY-MM-DD`
 * @param windowFrom 매일 도는 동기화가 이미 보는 **가장 이른 청구월**(`YYYY-MM`). 그 이후는 대상이 아니다.
 */
function pickTargets({ invoices, students, today, windowFrom, statusDays = STATUS_CHANGE_DAYS, statusMonths = STATUS_CHANGE_MONTHS }) {
  const changedCutoff = new Date(`${today}T00:00:00Z`);
  changedCutoff.setUTCDate(changedCutoff.getUTCDate() - statusDays);
  const cutoffStr = changedCutoff.toISOString().slice(0, 10);

  // ② 축 — 최근에 퇴원·휴원으로 바뀐 학생(환불이 여기서 난다). 사람마다 **볼 달이 다르다**:
  //    바뀐 달과 그 직전 달(statusMonths). 6개월을 통째로 잡으면 완납 수백 건이 딸려 온다.
  const changed = new Map();
  for (const s of students || []) {
    if (!["withdrawn", "on_hold"].includes(String(s.status))) continue;
    if (!s.changed_on || String(s.changed_on).slice(0, 10) < cutoffStr) continue;
    const m = String(s.changed_on).slice(0, 7);
    changed.set(s.id, { to: m, from: shiftMonth(m, -(Math.max(1, statusMonths) - 1)) });
  }

  const picked = [];
  for (const inv of invoices || []) {
    if (String(inv.status) === "void") continue; // 이미 무효 — 다시 볼 것 없다
    const owed = outstanding(inv);
    // ① 장기미납 — 창 밖에 미수가 남아 있다.
    if (owed > 0 && inv.period < windowFrom) {
      picked.push({ ...inv, reason: "장기미납" });
      continue;
    }
    // ② 상태 변경 — 완납이어도 본다(환불). 단 창 밖 + **그 사람이 바뀐 달 언저리**로 좁힌다.
    const w = changed.get(inv.student_id);
    if (w && inv.period < windowFrom && inv.period >= w.from && inv.period <= w.to) {
      picked.push({ ...inv, reason: "상태변경" });
    }
  }

  const periods = picked.map((p) => p.period).sort();
  return {
    pairs: picked,
    from: periods[0] ?? null,
    to: periods[periods.length - 1] ?? null,
  };
}

/**
 * 대상 × 스크랩 결과 → 할 일.
 *
 * @param targets        pickTargets의 pairs
 * @param scrapedKeys    스크랩에 존재하는 `student_id|period` Set
 * @param coverage       { [period]: 0~1 } 그 달 스크랩 커버리지(대상 기준). 없으면 1로 본다.
 * @param unmatchedRatio 학생 매칭 실패 비율(0~1)
 * @param today          `YYYY-MM-DD`
 */
function planOutcomes({ targets, scrapedKeys, coverage = {}, unmatchedRatio = 0, today }) {
  const out = { upsert: [], bump: [], voidable: [], hold: [] };
  const distrust = unmatchedRatio > MAX_UNMATCHED_RATIO;
  for (const t of targets) {
    const key = `${t.student_id}|${t.period}`;
    if (scrapedKeys.has(key)) {
      // makeedu에 있다 — 금액을 그쪽에 맞추고, 미확인 기록은 지운다(self-healing).
      out.upsert.push({ ...t, clearMarker: parseMissCount(t.notes) > 0 });
      continue;
    }
    const cov = coverage[t.period] === undefined ? 1 : coverage[t.period];
    if (distrust || cov < COVERAGE_MIN) {
      out.hold.push({ ...t, why: distrust ? "매칭 실패율 높음" : `커버리지 ${Math.round(cov * 100)}%` });
      continue; // 관측을 못 믿는 실행 — **세지도 않는다**(안 본 것과 같다)
    }
    const count = parseMissCount(t.notes) + 1;
    if (count >= MISS_LIMIT) out.voidable.push({ ...t, count, marker: voidMarker(t, today, count) });
    else out.bump.push({ ...t, count, marker: missMarker(count, today) });
  }
  return out;
}

module.exports = {
  MISS_LIMIT,
  COVERAGE_MIN,
  MAX_UNMATCHED_RATIO,
  STATUS_CHANGE_DAYS,
  STATUS_CHANGE_MONTHS,
  shiftMonth,
  outstanding,
  parseMissCount,
  missMarker,
  voidMarker,
  stripMarker,
  withMarker,
  pickTargets,
  planOutcomes,
};
