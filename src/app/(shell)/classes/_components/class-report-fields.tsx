"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { REPORT_OPTOUT_LABEL } from "@/features/classes/report-optout";

/**
 * '수업보고서 미발송' 토글 — 반 생성/수정 폼의 한 섹션(0174a).
 *
 * 원장 2026-08-03: 랩실 수업처럼 보고서를 쓰지 않는 반은 보고서 화면의 반 목록에서 빠지고 작성률
 * 분모에서도 빠져야 한다("선생님이 헷갈릴 필요가 없게 · 괜히 작성률도 0%로 오해받지 않게").
 *
 * ⚠️ 특강 토글과 **같은 hidden("0") + 체크박스("1") 쌍 계약**이다 — 체크박스만 두면 해제 시 필드가
 *    통째로 사라져 서버가 "이 폼은 이 필드를 모른다"로 보고 **끄기가 저장되지 않는다**. 순서를 바꾸지
 *    말 것(뒤 값이 체크 상태). 초안 복원 시 hidden 마커를 "0"으로 되돌리는 처리도 class-form.tsx에 있다.
 */
export function ClassReportFields({
  reportOptout,
  onReportOptoutChange,
}: {
  reportOptout: boolean;
  onReportOptoutChange: (next: boolean) => void;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <header>
        <h3 className="text-foreground text-sm font-bold">수업보고서</h3>
        <p className="text-muted-foreground text-xs break-keep">
          랩실·자습처럼 수업보고서를 쓰지 않는 반은 보고서 화면에서 빼둘 수 있습니다.
        </p>
      </header>

      {/* hidden(0) + 체크박스(1) 쌍 — 순서를 바꾸지 말 것(위 주석의 서버 계약). */}
      <input type="hidden" name="reportOptout" value="0" />
      <label className="border-line bg-bg-soft/60 flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2">
        <input
          type="checkbox"
          name="reportOptout"
          value="1"
          checked={reportOptout}
          onChange={(e) => onReportOptoutChange(e.target.checked)}
          className="size-4 shrink-0"
        />
        <EyIcon name="clipboardList" size={14} className="text-text-dim shrink-0" />
        <span className="text-foreground text-sm font-medium">{REPORT_OPTOUT_LABEL}</span>
      </label>
      {/* ⚠️ 무엇이 바뀌고 무엇이 안 바뀌는지 정직하게 — 특강 토글의 한계 문구 선례(거짓 약속 금지).
          🔴 "출결은 그대로"라고 쓰면 **거짓말**이다: 수학 반 출석부는 수업보고서에서 파생되므로
             보고서를 안 쓰면 자동 표시도 함께 멈춘다. 숨기지 말고 그대로 말한다. */}
      <p className="text-muted-foreground text-xs break-keep">
        켜면 수업보고서 <span className="text-foreground">작성 화면의 반 목록</span>과{" "}
        <span className="text-foreground">작성률 집계</span>에서 빠지고, 미작성 알림도 오지 않습니다. 이미
        작성된 보고서와 시간표·급여·반 공지는 그대로입니다.
      </p>
      <p className="border-amber/25 bg-amber-soft text-amber rounded-lg border px-3 py-2 text-xs break-keep">
        수학 반이면 <span className="font-semibold">출석부 자동 표시도 함께 꺼집니다</span> — 이 반 출결은
        보고서에서 자동으로 채워지고 있었기 때문입니다. 앞으로는 셀을 직접 클릭해 찍은 값만 쌓입니다(토글을
        다시 끄면 예전 표시가 그대로 돌아옵니다).
      </p>
    </section>
  );
}
