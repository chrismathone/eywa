"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { REPORT_OPTOUT_LABEL } from "@/features/classes/report-optout";
import { needsReportOptoutConfirm } from "@/features/classes/report-optout-warning";
import { SEND_CLASS_SUBJECTS } from "@/features/onescreen/send-class";
import { ClassReportOptoutConfirm } from "./class-report-optout-confirm";

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
  initialReportOptout = false,
  recentSentReports,
  subject,
  classnoteOn = false,
}: {
  reportOptout: boolean;
  onReportOptoutChange: (next: boolean) => void;
  /** 화면을 열 때의 값 — 이미 미발송이던 반은 켜는 일이 아니라 경고하지 않는다. */
  initialReportOptout?: boolean;
  /** 최근 30일 ClassNote 발송 건수(편집 화면만) · undefined = 새 반(경고 없음) · null = 못 셌다(그래도 경고). */
  recentSentReports?: number | null;
  /** 폼의 지금 과목 키 — 수학(반 보드 발송 과목)이면 경고에 '반 보드 연결도 풀린다'를 붙인다. */
  subject?: string | null;
  /**
   * 이 지점이 ClassNote 모듈을 쓰나(`classnoteModuleOn` — 페이지가 넘긴다). 꺼진 지점엔 ClassNote 문장을 하나도 안 보인다
   * (꺼진 기능은 있었는지조차 모르게 · 리뷰 2026-11-04). 🔴 기본 false — 넘기기를 빠뜨려도 흔적이 새지 않는 쪽.
   */
  classnoteOn?: boolean;
}) {
  // 보내던 반을 미발송으로 켜는 순간 경고 + 확인 체크(2026-11-04 사고) — report-optout-warning.ts.
  const confirmNeeded = needsReportOptoutConfirm({
    initial: initialReportOptout,
    next: reportOptout,
    recentSent: recentSentReports,
  });
  // ClassNote 반 보드로 보고서를 보내는 반인가 — 모듈이 켜진 지점의 수학(math·subject_1 — 워커 대상 조건과 같은 값).
  const boardRoute = classnoteOn && SEND_CLASS_SUBJECTS.has(subject ?? "");
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
      {/* key = 경고 종류 — 과목을 바꿔 경고가 '반 보드 연결도 풀림'으로 무거워지면 상자를 새로 그려 확인 체크를 다시 받는다
          (비제어 체크박스라 같은 자리에선 체크가 남는다 · 리뷰 2026-11-04). */}
      {confirmNeeded ? (
        <ClassReportOptoutConfirm key={boardRoute ? "board" : "lock"} recentSent={recentSentReports ?? null} boardRoute={boardRoute} />
      ) : null}
      {/* ⚠️ 무엇이 바뀌고 무엇이 안 바뀌는지 정직하게 — 특강 토글의 한계 문구 선례(거짓 약속 금지).
          🔴 "출결은 그대로"라고 쓰면 **거짓말**이다: 수학 반 출석부는 수업보고서에서 파생되므로
             보고서를 안 쓰면 자동 표시도 함께 멈춘다. 숨기지 말고 그대로 말한다. */}
      <p className="text-muted-foreground text-xs break-keep">
        켜면 수업보고서 <span className="text-foreground">작성 화면의 반 목록</span>과{" "}
        <span className="text-foreground">작성률 집계</span>에서 빠지고, 미작성 알림도 오지 않습니다. 이미
        작성된 보고서와 시간표·급여는 그대로입니다.
      </p>
      {/* 🔴 '반 공지는 그대로'라고 쓰지 않는다 — 미발송 수학 반은 ClassNote 반 보드 대상이 아니라(11-04 되돌림) 연결이 풀리고,
          반 공지·개별 공지도 그 반 보드로는 나가지 않는다(리뷰 2026-11-04). */}
      <p className="border-amber/25 bg-amber-soft text-amber rounded-lg border px-3 py-2 text-xs break-keep">
        수학 반이면 <span className="font-semibold">출석부 자동 표시도 함께 꺼집니다</span> — 이 반 출결은
        보고서에서 자동으로 채워지고 있었기 때문입니다. 앞으로는 셀을 직접 클릭해 찍은 값만 쌓입니다(토글을
        다시 끄면 예전 표시가 그대로 돌아옵니다).
        {classnoteOn ? (
          <>
            {" "}
            <span className="font-semibold">ClassNote 반 보드 연결도</span> 다음 정기 동기화 때 풀려, 그 반 보드로 가는
            공지도 나가지 않습니다.
          </>
        ) : null}
      </p>
    </section>
  );
}
