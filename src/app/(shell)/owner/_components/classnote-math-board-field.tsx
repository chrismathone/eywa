"use client";

import { ClassnoteSyncNowButton } from "@/features/report-admin/components/classnote-sync-now-button";

/**
 * 보고서 설정 > 수학 반 보드 — 수학 보고서는 **반별 발송 하나뿐**이다.
 * 원장 2026-11-05 *"이제 안쓰는 기능들 정리하고 반 보드 동기화만 남기면 될듯"* — 예전 '수학 발송 경로' 세 갈래
 * (기존 방식 = `(수학)이름` 1인 보드 · 반별 발송 · 일부 선생님만 반별)는 걷었다. 1인 보드엔 원아를 배정하지 않으므로
 * (2026-11-04 원장 "앞으로 1인보드에 배정 시키지마 절대") 반별 말고는 보낼 곳이 없다. 남는 것 = 설명 + '지금 반 보드 동기화'.
 * 🔴 반별 발송은 **매칭 기록이 초록(C.N)인 학생만** 나간다 — 빨간 학생은 발송 실패로 멈추고 사유를 남긴다.
 */
export function ClassnoteMathBoardField() {
  return (
    <div className="border-line mt-3 border-t pt-3">
      <p className="text-foreground text-sm font-bold">수학 반 보드</p>
      <p className="text-text-dim mt-0.5 text-xs">
        수학 보고서는 aywa 반과 이름이 같은 ClassNote 반에서, 그 학생에게만 1:1로 보냅니다. 원스크린에서 <b>C.N이 초록</b>인
        학생만 나가고, 빨간 학생은 발송하지 않고 사유를 남깁니다.
      </p>
      {/* 지금 반 보드 동기화(0313a) — 새 반·신입이 새벽 동기화 전이라 '보낼 반 없음'일 때 바로 맞춘다.
          모듈이 꺼졌거나 권한·SQL·반 보드가 없으면 버튼이 스스로 아무것도 안 그린다. */}
      <ClassnoteSyncNowButton source="owner_report_route" className="mt-2" />
    </div>
  );
}
