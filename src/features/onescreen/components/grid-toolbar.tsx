"use client";

import { DisplaySettings } from "./display-settings";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AttachPicker } from "./grid-attach";
import { useClassnoteOn } from "./classnote-on-context";
import { useLicenseOn } from "@/features/owner/operations-context";
import { bulkPickLabel } from "../bulk-label";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { BulkAttendanceStatus } from "../bulk-attendance";
import type { BulkPatch } from "../grid";
import type { VideoHomeworkStatus } from "@/features/video-homework/types";

/** 표 일괄 작업 핸들러 — keys(선택 행) 있으면 그 행만, 없으면 전체. */
export type GridBulkActions = {
  onSaveAll: (keys?: string[]) => void;
  onSendAll: (keys?: string[]) => void;
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onClassNotice?: (keys?: string[]) => void; // 선택(없으면 표시 전체) 학생 학부모 공지 — 진도 무관
  // 값 일괄 적용(1-2) — 진도 필터 없는 raw 행 대상. progressSubjectKey = 진도를 넣을 과목(그 과목 행에만).
  // attendance = 함께 찍을 출결(null=적용 안 함). ⚠️ 다른 필드와 달리 **즉시 서버(출석부)에 기록**된다.
  onBulkApply: (
    keys: string[],
    patch: BulkPatch,
    onlyEmpty: boolean,
    progressSubjectKey: string,
    attendance: BulkAttendanceStatus | null,
    /** 출결 수업타임(시수) — 빈 문자열=미지정. 새로 만드는 출결 행에만 적용(기존 시수 보존). */
    attendanceUnits?: string,
    /** 지난 영상 숙제 검사(null=적용 안 함) — 출결처럼 **즉시 기록**된다(검사 칸이 있는 행만). */
    videoCheck?: VideoHomeworkStatus | null,
  ) => void;
  // 맨 위 행의 수업 내용(진도·교재·오늘 과제)을 아래 행에 복사 — 같은 진도를 학생마다 다시 고르지 않게.
  onCopyFirstRow?: (keys: string[], overwrite: boolean) => void;
  // 이전 회차 일괄 가져오기(G5 얕은판) — 선택(없으면 표시 전체) 행의 **빈 칸만** planPrevFill로 채움(특이사항·교재 제외).
  onBulkImportPrev?: (keys?: string[]) => void;
  // 이전 진도를 아직 안 불러온 보강 학생(원장 2026-10-27) — 보강 학생은 이전 회차를 따로 불러와야 '이전값 가져오기'가 채운다.
  makeupPrev?: { count: number; busy: boolean; onLoad: () => void };
  // 선택 행 일괄 첨부 — 같은 시험지·판서 사진을 여러 학생에게 한 번에. **선택이 있을 때만** 노출(전체 대상 오첨부 방지).
  onBulkAttach?: (keys: string[], files: File[]) => void;
};

/** 표 상단 일괄 바 — 카운트·이전 회차 토글·일괄 버튼. children = 버튼 그룹 선두 슬롯(값 일괄 입력 팝오버). */
export function GridToolbar({
  counts,
  selectedKeys,
  actions,
  bulkGen,
  locked,
  navHint,
  children,
  trailing,
}: {
  // sendable=진도+결석 제외(발송·자동작성 대상), saveable=진도만(저장 대상 — 결석 포함, 2-3 작업별 분리).
  counts: {
    total: number;
    students?: number;
    sendable: number;
    /** 실제로 발송되는 행 = sendable + 멘트 있음. 상단 숫자·발송 버튼은 **이 값**을 쓴다(행 라벨과 일치). */
    sendReady: number;
    saveable: number;
    selectedSendReady: number;
    selectedSaveable: number;
    // 자동작성 실대상 = 발송가능 − 이미 멘트가 있는 행(보존 대상). 버튼 라벨·비활성 판정에 그대로 쓴다.
    autoWritable: number;
    selectedAutoWritable: number;
  };
  selectedKeys: string[];
  actions: GridBulkActions;
  bulkGen?: boolean;
  locked?: boolean; // 순서 모드 중 — 선택이 ↑↓로 가려져 있어 일괄 액션 버튼을 잠근다(#24)
  navHint?: boolean; // 점수·교재 칸 Enter/↑↓ 세로 이동 힌트 노출(#21)
  children?: ReactNode;
  trailing?: ReactNode;
}) {
  const { total, sendable, sendReady, saveable, selectedSendReady, selectedSaveable, autoWritable, selectedAutoWritable } =
    counts;
  const genTarget = selectedKeys.length ? selectedAutoWritable : autoWritable; // 실제로 생성될 행 수
  const genPreserved = (selectedKeys.length ? selectedKeys.length : sendable) - genTarget; // 멘트 있어 건너뛸 행 수
  const off = bulkGen || locked;
  const noticeStudents = new Set(selectedKeys.map((k) => k.split("::")[0])).size; // 공지=학생 단위(행 아님, #23)
  const lang = useSheetLang();
  const t = useSheetT();
  const classnoteOn = useClassnoteOn();
  const aiOn = useLicenseOn("ai_analysis"); // 꺼진 지점엔 '자동 작성' 일괄 버튼이 없다(2026-09-30)
  const tf = useSheetTf();
  return (
    <div data-help="os-save" className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5">
      <span className="text-text-dim text-xs">
        {tf("os.bar.peopleRows", { students: counts.students ?? total, rows: total })} ·{" "}
        {t("os.bar.sendable")} <span className="text-foreground font-bold">{sendReady}</span>
        {sendable > sendReady ? (
          <span className="text-text-faint">
            {" "}
            {tf("os.bar.noMent", { n: sendable - sendReady })}
          </span>
        ) : null}
        {selectedKeys.length ? (
          <>
            {" "}
            · {t("os.bar.selected")}{" "}
            <span className="text-primary font-bold">{selectedKeys.length}</span>
            {selectedKeys.length > selectedSendReady ? (
              <span className="text-text-faint">
                {" "}
                {tf("os.bar.selectedSendable", { n: selectedSendReady })}
              </span>
            ) : null}
          </>
        ) : null}
      </span>
      {navHint ? (
        <span className="text-text-faint hidden text-xs lg:inline">
          · {t("os.bar.keyHint")}
        </span>
      ) : null}
      <DisplaySettings />
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {children}
        {/* G5 얕은판 — 이전 회차 값으로 빈 칸 일괄 채우기. 값 일괄(팝오버=children) 옆이 자연 위치.
            기존값은 절대 안 덮음(planPrevFill=빈 칸만)이라 confirm 불필요. 진도 게이트 무관(raw 행 대상). */}
        {actions.onBulkImportPrev ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onBulkImportPrev?.(selectedKeys.length ? selectedKeys : undefined)}
            disabled={off}
            title={t("os.prev.title")}
          >
            {/* 행별 버튼과 같은 말로 통일 — '채우기'/'가져오기' 혼용 금지(원장 지시 07-21). */}
            {selectedKeys.length
              ? tf("os.prev.pick", { n: selectedKeys.length })
              : t("os.prev.allRows")}
          </Button>
        ) : null}
        {actions.makeupPrev ? (
          <Button
            variant="outline"
            size="sm"
            onClick={actions.makeupPrev.onLoad}
            disabled={off || actions.makeupPrev.busy}
            title={t("os.prev.makeupTitle")}
          >
            {actions.makeupPrev.busy ? t("os.prev.makeupBusy") : tf("os.prev.makeupLoad", { n: actions.makeupPrev.count })}
          </Button>
        ) : null}
        {/* 일괄 첨부 — 파일을 고르는 즉시 선택 행에 첨부된다(확인 다이얼로그 없음: 첨부는 되돌리기가 쉬운 편이고
            대상이 '선택 행'으로 이미 좁혀져 있다). 선택이 없으면 대상이 모호해 아예 안 보인다. */}
        {actions.onBulkAttach && selectedKeys.length > 0 ? (
          <AttachPicker
            disabled={off}
            onFiles={(files) => actions.onBulkAttach?.(selectedKeys, files)}
          >
            {tf("os.attach.pick", { n: selectedKeys.length })}
          </AttachPicker>
        ) : null}
        {actions.onClassNotice ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onClassNotice?.(selectedKeys)}
            disabled={off}
            title={t("os.notice.title")}
          >
            {noticeStudents
              ? tf("os.notice.pick", { n: noticeStudents })
              : t("os.notice.whole")}
          </Button>
        ) : null}
        {/* 자동작성 = **멘트 없는 행만**. 이전값 가져오기로 멘트를 깔면 대상이 줄어드는 게 라벨에 바로 보이고,
            0이 되면 비활성 — "채운 문구를 재생성이 덮어쓰나?"를 화면에서 답해준다(보존 로직은 autoWriteAllVisible). */}
        {aiOn ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.onAutoWriteAll(selectedKeys)}
          disabled={genTarget === 0 || off}
          title={
            genTarget === 0
              ? genPreserved > 0
                ? tf("os.gen.nonePreserved", { n: genPreserved })
                : t("os.gen.noneProgress")
              : genPreserved > 0
                ? tf("os.gen.some", { n: genTarget, kept: genPreserved })
                : tf("os.gen.count", { n: genTarget })
          }
        >
          {bulkGen
            ? t("os.gen.busy")
            : selectedKeys.length
              ? tf("os.gen.pick", { pick: bulkPickLabel(selectedKeys.length, genTarget, lang) })
              : tf("os.gen.all", { n: genTarget })}
        </Button>
        ) : null}
        {/* ⚠️ disabled는 **선택이 있으면 선택분 기준**이다(2026-07-21 수정). 예전엔 전체 `saveable`만 봐서,
            고른 37행이 전부 저장 대상이 아닌데도 버튼이 살아 있어 눌러도 아무 일이 없었다. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.onSaveAll(selectedKeys)}
          disabled={(selectedKeys.length ? selectedSaveable : saveable) === 0 || off}
          title={
            selectedKeys.length && selectedSaveable === 0
              ? t("os.save.none")
              : undefined
          }
        >
          {selectedKeys.length
            ? tf("os.save.pick", { pick: bulkPickLabel(selectedKeys.length, selectedSaveable, lang) })
            : t("os.save.all")}
        </Button>
        {classnoteOn ? (
        <Button
          size="sm"
          onClick={() => actions.onSendAll(selectedKeys)}
          disabled={(selectedKeys.length ? selectedSendReady : sendReady) === 0 || off}
          title={
            (selectedKeys.length ? selectedSendReady : sendReady) === 0
              ? t("os.send.none")
              : undefined
          }
        >
          {selectedKeys.length
            ? tf("os.send.pick", { pick: bulkPickLabel(selectedKeys.length, selectedSendReady, lang) })
            : t("os.send.all")}
        </Button>
        ) : null}
        {trailing ? <div className="ml-auto empty:hidden">{trailing}</div> : null}
      </div>
    </div>
  );
}
