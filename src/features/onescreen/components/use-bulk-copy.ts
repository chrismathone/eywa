"use client";

import { toast } from "sonner";
import { withWriteOrigin } from "../write-timing-store";
import { orderReportRows } from "../report-row-order";
import { logOnescreenBulkApply } from "../server/bulk-log-actions";
import { CLASS_TAG_ALL } from "../class-tags";
import { buildGridRows, effectiveClassnoteStatus, isCopyTargetRow, planCopyFirstRow, rowClassName, rowInClass } from "../grid";
import type { BulkI18n, BulkRowSetters, BulkView, LiveClassnoteStatus } from "./bulk-ops-types";

/** 맨 위 행 복사(표) — 수정 계획 P3-O(batch C), `use-bulk-ops.ts`에서 나눔(본문 그대로). */
export function useBulkCopy({
  view: { visible, activeClassFilter, classTags, displaySettings },
  activeDate,
  i18n: { t, tf },
  setters: { setProgressFor, setProgressModeFor, setTextbookFor, setHomeworkTodayFor },
  liveClassnoteStatus,
  readonlyBlocked,
}: {
  view: BulkView;
  activeDate: string;
  i18n: BulkI18n;
  setters: Pick<BulkRowSetters, "setProgressFor" | "setProgressModeFor" | "setTextbookFor" | "setHomeworkTodayFor">;
  liveClassnoteStatus: LiveClassnoteStatus;
  readonlyBlocked: () => boolean;
}) {
  /**
   * 맨 위 행의 **수업 내용**(진도·교재·오늘 과제)을 아래 행 전부에 복사.
   * 대상 = 선택 행이 있으면 그 행들, 없으면 표시 전체(반 필터 반영) — 다른 일괄 작업과 같은 규약.
   * ⚠️ 점수·태도·과제 수행·학부모 문구는 **복사하지 않는다**(학생마다 다른 개별 사실 — grid.ts 주석 참조).
   */
  function copyFirstRowDown(keys: string[], overwrite: boolean) {
    return withWriteOrigin("bulk", () => copyFirstRowDownInner(keys, overwrite));
  }
  function copyFirstRowDownInner(keys: string[], overwrite: boolean) {
    if (readonlyBlocked()) return; // #103 세 뒷문 중 하나 — 잠긴 화면에 값을 밀어 넣는 경로
    const all = orderReportRows(buildGridRows(visible), displaySettings.options.sort, classTags.filter(tag => tag !== CLASS_TAG_ALL)).filter((r) => rowInClass(r.subject, activeClassFilter));
    const keySet = new Set(keys);
    const rows = keys.length ? all.filter((r) => keySet.has(r.key)) : all;
    const [first, ...rest] = rows;
    if (!first || rest.length === 0) {
      toast.message(t("os.c.copyNoRow"));
      return;
    }
    // 같은 반 판정의 열쇠 = 반 필터와 같은 반 이름(보강 행은 앵커 반). 반을 고른 보기에선 보이는 행이 전부 그 반이라
    // 모르는 행도 그 반으로 본다(종전과 같다) — '전체' 보기에서만 반이 다르거나 모르는 행을 건너뛴다.
    const classKeyOf = (r: (typeof rows)[number]) => rowClassName(r.subject) ?? activeClassFilter;
    const res = planCopyFirstRow(
      {
        subjectKey: first.subject.subjectKey ?? "math",
        // 같은 반 행에만 복사한다(원장 2026-10-15 — '전체' 보기에서 다른 반 빈 칸까지 채우던 것).
        classKey: classKeyOf(first),
        today: first.subject.today ?? "",
        progressMode: first.subject.progressMode ?? null,
        textbook: first.subject.textbook ?? "",
        homeworkToday: first.subject.homeworkToday ?? "",
      },
      rest.map((r) => ({
        studentId: r.student.id,
        subjectName: r.subject.name,
        subjectIndex: r.subjectIndex,
        subjectKey: r.subject.subjectKey ?? "math",
        classKey: classKeyOf(r),
        today: r.subject.today ?? "",
        progressMode: r.subject.progressMode ?? null,
        textbook: r.subject.textbook ?? "",
        homeworkToday: r.subject.homeworkToday ?? "",
        // 🔴 여기서 `isRowActionable(…,"save")`를 쓰면 안 된다(2026-07-23 원장 제보로 발견).
        //    그 판정은 **진도가 있어야 통과**(isReportEligible)라, 복사가 필요한 바로 그 행
        //    (진도가 빈 행)을 전부 대상에서 빼 버려 기능이 사실상 항상 0건이었다.
        //    게다가 제외 사유를 전부 "발송 완료"로 세어, 보고서가 한 건도 없는 반에서도
        //    "복사할 칸이 없습니다 — 발송 완료 6행"이라는 **거짓 문구**가 떴다.
        //    복사가 실제로 막혀야 하는 유일한 조건은 **이미 학부모에게 나간 행**이다.
        //    (세션 중 방금 보낸 건은 로스터 스냅샷이 모르므로 live 상태를 덮어 읽는다.)
        actionable: isCopyTargetRow(
          r.subject,
          effectiveClassnoteStatus(liveClassnoteStatus(r.student.id, r.subject.name), r.subject.classnoteStatus),
        ),
      })),
      { overwrite },
    );
    if (res.plan.length === 0) {
      // 왜 아무 일도 안 일어났는지 말해준다 — "눌렀는데 무반응"이 되지 않게.
      const why = [
        // ⚠️ 이 카운터엔 결석 행(2026-08-07)과 '수업보고서 미발송' 반 행(2026-08-19)도 들어온다 —
        //    사유를 하나로 단정하면 거짓말이 된다. 판정 자체가 `isRowInputEditable`(입력 잠김)이라
        //    **잠김**이 셋 다 참인 유일한 이름이다.
        res.skippedSent ? tf("os.c.copyWhyLocked", { n: res.skippedSent }) : "",
        res.skippedSubject ? tf("os.c.copyWhySubject", { n: res.skippedSubject }) : "",
        res.skippedClass ? tf("os.c.copyWhyClass", { n: res.skippedClass }) : "",
        res.skippedNoClass ? tf("os.c.copyWhyNoClass", { n: res.skippedNoClass }) : "",
        res.skippedFilled ? tf("os.c.copyWhyFilled", { n: res.skippedFilled }) : "",
      ].filter(Boolean);
      toast.message(
        why.length ? tf("os.c.copyNoneWhy", { why: why.join(" · ") }) : t("os.c.copyNeedFirst"),
      );
      return;
    }
    for (const p of res.plan) {
      if (p.set.today !== undefined) setProgressFor(p.studentId, p.subjectIndex, p.set.today);
      // 복습·문제풀이도 진도와 함께(원장 2026-10-27) — 진도 문장이 이 값으로 갈린다.
      if (p.set.progressMode !== undefined) setProgressModeFor(p.studentId, p.subjectIndex, p.set.progressMode);
      if (p.set.textbook !== undefined) setTextbookFor(p.studentId, p.subjectName, p.set.textbook);
      if (p.set.homeworkToday !== undefined) setHomeworkTodayFor(p.studentId, p.subjectName, p.set.homeworkToday);
    }
    // 감사로그 한 줄(칸 저장은 건마다 남기지 않는다 — bulk-log-actions.ts). 글 내용은 안 싣는다.
    void logOnescreenBulkApply({
      mode: "copy",
      date: activeDate,
      rows: res.plan.length,
      // 보강 행은 반 대신 앵커 반(보강을 넣은 수업)으로 적는다.
      classIds: [first, ...rest.filter((r) => res.plan.some((p) => p.studentId === r.student.id && p.subjectName === r.subject.name))]
        .map((r) => r.subject.classId ?? r.subject.makeupClassId ?? null),
      fields: [...new Set(res.plan.flatMap((p) => Object.keys(p.set)))],
    }).catch(() => {});
    const skipped = res.skippedSent + res.skippedSubject + res.skippedClass + res.skippedNoClass + res.skippedFilled;
    toast.success(
      tf("os.c.copyDone", { name: first.student.name, n: res.plan.length }) +
        (skipped
          ? tf("os.c.copySkipped", {
              n: skipped,
              why: [
                res.skippedSent ? tf("os.c.copySkipLocked", { n: res.skippedSent }) : "",
                res.skippedSubject ? tf("os.c.copySkipSubject", { n: res.skippedSubject }) : "",
                res.skippedClass ? tf("os.c.copySkipClass", { n: res.skippedClass }) : "",
                res.skippedNoClass ? tf("os.c.copySkipNoClass", { n: res.skippedNoClass }) : "",
                res.skippedFilled ? tf("os.c.copySkipFilled", { n: res.skippedFilled }) : "",
              ]
                .filter(Boolean)
                .join(", "),
            })
          : ""),
    );
  }
  return { copyFirstRowDown };
}
