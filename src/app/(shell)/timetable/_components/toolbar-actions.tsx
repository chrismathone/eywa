"use client";

import { useEffect, useState, useTransition } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ExternalLink, FileSpreadsheet, Loader2, Sheet, Upload } from "@/components/icons/eywa-icon-compat";
import { TimetableImportDialog } from "./import-dialog";
import { EnglishImportDialog } from "./english-import-dialog";
import { checkSheetSyncBusy, syncSheetsNow } from "@/features/integrations/server/actions";
import { supportsTimetableImport, supportsStructureImport } from "@/features/integrations/sheets-provider";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DEFAULT_TIMETABLE_KIND, type TimetableKind } from "@/features/timetable/lib/class-kind";

/** 리스 진행 중 버튼 마우스오버 안내(비활성 사유) — 자동 반영(새벽 4시)·다른 관리자 실행 공통. */
const SYNC_BUSY_TITLE =
  "시트 동기화가 진행 중입니다(자동 반영 또는 다른 관리자의 반영/가져오기) — 잠시 후 자동으로 풀립니다.";

/**
 * 정규 외 구분에서 내보내기를 막는 이유 — 엑셀·시트 익스포터는 **정규 주간표 전체**를 만든다(화면의
 * 정규/특강 필터를 받지 않는다). 그대로 열어 두면 특강만 보는 화면에서 정규가 통째로 담긴 파일이
 * 내려오고, '시트 반영'은 특강을 마스터 시트에 밀어 넣어 '시트에서 가져오기' 왕복에 굳는다.
 */
const KIND_EXPORT_TITLE =
  "내보내기는 정규 시간표 기준으로만 지원합니다 — 구분을 '정규'로 바꾼 뒤 사용하세요.";

/**
 * 비활성 사유 한 줄 — ⚠️ **툴팁이 아니라 보이는 문구**다. disabled button의 `title`은 브라우저마다 안 뜨고,
 * 메뉴로 접어 놓으면 "왜 못 누르지"를 확인할 다른 경로가 없다(원장 제보 이력: "마우스 올려도 안 보임").
 */
function Reason({ text }: { text: string }) {
  return <p className="text-text-faint px-2 pb-1 text-[10px] leading-snug break-keep">{text}</p>;
}

export function TimetableToolbarActions({
  subject,
  today,
  kind = DEFAULT_TIMETABLE_KIND,
  canSync = false,
  canManageImport = false,
  sheetUrl = null,
  compact1h = [],
}: {
  subject?: string;
  /**
   * KST 오늘(서버 계산) — 가져오기 **적용일**의 하한이자 기본값. 🔴 클라에서 `new Date()`로 뽑지 말 것:
   * 브라우저 타임존이 다르면 "오늘"이 하루 어긋나 과거 적용이 되거나 오늘이 거절된다.
   */
  today: string;
  /** 화면의 정규/특강/전체 구분. 정규가 아니면 내보내기·시트 버튼을 잠근다(화면과 파일 불일치 방지). */
  kind?: TimetableKind;
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
  // 정규 화면에서만 내보내기 허용 — 익스포터가 화면 구분을 못 받으므로 "화면과 파일이 다른" 상태를 만들지 않는다.
  const exportsAllowed = kind === "regular";

  const [menuOpen, setMenuOpen] = useState(false);
  // 다이얼로그는 동시에 열릴 일이 없어 단일 유니온으로 둔다(둘 다 마운트되는 상태 자체를 없앤다).
  const [openDialog, setOpenDialog] = useState<"file" | "sheet" | null>(null);

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

  // 팝오버에 담을 항목 수 — 권한이 없어 '엑셀' 하나뿐이면 접는 게 순손해라 평면으로 둔다.
  const canFileImport = canImport && exportsAllowed;
  const canSheetImport = canSync && (canStructureImport || canImport);
  const itemCount = 1 + (canFileImport ? 1 : 0) + (canSync ? 1 : 0) + (canSheetImport ? 1 : 0) + (sheetUrl ? 1 : 0);

  const itemCls =
    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-text-dim transition hover:bg-bg-soft hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent";
  // 다이얼로그 2개는 **조건부 마운트**한다 — 항상 마운트한 채 부모가 open을 false로 만들면 close()의
  // 상태 리셋(미리보기·결과·snapshotId)과 "아직 적용하지 않았습니다" confirm 가드를 우회한다(gotcha #67).
  // 언마운트가 곧 리셋이라 재오픈이 항상 깨끗하다.
  // ⚠️ 팝오버 **밖 형제**여야 한다 — base-ui Popover.Positioner는 transform 배치라, 그 안에 두면
  //    다이얼로그의 position:fixed 오버레이가 팝업 박스를 컨테이닝 블록으로 삼아 통째로 깨진다.
  const dialogs = (
    <>
      {openDialog === "file" && canFileImport ? (
        <TimetableImportDialog
          subject={subjectKey}
          today={today}
          hideTrigger
          open
          onOpenChange={(o) => {
            if (!o) setOpenDialog(null);
          }}
        />
      ) : null}
      {openDialog === "sheet" && canSync && canStructureImport ? (
        <EnglishImportDialog
          subject={subjectKey}
          today={today}
          hideTrigger
          open
          onOpenChange={(o) => {
            if (!o) setOpenDialog(null);
          }}
        />
      ) : null}
      {openDialog === "sheet" && canSync && canImport && !canStructureImport ? (
        <TimetableImportDialog
          mode="sheet"
          subject={subjectKey}
          today={today}
          hideTrigger
          open
          onOpenChange={(o) => {
            if (!o) setOpenDialog(null);
          }}
        />
      ) : null}
    </>
  );

  // 항목이 하나면 접지 않는다 — 클릭만 한 번 늘고 얻는 게 없다(권한 없는 사용자 = '엑셀'만).
  if (itemCount <= 1) {
    return (
      <div className="print:hidden flex items-center gap-1">
        {exportsAllowed ? (
          <a href={exportHref} className={btnCls}>
            <FileSpreadsheet className="size-3" />
            엑셀
          </a>
        ) : (
          <button type="button" disabled title={KIND_EXPORT_TITLE} className={btnCls}>
            <FileSpreadsheet className="size-3" />
            엑셀
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="print:hidden flex items-center gap-1">
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft data-[popup-open]:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs transition"
          title="엑셀 내보내기·가져오기, 구글 시트 반영·가져오기"
        >
          {/* 진행 중이면 트리거에서 바로 보이게 — 접으면 안쪽 스피너가 안 보인다. */}
          {syncing || syncBusy ? <Loader2 className="size-3 animate-spin" /> : <FileSpreadsheet className="size-3" />}
          엑셀·시트
          <ChevronDown className="size-3" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            <Popover.Popup className="bg-card border-line shadow-card w-[248px] max-w-[calc(100vw-2rem)] rounded-xl border p-2 text-left outline-none">
              {exportsAllowed ? (
                <a href={exportHref} className={itemCls} onClick={() => setMenuOpen(false)}>
                  <FileSpreadsheet className="size-3 shrink-0" />
                  엑셀 내보내기
                </a>
              ) : (
                <>
                  <button type="button" disabled className={itemCls}>
                    <FileSpreadsheet className="size-3 shrink-0" />
                    엑셀 내보내기
                  </button>
                  <Reason text={KIND_EXPORT_TITLE} />
                </>
              )}

              {canFileImport ? (
                <button
                  type="button"
                  className={itemCls}
                  onClick={() => {
                    setMenuOpen(false);
                    setOpenDialog("file");
                  }}
                >
                  <Upload className="size-3 shrink-0" />
                  가져오기(파일)
                </button>
              ) : null}

              {canSync || sheetUrl ? <div className="border-line my-1 border-t" /> : null}

              {canSync ? (
                <>
                  <button
                    type="button"
                    // ⚠️ 여기선 팝오버를 **닫지 않는다** — 닫으면 진행 스피너와 결과 문구(syncMsg)를
                    //    볼 곳이 사라진다(다이얼로그와 달리 이 동작은 제자리에서 끝난다).
                    onClick={pushToSheet}
                    disabled={syncing || syncBusy || !exportsAllowed}
                    title={`${subjectLabel} 시간표 전체를 연결된 구글 시트에 반영합니다`}
                    className={itemCls}
                  >
                    {syncing ? (
                      <Loader2 className="size-3 shrink-0 animate-spin" />
                    ) : (
                      <Sheet className="size-3 shrink-0" />
                    )}
                    시트 반영
                  </button>
                  {!exportsAllowed ? (
                    <Reason text={KIND_EXPORT_TITLE} />
                  ) : syncBusy ? (
                    <Reason text={SYNC_BUSY_TITLE} />
                  ) : null}
                  {syncMsg ? (
                    <p
                      className={`px-2 pb-1 text-[10px] leading-snug break-keep ${
                        syncMsg === "시트에 반영됨" ? "text-primary" : "text-chart-4"
                      }`}
                    >
                      {syncMsg}
                    </p>
                  ) : null}
                </>
              ) : null}

              {canSheetImport ? (
                <>
                  <button
                    type="button"
                    className={itemCls}
                    disabled={syncBusy || !exportsAllowed}
                    onClick={() => {
                      setMenuOpen(false);
                      setOpenDialog("sheet");
                    }}
                  >
                    <Sheet className="size-3 shrink-0" />
                    시트에서 가져오기
                  </button>
                  {!exportsAllowed ? (
                    <Reason text={KIND_EXPORT_TITLE} />
                  ) : syncBusy ? (
                    <Reason text={SYNC_BUSY_TITLE} />
                  ) : null}
                </>
              ) : null}

              {sheetUrl ? (
                <a
                  href={sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={itemCls}
                  onClick={() => setMenuOpen(false)}
                >
                  <ExternalLink className="size-3 shrink-0" />
                  시트 열기
                </a>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {dialogs}
    </div>
  );
}
