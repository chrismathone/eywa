import "server-only";
import { reportError } from "@/lib/observability/report-error";
import type { ExploreModel, ExploreSector, SectorDef } from "../model";

/** 조회 하나의 결과 — 실패를 빈 값으로 바꾸지 않고 **실패했음**을 남긴다(조각이 `error` 상태로 선다). */
export type Settled<T> = { ok: true; value: T } | { ok: false };

export async function settle<T>(scope: string, run: PromiseLike<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await run };
  } catch (e) {
    reportError(e, { scope });
    return { ok: false };
  }
}

export type ExploreLoad =
  | { state: "ready"; model: ExploreModel }
  | { state: "notfound" }
  | { state: "forbidden"; reason: string };

export const forbidden = (reason: string): ExploreLoad => ({ state: "forbidden", reason });
export const NOT_FOUND: ExploreLoad = { state: "notfound" };

/** 조각 표의 한 줄(제목·그림·색)에 조회 결과를 얹는다. */
export function makeSector(def: SectorDef, patch: Partial<Omit<ExploreSector, "key" | "label" | "icon" | "tone">>): ExploreSector {
  return { key: def.key, label: def.label, icon: def.icon, tone: def.tone, summary: "", state: "ready", ...patch };
}

export const errorSector = (def: SectorDef): ExploreSector =>
  makeSector(def, { summary: "조회하지 못했습니다", state: "error", note: "잠시 뒤 다시 열어 주세요. 계속 그러면 데스크에 알려 주세요." });

export const deniedSector = (def: SectorDef): ExploreSector =>
  makeSector(def, { summary: "열람 권한 없음", state: "denied", note: "이 영역을 볼 권한이 없습니다." });

export const distinct = <T>(xs: readonly (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

export const won = (n: number) => n.toLocaleString("ko-KR");
