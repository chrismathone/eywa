import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import type { InstrumentExtras, MonthValues } from "./extras-types";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import type { MenuKey } from "@/lib/permissions";
import type { WorkBoard } from "@/features/work-requests/model";

/** 표 한 줄. `subject`·`level`이 있으면 상세의 과목·학교급 탭이 이 값으로 줄을 거른다(비율로 나눈 값은 쓰지 않는다). */
/** `state` = now 지금·오늘 강조 · muted 끝나서 흐리게 · struck 취소(줄 긋고 흐리게). */
/** `id`·`parent`·`depth` = 펼치는 줄(담임 → 반 → 학생). */
export type DetailRow = { cells: string[]; href?: string; linkTitle?: string; subject?: string[]; level?: string; state?: "now" | "muted" | "struck"; id?: string; parent?: string; depth?: number };
/**
 * `unit` = 줄을 셀 때의 단위(기본 건). 탭을 고르면 위 수치가 이 표의 줄 수로 바뀐다.
 * `aside` = 위 수치에 들지 않는 표(그 달에 마지막 수업을 했지만 앞 달로 센 퇴원 등) — 과목·학교급 탭과 탭 수치의 재료가 아니고, 거른 뒤 줄이 없으면 숨는다.
 * `titleFor` = 제목에 줄 수가 들어가는 표 — 탭으로 거르면 거른 줄 수로 다시 짓는다(제목 옆 수는 따로 적지 않는다).
 */
export type DetailTable = { title: string; cols: string[]; rows: DetailRow[]; unit?: string; note?: string; aside?: boolean; titleFor?: (count: number) => string };
export type DetailSeries = { name: string; values: (number | null)[]; tone: string; stroke?: string };
export type DetailTrend = { title: string; labels: string[]; series: DetailSeries[]; unit?: string; money?: boolean; kind?: "line" | "bar"; noRange?: boolean; note?: string; lineOnly?: boolean; zero?: boolean };
export type Detail = {
  title: string;
  period: string;
  stats: [string, string][];
  trend?: DetailTrend;
  tables: DetailTable[];
  /** 과목 탭을 고르면 바뀌는 값. 라벨이 키다. `tables`가 있으면 표도 통째로 바뀐다. */
  bySubject?: Record<string, DetailSlice>;
  /** 과목 탭의 '비교' — 과목을 한 그래프·한 표에 함께 놓는다. */
  compare?: DetailSlice;
  /** 학교급 탭을 고르면 바뀌는 수치. 라벨이 키다. */
  byLevel?: Record<string, [string, string][]>;
  /** 상세 맨 아래에 늘 보이는 기준 문장 — 표가 비거나 탭으로 숨어도 남는다(퇴원을 어느 달로 세는지 등). */
  notes?: string[];
  link?: { href: string; label: string };
};
export type DetailSlice = { stats?: [string, string][]; trend?: DetailTrend; tables?: DetailTable[]; byLevel?: Record<string, [string, string][]> };
export type Details = Record<string, Detail>;

export type DetailContext = {
  snapshot: OverviewSnapshot;
  extras: InstrumentExtras;
  can: (menu: MenuKey) => boolean;
  subjects: readonly ProgramSubject[];
  eieOn: boolean;
  /** 이번 달 수납 카드가 금액을 그리는가(운영실 `monthAmounts`). */
  amounts: boolean;
  /** 업무 흐름(업무 요청) — 사람 상세가 맡은 업무 요청을 함께 적는다. 없으면 업무 요청 몫 없이. */
  work?: WorkBoard | null;
};

export type { MonthValues };

/** 학교·학년 표기(경명여중1) → 학교급. 못 읽으면 탭에 안 든다. */
export function levelOfSchoolGrade(text: string | null | undefined): string | undefined {
  const m = /([초중고])\s*\d*$/.exec(text?.trim() ?? "");
  return m ? { 초: "초등", 중: "중등", 고: "고등" }[m[1] as "초" | "중" | "고"] : undefined;
}

/** 표시 규칙의 빈 값. */
export const dash = (text: string | null | undefined) => text?.trim() || "—";
