"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { REPORT_NAME_MAX } from "@/features/onescreen/report-author-name";
// 강사 미니셸이면 화면 언어를 따른다 — 관리자 풀셸에는 provider가 없어 한국어 그대로다.
import { useSheetT } from "@/features/teacher-view/lang-context";
import { updateMyReportName, type MeAccountState } from "@/features/staff/server/me-actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

/**
 * 수업보고서 발송용 이름(0217a) — 학부모에게 나가는 수업보고서(ClassNote 게시 작성자명·공유 링크
 * '담임' 칸·인쇄본)에 실명 대신 표시할 이름을 본인이 정한다. 비우고 저장하면 실명으로 돌아간다.
 *
 * ⚠️ #83: `<form action>`은 제출마다(실패 응답 포함) 자동 리셋된다 — 0217a 미적용 에러에서 방금 친
 * 이름이 증발하면 안 되므로 **제어 입력 + onSubmit 직접 디스패치**(자동 리셋 무력화)로 제출한다.
 */
export function ReportNameCard({
  realName,
  initialName,
  mappingBlocked,
}: {
  realName: string;
  initialName: string | null;
  /** 이름은 저장돼 있는데 발송 매핑이 안 걸리는 상태(동명 직원 등) — 카드가 사실을 밝힌다([[#89]]). */
  mappingBlocked: boolean;
}) {
  const t = useSheetT();
  const [state, action, pending] = useActionState<MeAccountState, FormData>(updateMyReportName, undefined);
  const [name, setName] = useState(initialName ?? "");
  const seen = useRef<MeAccountState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? t("me.saved"));
  }, [state, t]);

  return (
    <section className="border-line bg-card rounded-2xl border p-5 shadow-card">
      <h2 className="text-foreground text-sm font-bold">{t("me.reportName")}</h2>
      <p className="text-text-dim mt-1 text-xs">
        {t("me.reportName.desc.a")}
        <b>{realName}</b>
        {t("me.reportName.desc.b")}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault(); // #83 자동 리셋 차단 — 에러가 돌아와도 입력이 남는다.
          const fd = new FormData();
          fd.set("reportName", name);
          startTransition(() => action(fd));
        }}
        className="mt-4"
      >
        <label htmlFor="me-report-name" className="micro mb-1 block">
          {t("me.reportName.label")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="me-report-name"
            name="reportName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={REPORT_NAME_MAX}
            // 예시에 실명("OO 선생님")을 섞지 않는다 — 원장 지시 2026-08-18 "하드 코딩된 이름 삭제".
            placeholder={t("me.reportName.ph")}
            autoComplete="off"
            className={`${inputClass} max-w-72 flex-1`}
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("me.save")}
          </Button>
        </div>
      </form>
      {mappingBlocked ? (
        <p className="mt-2 text-xs leading-snug text-amber-700">
          {t("me.reportName.blocked.a")} <b>{t("me.reportName.blocked.b")}</b>
          {t("me.reportName.blocked.c")}
        </p>
      ) : null}
      <p className="text-text-faint mt-1 text-xs">
        {t("me.reportName.note.a")} <b>{t("me.reportName.note.b")}</b>{" "}
        {t("me.reportName.note.c")}
      </p>
    </section>
  );
}
