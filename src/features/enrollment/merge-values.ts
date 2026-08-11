// 등록상담 병합 — **값을 어떻게 볼 것인가**(빈칸·같음·전화·이름·날짜)를 모은 순수 유틸.
// 여기 규칙이 곧 "무엇을 충돌로 볼지"라서, 판정이 바뀌면 화면이 묻는 질문 수가 통째로 달라진다.
import { ATOMIC_SETS, APPEND_COLUMNS, PHONE_COLUMNS, PLACEHOLDER_VALUES, SCALAR_COLUMNS } from "./merge-policy";
import { outcomePill } from "./outcome-meta";
import type { ConsultRow } from "./merge-types";

/** 선택지 미리보기 — 전사처럼 긴 값이 그대로 실려 화면·네트워크를 덮지 않게 자른다. */
export const previewOf = (v: unknown): string => {
  if (v === null || v === undefined) return "(빈칸)";
  if (typeof v === "boolean") return v ? "예" : "아니오";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  const flat = s.replace(/\s+/g, " ").trim();
  if (!flat) return "(빈칸)";
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
};

/**
 * 사람에게 보일 때 쓰는 표기 — 🔴 `consulted`·`enrolled` 같은 **영문 enum을 화면에 그대로 내보내지 않는다**
 * (프로젝트 전역 규칙). 라벨은 [outcome-meta](./outcome-meta.ts) 단일 소스에서 가져온다.
 */
export const humanize = (column: string, v: unknown): string =>
  column === "outcome" && typeof v === "string" ? outcomePill(v).label : previewOf(v);

export const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && (v.trim() === "" || PLACEHOLDER_VALUES.includes(v.trim()))) ||
  (Array.isArray(v) && v.length === 0);

/** 전화번호로 읽을 수 있는 값인가 — 숫자가 8자리 이상 있어야 번호다(암호문·이름 배제). */
export const looksLikePhone = (v: unknown): boolean => {
  const s = String(v ?? "");
  if (!/^[-0-9+ ()._]+$/.test(s.trim())) return false;
  return s.replace(/\D/g, "").length >= 8;
};

/** 쉼표·공백으로 나열된 이름 집합 — 어순 무시 비교용. */
export const nameSet = (v: unknown): Set<string> =>
  new Set(
    String(v ?? "")
      .split(/[,、·/]|\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const isSubset = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));

/**
 * 상담 메모 본문에 상담사가 손으로 적어 둔 날짜(`◆24/1/11`) — 옛 시트 관행이다.
 * `consulted_at`은 이관 과정에서 **탭(월) 기준**으로 뭉개진 경우가 있어, 실제로 언제 상담했는지는
 * 이쪽이 더 정확하다(실측: 메모 있는 427행 중 330행에 이 표기가 있다).
 */
export function memoDates(text: unknown): Set<string> {
  const out = new Set<string>();
  const re = /◆\s*(\d{2})\/(\d{1,2})\/(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? ""))) !== null) {
    out.add(`20${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
  }
  return out;
}

export const timeOf = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
};

/** 전화 정규화 — 하이픈·공백·괄호·국가번호 차이는 충돌이 아니다. */
export const normalizePhone = (v: unknown): string =>
  String(v ?? "")
    .replace(/\D/g, "")
    .replace(/^82(?=1|2|3|4|5|6|7)/, "0");

/** 값 동일성 — jsonb·Date까지 안정적으로 비교(키 순서가 다른 객체는 다른 값으로 본다: 안전한 쪽). */
export const sameValue = (a: unknown, b: unknown, column?: string): boolean => {
  if (a === b) return true;
  if (isEmpty(a) && isEmpty(b)) return true;
  if (column && (PHONE_COLUMNS as readonly string[]).includes(column)) {
    const na = normalizePhone(a);
    const nb = normalizePhone(b);
    if (na && nb) return na === nb;
  }
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (a instanceof Date || b instanceof Date) return ta !== null && tb !== null && ta === tb;
  if (typeof a === "object" && typeof b === "object" && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return String(a).trim() === String(b).trim();
};

export const dayOf = (v: unknown): number | null => {
  const t = timeOf(v);
  return t === null ? null : Math.floor(t / 86_400_000);
};

export const distinctBy = (values: unknown[], column?: string): unknown[] =>
  values.filter((v, i) => values.findIndex((o) => sameValue(o, v, column)) === i);

/** 그 행이 실제로 채운 필드 수 — '알찬 행' 판정. */
export function filledCount(row: ConsultRow): number {
  // ⚠️ boolean false는 "안 채운 것"으로 센다 — 기본값 false가 모든 행에 똑같이 더해지면
  //    '알찬 행' 판정이 그만큼 둔해진다(동의 3개가 전 행에 +3).
  return [...SCALAR_COLUMNS, ...APPEND_COLUMNS, ...Object.values(ATOMIC_SETS).flat()].filter(
    (c) => row[c] !== false && !isEmpty(row[c]),
  ).length;
}

/** 세트가 살아 있나 — 세트 안에 값이 하나라도 있으면 그 행이 그 사건을 갖고 있다. */
export const hasAtomic = (row: ConsultRow, set: readonly string[]): boolean =>
  set.some((c) => {
    const v = row[c];
    // boolean false·기본 enum은 "있음"으로 치지 않는다(from_public_intake=false는 QR 접수가 아니다).
    if (typeof v === "boolean") return v;
    if (c === "processing_status") return v !== "idle" && !isEmpty(v);
    return !isEmpty(v);
  });
