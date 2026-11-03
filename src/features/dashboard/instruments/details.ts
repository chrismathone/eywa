import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import type { InstrumentExtras } from "./extras-types";
import { kpiDetails } from "./details-kpi";
import { operationsDetails } from "./details-operations";
import { restDetails } from "./details-rest";
import { secretaryDetails } from "./secretary-details";
import type { DetailContext, Details } from "./details-types";

/** 카드·수치 칸을 눌렀을 때의 상세 전부. 값이 온 카드만 키가 있다. */
export function buildDetails(ctx: DetailContext): Details {
  return { ...kpiDetails(ctx), ...operationsDetails(ctx), ...restDetails(ctx), ...secretaryDetails(ctx) };
}

/**
 * 스냅샷에 없는 두 카드(운영실 기본 배치 밖)를 같은 자리에 끼운다. 스냅샷에 이미 값이 있으면 그 값을 쓴다.
 * `at`은 스냅샷 시각 — 추가 조회 값도 같은 화면의 값이다.
 */
export function withExtras(snapshot: OverviewSnapshot, extras: InstrumentExtras): OverviewSnapshot {
  const at = snapshot.requestedAt;
  const sections = { ...snapshot.sections };
  if (!sections.earlyExits && extras.earlyExits) sections.earlyExits = { data: extras.earlyExits, at, error: false };
  if (!sections.teacherWork && extras.teacherWork) sections.teacherWork = { data: extras.teacherWork, at, error: false };
  return { ...snapshot, sections };
}
