import { phoneLabel } from "@/lib/format/phone";

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
 * 전화번호 다듬기 — 앱 공용 하이픈 표기(`phoneLabel`)와 같은 규칙.
 * 모양을 모르는 길이·다른 글자가 섞인 입력은 **그대로** 돌려준다.
 */
export function formatPhone(raw: string): string {
  return phoneLabel(raw) ?? raw.trim();
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

/** 업체 한 곳의 저장 값(화면 키 이름). DB 컬럼은 서버 액션이 옮긴다. */
export type VendorValues = {
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

/**
 * 칸 목록 · 라벨 · 길이 상한 — 등록 창과 엑셀 서식이 **같은 표**를 읽는다(상한은 0448a 제약과 같다).
 * 순서 = 엑셀 열 순서 = 화면 표 열 순서(이메일은 화면 표에 없다).
 */
export const VENDOR_FIELDS: ReadonlyArray<{ key: keyof VendorValues; label: string; max: number }> = [
  { key: "name", label: "업체명", max: 80 },
  { key: "category", label: "분류", max: 40 },
  { key: "phone", label: "대표전화", max: 40 },
  { key: "contactName", label: "담당자", max: 40 },
  { key: "contactPhone", label: "담당자 연락처", max: 40 },
  { key: "address", label: "주소", max: 200 },
  { key: "bizNo", label: "사업자등록번호", max: 20 },
  { key: "email", label: "이메일", max: 120 },
  { key: "note", label: "비고", max: 500 },
];

/**
 * 입력 다듬기 — 양끝 공백 제거 · 빈 칸 null · 번호 하이픈(`formatPhone`/`formatBizNo`) · 업체명 필수 · 길이 상한.
 * 상한은 **다듬은 뒤**에도 본다(하이픈이 붙어 늘어날 수 있다).
 */
export function tidyVendor(raw: Readonly<Record<keyof VendorValues, unknown>>): VendorValues | { error: string } {
  const out = {} as Record<keyof VendorValues, string | null>;
  for (const f of VENDOR_FIELDS) {
    const s = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : "";
    if (s.length > f.max) return { error: `${f.label}은(는) ${f.max}자까지입니다` };
    out[f.key] = s || null;
  }
  if (!out.name) return { error: "업체명을 입력해 주세요" };
  if (out.phone) out.phone = formatPhone(out.phone);
  if (out.contactPhone) out.contactPhone = formatPhone(out.contactPhone);
  if (out.bizNo) out.bizNo = formatBizNo(out.bizNo);
  for (const f of VENDOR_FIELDS) {
    const v = out[f.key];
    if (v && v.length > f.max) return { error: `${f.label}은(는) ${f.max}자까지입니다` };
  }
  return out as VendorValues;
}

/** 화면 키 → `inventory_vendors` 컬럼 이름. */
export const VENDOR_COLUMN = {
  name: "name", category: "category", phone: "phone", contactName: "contact_name", contactPhone: "contact_phone",
  email: "email", address: "address", bizNo: "biz_no", note: "note",
} as const satisfies Record<keyof VendorValues, string>;

/** 저장 값 → `inventory_vendors` 컬럼(등록 창·엑셀이 같은 옮김을 쓴다). `only`를 주면 그 칸만 싣는다. */
export function vendorColumns(v: VendorValues, only?: ReadonlySet<keyof VendorValues>) {
  const out = {} as { -readonly [K in keyof VendorValues as (typeof VENDOR_COLUMN)[K]]: VendorValues[K] };
  for (const k of Object.keys(VENDOR_COLUMN) as (keyof VendorValues)[]) {
    if (!only || only.has(k)) (out as Record<string, string | null>)[VENDOR_COLUMN[k]] = v[k];
  }
  return out;
}
