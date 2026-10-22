/**
 * 업체리스트(거래처 연락처) — 순수 규칙. 화면 검색·분류 칩·저장 시 번호 다듬기가 같은 함수를 읽는다.
 *
 * 🔑 분류는 **데이터에서 나온다**(이미 적힌 분류들) — 서점·출판사 같은 목록을 코드에 적지 않는다.
 * 🔑 번호는 **숫자만 있는 입력만** 하이픈을 넣는다 — `내선 23`·`010-1234-5678(퇴근 후)`처럼 사람이 붙인
 *    글자가 있으면 그대로 둔다(고치려다 메모를 지우는 쪽이 더 나쁘다).
 */

type Searchable = {
  name: string;
  category: string | null;
  phone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  email: string | null;
  address: string | null;
  bizNo: string | null;
  note: string | null;
};

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * 검색 — 업체명·분류·담당자·주소·이메일·비고는 대소문자·공백 무시 부분 일치,
 * 번호(대표·담당자·사업자)는 **숫자만** 비교한다(`0533` 으로 `053-312-…`를 찾는다).
 */
export function matchesVendorQuery(row: Searchable, query: string): boolean {
  const q = squash(query.trim());
  if (!q) return true;
  const text = [row.name, row.category, row.contactName, row.email, row.address, row.note]
    .filter((v): v is string => !!v)
    .map(squash)
    .join(" ");
  if (text.includes(q)) return true;
  const qd = digits(q);
  // 숫자가 3자리 미만이면 번호 검색으로 보지 않는다(`1`이 거의 모든 번호에 걸린다).
  if (qd.length < 3 || qd.length !== q.replace(/[-.()]/g, "").length) return false;
  return [row.phone, row.contactPhone, row.bizNo].some((v) => !!v && digits(v).includes(qd));
}

/** 분류 칩 — 적힌 분류를 많이 쓰인 순(같으면 가나다)으로. 분류 없는 업체가 있으면 맨 뒤에 `미분류`. */
export const NO_CATEGORY = "__none__";

export function vendorCategoryChips(rows: ReadonlyArray<{ category: string | null }>): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  let none = 0;
  for (const r of rows) {
    const c = r.category?.trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    else none++;
  }
  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([c, n]) => ({ key: c, label: c, count: n }));
  if (none > 0 && chips.length > 0) chips.push({ key: NO_CATEGORY, label: "미분류", count: none });
  return chips;
}

export function matchesVendorCategory(row: { category: string | null }, key: string | null): boolean {
  if (!key) return true;
  const c = row.category?.trim() || null;
  return key === NO_CATEGORY ? c === null : c === key;
}

/**
 * 전화번호 다듬기 — 숫자(와 하이픈·공백·점·괄호)만 있으면 한국 번호 모양으로 하이픈을 넣는다.
 * 모양을 모르는 길이·다른 글자가 섞인 입력은 **그대로** 돌려준다.
 */
export function formatPhone(raw: string): string {
  const s = raw.trim();
  if (!/^[\d\s\-.()]+$/.test(s)) return s;
  const d = digits(s);
  if (/^02\d{7,8}$/.test(d)) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  if (/^0\d{2}\d{7,8}$/.test(d)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^1\d{7}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 1588-1234 같은 대표번호
  return s;
}

/** 사업자등록번호 — 숫자 10자리면 `000-00-00000`, 아니면 그대로. */
export function formatBizNo(raw: string): string {
  const s = raw.trim();
  const d = digits(s);
  if (/^[\d\s\-.]+$/.test(s) && d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return s;
}

/** `tel:` 링크용 — 숫자와 `+`만. 번호가 없거나 너무 짧으면 null(걸 수 없는 링크를 만들지 않는다). */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^\d+]/g, "");
  return d.replace(/\D/g, "").length >= 7 ? `tel:${d}` : null;
}
