import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { EDIT_CUTOFF_MINUTES, runStartTime } from "../parent-rides";
import type { RunStopKind } from "../types";

/**
 * 그 회차가 아직 **출발 10분 전**이 안 됐으면 안내 문구, 아니면 null(사용자 2026-09-30 "출발 10분전까지 출발 완료
 * 탑승 사인은 받지 않게 · 등하원 둘 다"). 관리자 계정이 미리 눌러 학부모 화면에 차가 오기도 전에 "탔어요"가 섰다.
 *
 * 쓰는 곳 = 셔틀 '오늘 등하원'의 **탑승 기록**(`recordBoarding`)과 **출발**(`startTrip`). 종료는 출발이 있어야 누르므로 함께 막힌다.
 * 🔑 오늘만 본다(지난 날짜 정정은 막지 않는다) · 시작 시각 = 학원 출발 칸(없으면 첫 시각, `runStartTime` — 학부모 수정
 *    마감과 같은 판정)이고 **모르면 막지 않는다**(시각 없는 회차를 영영 못 찍으면 더 나쁘다) · 조회가 실패해도 막지 않는다.
 * 🔴 되돌리기(`clearBoarding`·`reopenTrip`)엔 걸지 않는다 — 잘못 찍은 것을 못 지우면 막다른 길이다([[#103]]).
 * ⚡ 폰에서 학생마다 누르는 가장 잦은 경로라 호출부는 **원래 하던 조회와 함께**(`Promise.all`) 돌린다 — 대기가 늘지 않는다.
 */
export async function runNotOpenMessage(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  runId: string,
  onDate: string,
): Promise<string | null> {
  if (onDate !== kstToday()) return null;
  const { data, error } = await admin.from("shuttle_run_stops").select("kind, at_time")
    .eq("tenant_id", tenantId).eq("run_id", runId).limit(200);
  if (error) return null;
  const start = runStartTime((data ?? []).map((s) => ({
    kind: (s.kind === "depart" || s.kind === "arrive" ? s.kind : "stop") as RunStopKind,
    time: s.at_time ? String(s.at_time).slice(0, 5) : null,
  })));
  if (!start) return null;
  const [h, m] = start.split(":").map(Number);
  const opensAt = (h ?? 0) * 60 + (m ?? 0) - EDIT_CUTOFF_MINUTES;
  if (kstMinutesOfDay() >= opensAt) return null;
  const hh = String(Math.floor(opensAt / 60)).padStart(2, "0");
  const mm = String(opensAt % 60).padStart(2, "0");
  return `이 회차는 ${start} 출발이라 ${hh}:${mm}(출발 ${EDIT_CUTOFF_MINUTES}분 전)부터 기록할 수 있습니다`;
}
