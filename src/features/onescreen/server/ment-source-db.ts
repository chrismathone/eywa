// `lesson_reports.ment_source`(0214a) **적용 여부 probe** — 서버 전용 헬퍼.
//
// 왜 probe인가(#95 expand/contract): eywa는 SQL을 원장이 손으로 실행해 push와 적용 사이 간격이 항상
// 있다. ment_source를 select/upsert에 무조건 넣으면 그 간격 동안 **저장·목록이 통째로 죽는다**(0174a
// 실사고 — 강사 전원 원스크린 먹통). 그래서 컬럼 유무를 가벼운 select 1행으로 확인하고, 없으면 마커
// 기록·필터만 조용히 건너뛴다(본 저장·목록은 그대로). 반 필터 옵션의 fail-soft(0147a)와 같은 결.
//
// 캐시는 **양성만**(컬럼은 생기기만 하지 사라지지 않는다) — 적용 전엔 저장마다 1회 probe가 붙지만
// 적용 후 첫 성공부터 램다 인스턴스 수명 동안 왕복 0이다.
import type { createClient } from "@/lib/supabase/server";
import { isMentSourceMissingError } from "../ment-source";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

let columnKnownReady = false;

/**
 * ment_source 컬럼이 존재하는가 — 존재 확인 후엔 캐시(왕복 0). 실패는 false(마커만 생략, 본 저장 우선).
 *
 * ⚠️ 의도된 트레이드오프(적대 리뷰 인지): 컬럼 부재(42703)가 아닌 **일시 오류**(네트워크 등)로 false가
 * 나오면, 그 저장 한 건은 notes가 바뀌어도 기존 라벨이 남는다(stale — 예: manual 라벨 위에 AI 텍스트).
 * 반대로 unknown을 true로 취급하면 컬럼이 진짜 없을 때 **저장 자체가 400으로 죽는다**(0174a 실사고 방향,
 * 원스크린 전원 핫패스) — 라벨 한 건의 순도보다 저장 생존이 우선이라 false 쪽으로 접는다.
 * 대신 일시 오류는 아래 warn 로그로 드러낸다([[#89]] "폴백 있는 기능은 실패율을 따로 계측").
 */
export async function mentSourceColumnReady(supabase: ServerClient): Promise<boolean> {
  if (columnKnownReady) return true;
  const { error } = await supabase.from("lesson_reports").select("ment_source").limit(1);
  if (!error) {
    columnKnownReady = true;
    return true;
  }
  if (!isMentSourceMissingError(error.message)) {
    // 컬럼 부재(0214a 미적용 — 조용히 생략이 정상)와 달리, 일시 오류는 라벨 유실이 관측돼야 한다.
    console.warn(
      JSON.stringify({
        level: "warn",
        scope: "mentSourceColumnReady",
        reason: "probe_failed_transient",
        message: error.message,
      }),
    );
  }
  return false;
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetMentSourceProbeForTest(): void {
  columnKnownReady = false;
}
