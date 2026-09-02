/**
 * scripts/_oneoff/inventory-import-rules.mjs — 시안 표(inventory-2026-07.json) → DB 행 **변환 규칙**(순수).
 *
 * 스크립트(`import-inventory.mjs`)와 Vitest(`src/features/inventory/inventory-wiring.test.ts`)가 **같은 파일**을
 * 읽는다 — 규칙이 두 벌이면 "테스트는 94인데 DB는 93"이 된다. 그래서 IO 없는 ESM으로 뽑아 뒀다.
 *
 * 변환 규칙(브리프 §7):
 *  - `미기재` · `모델확인필요` · `제조사 확인필요` · `—` → **null** (src/features/inventory/unknown-value.ts와 같은 표식)
 *  - 분류 한글 → 키, 상태 한글 → 키(status.ts·category.ts의 라벨 맵을 **거꾸로** 쓴 것 — 테스트가 역맵임을 잠근다)
 *  - `상시` → due_on = null + due_note = '상시'
 *  - 시트 화면 꼬리("7 / 7 행 표시")가 마지막 행의 비고/조치 칸에 딸려 들어온 **스크랩 잡음** → null
 *    (값을 고치는 게 아니라 원본에 없던 UI 문자열을 걷어내는 것 — 드라이런이 어느 행인지 보여준다)
 *  - 대여자·확인자 이름은 `users.display_name`과 **정확히 일치·유일**할 때만 `*_user_id`(호출부가 맵을 넘긴다)
 */

export const UNKNOWN_MARKERS = new Set(["미기재", "모델확인필요", "제조사 확인필요", "—", "-", ""]);
/** 시트 UI의 "N / N 행 표시" 꼬리 — 데이터가 아니다. */
export const SCRAPE_NOISE_RE = /^\d+\s*\/\s*\d+\s*행\s*표시$/;

export const CATEGORY_KEY = { 데스크탑: "desktop", 노트북: "laptop", 모니터: "monitor", 태블릿: "tablet", 프린터: "printer", TV: "tv", 기타: "etc" };
export const STATUS_KEY = { 사용중: "in_use", 대여중: "on_loan", 수리중: "repair", 분실: "lost", 확인필요: "check", 미등록: "unregistered", 폐기: "disposed" };
export const LOAN_STATUS_KEY = { 대여중: "out", 반납완료: "returned", 회수불가: "unreturnable", 확인필요: "check" };
export const AUDIT_RESULT_KEY = { 확인: "ok", 미확인: "missing", 보류: "hold" };

export function isScrapeNoise(v) {
  return typeof v === "string" && SCRAPE_NOISE_RE.test(v.trim());
}

/** 원본 문자열 → DB 텍스트(표식·잡음은 null, 아니면 trim). */
export function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (UNKNOWN_MARKERS.has(s) || isScrapeNoise(s)) return null;
  return s;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 원본 날짜 → date(형식이 아니면 null — '상시' 같은 문자열은 여기서 떨어진다). */
export function cleanDate(v) {
  const s = cleanText(v);
  return s && YMD.test(s) ? s : null;
}

function keyOf(map, label, what) {
  const s = cleanText(label);
  if (s === null) return null;
  if (!(s in map)) throw new Error(`${what} 라벨을 모릅니다: "${s}"`);
  return map[s];
}

/**
 * 자산 행. `users` = 이름 → user id (유일한 것만 담긴 맵). `sortOrder` = 시안 표 순서.
 * 반환의 `holderMatched`는 드라이런 보고용(계정 연결 여부).
 */
export function toAssetRow(src, sortOrder, users = new Map()) {
  const status = keyOf(STATUS_KEY, src.status, "상태");
  const category = keyOf(CATEGORY_KEY, src.category, "분류");
  if (!status || !category) throw new Error(`자산 ${src.assetId}: 상태·분류가 비어 있습니다`);
  const holderName = cleanText(src.user);
  const disposedOn = cleanDate(src.disposedOn);
  return {
    asset_code: String(src.assetId).trim().toUpperCase(),
    category,
    maker: cleanText(src.maker),
    model: cleanText(src.model),
    serial_no: null,
    acquired_on: cleanDate(src.acquiredOn),
    status,
    location: cleanText(src.location),
    holder_user_id: holderName ? (users.get(holderName) ?? null) : null,
    holder_name: holderName,
    last_audited_on: cleanDate(src.lastAuditedOn),
    // CHECK: 폐기일이 있으면 상태도 폐기 — 원본이 어긋나 있으면 폐기일을 버리지 않고 **에러로 세운다**(고치는 건 사람 몫).
    disposed_on: disposedOn,
    note: cleanText(src.note),
    sort_order: sortOrder,
    _check: disposedOn && status !== "disposed" ? `폐기일(${disposedOn})이 있는데 상태가 ${src.status}` : null,
  };
}

/** 대여 행. `assetIds` = asset_code → asset id. */
export function toLoanRow(src, assetIds, users = new Map()) {
  const code = String(src.assetId).trim().toUpperCase();
  const assetId = assetIds.get(code);
  if (!assetId) throw new Error(`대여 ${src.loanId}: 자산 ${code}가 없습니다`);
  const status = keyOf(LOAN_STATUS_KEY, src.status, "대여 상태");
  const borrower = cleanText(src.borrower);
  if (!status || !borrower) throw new Error(`대여 ${src.loanId}: 상태·대여자가 비어 있습니다`);
  const dueRaw = cleanText(src.dueOn);
  const dueOn = cleanDate(src.dueOn);
  return {
    asset_id: assetId,
    loan_code: String(src.loanId).trim(),
    borrower_user_id: users.get(borrower) ?? null,
    borrower_name: borrower,
    dept: cleanText(src.dept),
    lent_on: cleanDate(src.lentOn),
    due_on: dueOn,
    // '상시'처럼 날짜가 아닌 반납예정 표기 — 날짜 칸이 아니라 표기 칸에.
    due_note: dueOn ? null : dueRaw,
    returned_on: cleanDate(src.returnedOn),
    status,
    prev_status: null,
    note: cleanText(src.note),
  };
}

export function toAuditRow(src, assetIds, users = new Map()) {
  const code = String(src.assetId).trim().toUpperCase();
  const assetId = assetIds.get(code);
  if (!assetId) throw new Error(`실사 ${src.auditId}: 자산 ${code}가 없습니다`);
  const result = keyOf(AUDIT_RESULT_KEY, src.result, "실사 결과");
  const auditedOn = cleanDate(src.auditedOn);
  if (!result || !auditedOn) throw new Error(`실사 ${src.auditId}: 결과·실사일이 비어 있습니다`);
  const auditor = cleanText(src.auditor);
  return {
    asset_id: assetId,
    audit_code: String(src.auditId).trim(),
    audited_on: auditedOn,
    result,
    location: cleanText(src.location),
    auditor_user_id: auditor ? (users.get(auditor) ?? null) : null,
    auditor_name: auditor,
    action: cleanText(src.action),
    note: null,
  };
}

export function toSupplyRow(src, sortOrder) {
  const name = cleanText(src.name);
  if (!name) throw new Error(`소모품 ${src.itemId}: 품목명이 비어 있습니다`);
  const qty = Number(String(src.qty ?? "").trim());
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`소모품 ${src.itemId}: 수량 "${src.qty}"`);
  return {
    item_code: cleanText(src.itemId),
    name,
    maker_model: cleanText(src.makerModel),
    qty,
    location: cleanText(src.location),
    checked_on: cleanDate(src.checkedOn),
    checker_name: cleanText(src.checker),
    note: null,
    sort_order: sortOrder,
  };
}

/** 이름 → user id 맵. 동명이인은 **비운다**(이름으로 남의 계정에 붙이지 않는다). */
export function uniqueNameMap(rows) {
  const count = new Map();
  for (const r of rows) count.set(r.display_name, (count.get(r.display_name) ?? 0) + 1);
  const out = new Map();
  for (const r of rows) if (count.get(r.display_name) === 1) out.set(r.display_name, r.id);
  return out;
}
