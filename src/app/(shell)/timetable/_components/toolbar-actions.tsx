"use client";

import { useEffect, useState, useTransition } from "react";
import { ExternalLink, FileSpreadsheet, Loader2, Sheet } from "@/components/icons/eywa-icon-compat";
import { TimetableImportDialog } from "./import-dialog";
import { EnglishImportDialog } from "./english-import-dialog";
import { checkSheetSyncBusy, syncSheetsNow } from "@/features/integrations/server/actions";
import { supportsTimetableImport, supportsStructureImport } from "@/features/integrations/sheets-provider";
import { useSubjectMaps } from "@/features/owner/operations-context";

/** 리스 진행 중 버튼 마우스오버 안내(비활성 사유) — 자동 반영(새벽 4시)·다른 관리자 실행 공통. */
const SYNC_BUSY_TITLE =
  "시트 동기화가 진행 중입니다(자동 반영 또는 다른 관리자의 반영/가져오기) — 잠시 후 자동으로 풀립니다.";

export function TimetableToolbarActions({
  subject,
  canSync = false,
  canManageImport = false,
  sheetUrl = null,
  compact1h = [],
}: {
  subject?: string;
  /** 구글 시트 동기화(=테넌트 전체 시간표 외부 push)는 sheet_sync 권한 + 지원 과목 + 연동 ON일 때만. */
  canSync?: boolean;
  /**
   * 파일 업로드 가져오기 권한(classes=full) — 서버 `canManageTimetableImport`와 **같은 게이트**를
   * 페이지가 계산해 내려준다. 화면에서만 숨기는 건 게이트가 아니므로 서버 액션도 같은 함수로 막는다(#77).
   */
  canManageImport?: boolean;
  /** 연결된 구글 시트 URL(설정돼 있을 때만). 있으면 '시트 열기' 노출. */
  sheetUrl?: string | null;
  /** 현재 화면의 '1시간 단위' 압축 섹션(sectionKey) — 엑셀·시트 내보내기에 그대로 반영. */
  compact1h?: number[];
}) {
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // 시트 리스 진행 중(자동 반영·타 관리자 실행) — 반영/가져오기 버튼 선제 비활성. 서버 리스 거부가 2차 방어.
  const [syncBusy, setSyncBusy] = useState(false);
  const subjectKey = subject ?? "math";
  // 과목 라벨(수학/영어…)은 학원설정 단일 소스에서 — 툴팁 등 문구 하드코딩 금지(클라는 useSubjectMaps 훅).
  const subjectLabel = useSubjectMaps().labelOf(subjectKey);
  const compactParam = compact1h.length ? `&compact1h=${[...compact1h].sort((a, b) => a - b).join(",")}` : "";
  const exportHref = `/api/exports/timetable?subject=${encodeURIComponent(subjectKey)}${compactParam}`;
  // 가져오기(수강편집 라운드트립 = 학생 반이동)는 math·english 둘 다(과목별 '수강편집' 시트). 파일·시트 두 경로 게이트.
  // ⚠️ 권한(classes=full)도 AND — 옛 코드는 과목만 봐서 강사에게도 가져오기 버튼이 떴다(적대 감사 H2).
  const canImport = supportsTimetableImport(subjectKey) && canManageImport;
  // 구조 가져오기(강사별 그리드 → class_schedules 재구축)는 english 전용. 시트→앱 되읽기라 canSync와 AND.
  // 영어는 구조+반이동을 하나의 '시트에서 가져오기'(EnglishImportDialog)로 통합 → canStructureImport로 분기.
  const canStructureImport = supportsStructureImport(subjectKey);

  // 리스 상태 폴링(20s, makeedu 워커 카드 선례) — canSync(시트 버튼 노출)일 때만.
  useEffect(() => {
    if (!canSync) return;
    let alive = true;
    const poll = () =>
      void checkSheetSyncBusy(subjectKey)
        .then((busy) => {
          if (alive) setSyncBusy(busy);
        })
        .catch(() => {
          /* 폴링 실패는 무시(다음 20초 재시도) — unhandled rejection 방지 */
        });
    poll();
    const t = setInterval(poll, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [canSync, subjectKey]);

  function pushToSheet() {
    setSyncMsg(null);
    startSync(async () => {
      const res = await syncSheetsNow(subjectKey, compact1h);
      if (res?.error) setSyncMsg(res.error);
      else setSyncMsg("시트에 반영됨");
    });
  }

  const btnCls =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition disabled:opacity-50";
  const hasSheetGroup = canSync || !!sheetUrl;

  return (
    // flex-wrap — 좁은 화면(모바일)에서 버튼 5개가 한 줄로 강제돼 카드 밖으로 넘치지 않게 줄바꿈.
    <div className="print:hidden flex flex-wrap items-center gap-1">
      {/* 엑셀 그룹: 내보내기(전 과목) + 가져오기(수강편집 라운드트립 = 학생 반이동, math·english) */}
      <div className="flex items-center gap-1">
        <a href={exportHref} className={btnCls}>
          <FileSpreadsheet className="size-3" />
          엑셀
        </a>
        {/* 파일 업로드 가져오기 = math·english 공통(둘 다 내보내기 xlsx에 '수강편집' 시트 포함 = 라운드트립).
            영어도 시트 연동 OFF·권한 없음일 때 유일한 가져오기 경로라 열어둔다(2026-07-15).
            ⚠️ 이 경로는 '수강편집'만 읽어 **학생 반이동만** 반영 — 영어 배치(강사별 그리드) 변경은
            구글시트 경로(EnglishImportDialog)만 지원. 다이얼로그가 그 한계를 문구로 명시한다. */}
        {canImport ? <TimetableImportDialog subject={subjectKey} /> : null}
      </div>

      {/* 구글 시트 그룹: 반영(push) + 열기 — 구분선으로 엑셀 그룹과 분리(줄바꿈 시에도 그룹 단위 유지) */}
      {hasSheetGroup ? (
        <div className="border-line ml-0.5 flex flex-wrap items-center gap-1 border-l pl-2">
          {canSync ? (
            <button
              type="button"
              onClick={pushToSheet}
              disabled={syncing || syncBusy}
              title={
                syncBusy ? SYNC_BUSY_TITLE : (syncMsg ?? `${subjectLabel} 시간표 전체를 연결된 구글 시트에 반영`)
              }
              className={btnCls}
            >
              {syncing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
              시트 반영
            </button>
          ) : null}
          {/* 시트에서 가져오기 — 영어=구조(강사별)+반이동(수강편집) 통합 1버튼, 수학=반이동(수강편집)만. */}
          {canSync && canStructureImport ? (
            <EnglishImportDialog subject={subjectKey} disabled={syncBusy} disabledTitle={SYNC_BUSY_TITLE} />
          ) : null}
          {canSync && canImport && !canStructureImport ? (
            <TimetableImportDialog
              mode="sheet"
              subject={subjectKey}
              disabled={syncBusy}
              disabledTitle={SYNC_BUSY_TITLE}
            />
          ) : null}
          {sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="연결된 구글 시트를 새 탭에서 엽니다"
              className={btnCls}
            >
              <ExternalLink className="size-3" />
              시트 열기
            </a>
          ) : null}
          {syncMsg ? (
            <span
              className={`whitespace-nowrap text-[10px] ${syncMsg === "시트에 반영됨" ? "text-primary" : "text-chart-4"}`}
            >
              {syncMsg}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
