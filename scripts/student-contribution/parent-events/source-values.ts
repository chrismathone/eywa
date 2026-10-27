import { createHash } from "node:crypto";
import { phoneKeyOf } from "../../../src/features/enrollment/same-person";
import { validEventDate } from "../../../src/features/student-contribution/model/parent-events/attendance";
import { guardianNameKey } from "../../../src/features/student-contribution/model/parent-events/family";
export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const cell = (row: unknown[], index: number | undefined) => index === undefined ? "" : String(row[index] ?? "").trim();
export const childName = (s: string) => /^[가-힣]{2,5}[a-zA-Z]{0,2}$/.test(s.trim()) && !/재원생|비재원|없음|확인|어머니|아버지/.test(s) ? s.trim() : "";
export const childFromGuardian = (s: string) => /^([가-힣]{2,5}[a-zA-Z]{0,2})\s*(?:어머님|어머니|아버님|아버지|엄마|맘)$/.exec(s.trim())?.[1] ?? "";
export function contact(s: string) {
  // A numeric phone-only spreadsheet cell may lose its initial zero. Never repair partial/narrative values.
  const input = /^10\d{8}$/.test(s.trim()) ? `0${s.trim()}` : s;
  const tokens = input.match(/(?<!\d)(?:\+82[ .-]{0,3}10|010)[ .-]{0,3}\d{4}[ .-]{0,3}\d{4}(?!\d)/g) ?? [];
  const phones = [...new Set(tokens.map(phoneKeyOf).filter((p): p is string => !!p))].sort();
  let rest = input;
  for (const t of tokens) rest = rest.replace(t, "");
  rest = rest.replace(/^[\s/,:.]+|[\s/,:.]+$/g, "");
  const guardian = guardianNameKey(rest) ? rest : "";
  return { phones, guardian, invalid: !!s && (!phones.length && !guardian || /(?:01[016789]|\+82)[ .-]*\d|\d[ .-]*\d[ .-]*\d/.test(rest)) };
}
export function grade(s: string, school = "") {
  const v = s.replace(/\s+/g, "").replace(/초등학교|초등/, "초").replace(/중학교|중등/, "중").replace(/고등학교|고등/, "고").replace(/학년$/, "");
  if (/^(예비)?(초[1-6]|[중고][1-3])$/.test(v)) return v;
  const level = /([초중고])(?:등학교|학교)?$/.exec(school)?.[1];
  return level && /^[1-6]$/.test(v) ? `${level}${v}` : "";
}
export function schoolGrade(s: string) {
  const m = /^(.+?[초중고])(?:등학교|학교)?\s*([1-6])(?:학년)?$/.exec(s.trim());
  return m ? { school: m[1]!, grade: grade(`${m[1]!.slice(-1)}${m[2]}`) } : { school: "", grade: "" };
}
export function childDetail(s: string) {
  const m = /^([가-힣]{2,5}[a-zA-Z]{0,2})(?:\s+|\s*[/.(]\s*)([^()]+?)(?:\)|$)/.exec(s.trim());
  const detail = m ? schoolGrade(m[2]!.replace(/\s*[/]\s*/g, "")) : { school: "", grade: "" };
  // Multiple children / narrative text must be reviewed, not silently truncated to the first name.
  if (/동생|형제|자매|남매|언니|누나|오빠|[,\n]/.test(s)) return { name: "", school: "", grade: "", invalid: true };
  const name = m && detail.school ? childName(m[1]!) : childName(s);
  return { name, ...detail, invalid: !!s && !name };
}
export function explicitDate(s: string, year?: number) {
  if (/[~～–]|부터|까지/.test(s)) return "";
  const tokens = [...s.matchAll(/(?<!\d)(?:(20\d{2}|2[0-9])(?:년\s*|[./-]\s*))?(\d{1,2})(?:월\s*|[./-]\s*)(\d{1,2})(?:일)?/g)];
  const values = [...new Set(tokens.map(m => {
    const y = m[1] ? Number(m[1]) + (m[1].length === 2 ? 2000 : 0) : year;
    return y ? `${y}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : "";
  }).filter(Boolean))];
  return values.length === 1 && validEventDate(values[0]!) && !/\d{1,2}일?\s*[/,]\s*\d{1,2}일/.test(s) ? values[0]! : "";
}
export function column(n: number) { let s = ""; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
