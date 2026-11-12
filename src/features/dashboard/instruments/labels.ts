
import { programLabel, programOf, subjectGroupOf, type Program, type ProgramSubject } from "@/features/students/enrollment/program";

export const num = (n: number) => n.toLocaleString("ko-KR");
export const yyMm = (month: string) => `${month.slice(2, 4)}.${month.slice(5, 7)}`;
export const monthNo = (month: string) => Number(month.slice(5, 7));
/** YYYY-MM-DD → 11/2. */
export const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const hhmm = (time: string | null | undefined) => time?.slice(0, 5) ?? "";

export function moneyText(n: number): string {
  const a = Math.abs(n);
  const [scale, unit] = a >= 1e8 ? ([1e8, "억"] as const) : a >= 1e4 ? ([1e4, "만"] as const) : ([1, "원"] as const);
  return `${(n / scale).toLocaleString("ko-KR", { maximumFractionDigits: unit === "억" ? 2 : 0 })}${unit}`;
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** 강좌 칸의 과목 키(`courseGroupOf` — eie·injaewon·math·그 밖의 과목 키) → 이름. */
export function courseLabel(key: string, labels: Readonly<Record<string, string>>, subjects: readonly ProgramSubject[], eieOn: boolean): string {
  if (key === "eie" || key === "injaewon" || key === "math") return programLabel(key as Program, subjects, eieOn);
  return labels[key] ?? "기타 과목";
}

/** 수강 한 줄 → 과목 탭 키. 영어는 반의 프로그램 구분(`english_track`)으로 가른다 — 강좌수 칸과 같은 판정. */
export function programKeyOf(subject: string | null | undefined, englishTrack: string | null | undefined, subjects: readonly ProgramSubject[], splitEnglish: boolean): string | null {
  const group = subjectGroupOf(subject, subjects);
  if (group !== "english" || !splitEnglish) return group;
  return programOf({ subject: subject ?? "", englishTrack: englishTrack ?? null }, subjects) === "eie" ? "eie" : "injaewon";
}

/** 과목 색. 같은 과목은 어느 카드에서나 같은 색이다. */
const TONES: Readonly<Record<string, { tone: string; stroke?: string }>> = {
  eie: { tone: "m-char" },
  injaewon: { tone: "m-l2", stroke: "stroke-gray" },
  math: { tone: "m-yellow", stroke: "stroke-yellow" },
};
const REST = [
  { tone: "m-gray", stroke: "stroke-light" },
  { tone: "m-l1", stroke: "stroke-light" },
];
export function subjectStyle(key: string, index = 0) {
  return TONES[key] ?? REST[index % REST.length]!;
}
export const MIX_TONES = ["m-char", "m-l2", "m-yellow"];
export const MIX_SERIES = ["영어만", "동시수강", "수학만"];
