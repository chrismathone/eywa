import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";
import type { classOperatingPeriod } from "@/features/classes/class-period";

/**
 * 반 정보 '운영 기간' 카드 본문(원장 2026-09-18 *"반정보에서 이반의 시작날짜와 종강날짜를 볼 수 있게 할 것"*).
 *
 * 🔑 날짜는 반 수정의 **'운영 기간'** 그대로다(`classOperatingPeriod` — 폼 프리필과 같은 `commonPeriod`). 여기서 새로 계산하지 않는다.
 * 🔑 **아직 안 끝난** 종료일이 있으면 그 날이 지나 수강이 닫힌다(0274a cron) — 그 사실을 한 줄로 밝힌다(학생 줄의 '~ 9/21'이
 *    왜 생겼는지). 🔴 끝난 기간엔 안내를 안 한다 — 교시를 다 지워 생긴 마감 행도 '끝난 기간'으로 보이는데 SQL은 그 반을
 *    닫지 않는다(만든 날 > 종료일 규칙). 약속하지 않는 게 안전하다(재리뷰 2026-09-18).
 * ⚠️ 교시마다 날짜가 갈리면 하나를 지어내지 않고 "교시마다 다름"이라 적는다(폼이 칸을 비우는 규칙과 같다).
 * 서버 컴포넌트(훅 없음) — 언어는 페이지가 넘긴다.
 */
export function ClassPeriodView({
  period,
  lang,
}: {
  period: ReturnType<typeof classOperatingPeriod>;
  lang: SheetLang;
}) {
  if (!period) {
    return <p className="text-text-dim text-sm">{sheetT(lang, "cls.d.periodNone")}</p>;
  }
  const mixedFrom = period.mixed === "from" || period.mixed === "both";
  const mixedTo = period.mixed === "to" || period.mixed === "both";
  const from = period.validFrom ?? (mixedFrom ? sheetT(lang, "cls.d.periodMixed") : "—");
  const to = period.validTo ?? sheetT(lang, mixedTo ? "cls.d.periodMixed" : "cls.d.periodOpen");
  return (
    <div className="space-y-1.5">
      <p className="text-foreground flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className="num">{from}</span>
        <span className="text-text-dim">~</span>
        <span className={period.validTo ? "num" : "text-text-dim font-medium"}>{to}</span>
        {period.ended ? (
          <span className="text-muted-foreground bg-muted border-border inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
            {sheetT(lang, "cls.d.periodEnded")}
          </span>
        ) : null}
      </p>
      {period.validTo && !period.ended ? (
        <p className="text-text-dim text-xs">{sheetT(lang, "cls.d.periodEndsHint")}</p>
      ) : null}
    </div>
  );
}
