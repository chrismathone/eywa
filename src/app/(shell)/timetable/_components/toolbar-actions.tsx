"use client";
import { useTimetableText } from "@/features/teacher-view/use-timetable-text";
import { EXCEL_MENU_LABEL } from "@/components/excel-import/excel-menu";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";

import { useEffect, useState, useTransition } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ExternalLink, FileSpreadsheet, Loader2, Sheet, Upload } from "@/components/icons/aywa-icon-compat";
import { TimetableImportDialog } from "./import-dialog";
import { EnglishImportDialog } from "./english-import-dialog";
import Link from "next/link";
import {
  getSheetSyncRows,
  syncSheetsNow,
  type SheetSyncRow,
} from "@/features/integrations/server/actions";
import { supportsTimetableImport, supportsStructureImport } from "@/features/integrations/sheets-provider";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { kstShortStamp } from "@/lib/date-kst";
import { DEFAULT_TIMETABLE_KIND, type TimetableKind } from "@/features/timetable/lib/class-kind";

/** 리스 진행 중 버튼 마우스오버 안내(비활성 사유) — 자동 반영(새벽 4시)·다른 관리자 실행 공통. */
const SYNC_BUSY_TITLE =
  "시트 동기화가 진행 중입니다(자동 반영 또는 다른 관리자의 반영/가져오기) — 잠시 후 자동으로 풀립니다.";

/**
 * 정규 외 구분에서 내보내기를 막는 이유 — 엑셀·시트 익스포터는 **정규 주간표 전체**를 만든다(화면의
 * 정규/특강 필터를 받지 않는다). 그대로 열어 두면 특강만 보는 화면에서 정규가 통째로 담긴 파일이
 * 내려오고, '시트로 보내기'는 특강을 마스터 시트에 밀어 넣어 '시트에서 가져오기' 왕복에 굳는다.
 */
const KIND_EXPORT_TITLE =
  "내보내기는 정규 시간표 기준으로만 지원합니다 — 구분을 '정규'로 바꾼 뒤 사용하세요.";

/** 시트 연동을 켠 과목이 하나도 없을 때 — 빈 메뉴 대신 갈 곳을 알려준다. */
const NO_SHEET_SUBJECT_TITLE =
  "시트 연동을 켠 과목이 없습니다 — 학원 설정 › 연동에서 과목별 시트를 등록하고 켜세요.";

/** 연동은 켰는데 대상 시트를 아직 안 적은 과목 — 눌러도 서버가 같은 이유로 거절하므로 미리 말한다. */
const NO_SHEET_TARGET_TITLE =
  "‘시트 미등록’인 과목은 반영할 수 없습니다 — 학원 설정 › 연동에서 그 과목의 Google Sheets ID를 등록하세요.";

/**
 * 비활성 사유 한 줄 — ⚠️ **툴팁이 아니라 보이는 문구**다. disabled button의 `title`은 브라우저마다 안 뜨고,
 * 메뉴로 접어 놓으면 "왜 못 누르지"를 확인할 다른 경로가 없다(원장 제보 이력: "마우스 올려도 안 보임").
 */
function Reason({ text }: { text: string }) {
  return <p className="text-text-faint px-2 pb-1 text-xs leading-snug break-keep">{text}</p>;
}

/**
 * 두 시각 중 **나중 것**. 방금 내가 반영한 시각과 폴링이 가져온 시각을 합칠 때 쓴다 —
 * 🔴 내 값을 항상 우선하면, 그 뒤 **다른 관리자·새벽 자동 반영**이 더 최근에 밀어 넣어도 화면은
 *    내 옛 시각을 계속 보여 준다(거짓). 🔴 문자열 대소로 비교하지 말 것 — 두 값의 타임존 표기가
 *    다를 수 있다(`…Z` vs `…+00:00`)라 사전순이 시간순과 어긋난다.
 */
function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : (b ?? null);
  if (Number.isNaN(tb)) return a ?? null;
  return ta >= tb ? (a ?? null) : (b ?? null);
}

export function TimetableToolbarActions({
  subject,
  today,
  kind = DEFAULT_TIMETABLE_KIND,
  canSync = false,
  canManageImport = false,
  canApplyStructureImport = false,
  canMasterImport = false,
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
  /**
   * 영어 '시트에서 가져오기'(구조 + 반이동) 적용 권한 — 서버 applyStructureImport·applySheetImport와 같은 판정
   * (시트 연동 ∧ classes 쓰기, 담당분 포함)을 페이지가 계산해 내려준다.
   */
  canApplyStructureImport?: boolean;
  canMasterImport?: boolean;
  /** 연결된 구글 시트 URL(설정돼 있을 때만). 있으면 '시트 열기' 노출. */
  sheetUrl?: string | null;
  /** 현재 화면의 '1시간 단위' 압축 섹션(sectionKey) — 엑셀·시트 내보내기에 그대로 반영. */
  compact1h?: number[];
}) {
  const tt = useTimetableText();
  const [pending, startSync] = useTransition();
  /** 지금 반영 중인 과목 — 줄이 여럿이라 boolean 하나로는 어느 줄에 스피너를 놓을지 못 가린다. */
  const [running, setRunning] = useState<string | null>(null);
  /** 실행 결과 한 줄. 성공/실패를 **문자열 비교가 아니라 플래그로** 가른다(문구가 과목마다 다르다). */
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /**
   * 과목별 '시트로 보내기' 줄 — 🔴 `null`(아직 못 불러옴)과 `[]`(켠 과목이 0개)를 **구분**한다.
   * 뭉치면 로딩 한 틱이 "연동이 없습니다"라는 거짓 결론으로 보인다.
   */
  const [rows, setRows] = useState<SheetSyncRow[] | null>(null);
  const [rowsFailed, setRowsFailed] = useState(false);
  /** 방금 이 화면에서 반영한 시각 — 폴링(20초)을 기다리지 않고 즉시 갱신. 성공했을 때만 들어온다. */
  const [justSynced, setJustSynced] = useState<Record<string, string>>({});
  const subjectKey = subject ?? "math";
  // 과목 라벨(수학/영어…)은 학원설정 단일 소스에서 — 문구 하드코딩 금지(클라는 useSubjectMaps 훅).
  const subjectMaps = useSubjectMaps();
  const compactParam = compact1h.length ? `&compact1h=${[...compact1h].sort((a, b) => a - b).join(",")}` : "";
  const exportHref = `/api/exports/timetable?subject=${encodeURIComponent(subjectKey)}${compactParam}`;
  // 가져오기(수강편집 라운드트립 = 학생 반이동)는 math·english 둘 다(과목별 '수강편집' 시트). 파일·시트 두 경로 게이트.
  // ⚠️ 권한(classes=full)도 AND — 옛 코드는 과목만 봐서 강사에게도 가져오기 버튼이 떴다(적대 감사 H2).
  const canImport = supportsTimetableImport(subjectKey) && canManageImport;
  // 구조 가져오기(강사별 그리드 → class_schedules 재구축)는 english 전용. 시트→앱 되읽기라 canSync와 AND.
  // 영어는 구조+반이동을 하나의 '시트에서 가져오기'(EnglishImportDialog)로 통합 → canStructureImport로 분기.
  // 🔴 권한(`canApplyStructureImport` = 서버 적용 게이트와 같은 값)도 AND — 과목만 보던 시절엔 시트 권한만 있고 반 관리가
  //    '읽기'인 계정에도 이 메뉴가 떠서, 미리보기까지 다 본 뒤 적용에서야 "시간표 관리 권한이 없습니다"가 떴다
  //    (원장 2026-11-05, write-lock.ts — 읽기 권한이면 쓰기 단추를 그리지 않는다).
  const canStructureImport = supportsStructureImport(subjectKey) && canApplyStructureImport;
  // 정규 화면에서만 내보내기 허용 — 익스포터가 화면 구분을 못 받으므로 "화면과 파일이 다른" 상태를 만들지 않는다.
  const exportsAllowed = kind === "regular";
  /**
   * 시트 구획(반영 줄 + 가져오기 + 열기)이 이 화면에 있는가 = 이 사용자가 시트 권한을 통과했다는 뜻
   * (페이지는 `canManageSheetSync`를 통과했을 때만 이 둘을 채운다). 폴링을 여기에만 건다 —
   * 권한 없는 사용자(강사 등)가 20초마다 헛 왕복을 돌지 않게.
   */
  const sheetSection = canSync || !!sheetUrl;

  const [menuOpen, setMenuOpen] = useState(false);
  // 다이얼로그는 동시에 열릴 일이 없어 단일 유니온으로 둔다(둘 다 마운트되는 상태 자체를 없앤다).
  const [openDialog, setOpenDialog] = useState<"file" | "sheet" | null>(null);

  // 과목별 시트 상태 폴링(20s, makeedu 워커 카드 선례) — 줄 목록·진행 중·마지막 반영 시각을 한 번에 받는다.
  useEffect(() => {
    if (!sheetSection) return;
    let alive = true;
    const poll = () =>
      void getSheetSyncRows()
        .then((next) => {
          if (!alive) return;
          setRows(next);
          setRowsFailed(false);
        })
        .catch(() => {
          // 실패를 빈 배열로 삼키면 "연동한 과목이 없다"는 거짓 결론이 뜬다 → 실패라고 말한다.
          if (alive) setRowsFailed(true);
        });
    poll();
    const t = setInterval(poll, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sheetSection]);

  function pushToSheet(row: SheetSyncRow, label: string) {
    if (pending) return;
    setMsg(null);
    setRunning(row.subject);
    startSync(async () => {
      // 🔴 화면의 '1시간 단위' 압축은 **보고 있는 과목**의 상태다 — 다른 과목엔 넘기지 않는다(그러면 엉뚱한
      //    교시가 접힌 시트가 나간다). 값이 없으면 서버가 그 과목에 저장된 계정 뷰 설정을 읽는다.
      const res = await syncSheetsNow(row.subject, row.subject === subjectKey ? compact1h : undefined);
      setRunning(null);
      // 성공·실패 모두 서버가 리스를 풀었다 — 다음 폴링(최대 20초)까지 이 줄이 '진행 중'으로 잠겨 보이지 않게.
      setRows((prev) => prev?.map((r) => (r.subject === row.subject ? { ...r, busy: false } : r)) ?? prev);
      if (res?.error) {
        setMsg({ text: res.error, ok: false });
        return;
      }
      setMsg({ text: `${label} 시트에 반영됨`, ok: true });
      const at = res?.syncedAt;
      // 🔴 성공 응답에 시각이 있을 때만 갱신 — 실패·미상은 옛 시각을 그대로 둔다(안 한 일을 한 것처럼 적지 않는다).
      if (at) setJustSynced((prev) => ({ ...prev, [row.subject]: at }));
    });
  }

  /** 줄 오른쪽 부차 정보 — 마지막 반영 시각(KST `yy.mm.dd hh:mm`). 없으면 빈 칸이 아니라 사실을 적는다. */
  function stampOf(row: SheetSyncRow): string {
    if (!row.connected) return tt("시트 미등록");
    return kstShortStamp(laterIso(justSynced[row.subject], row.lastSyncedAt)) ?? tt("아직 반영 안 함");
  }

  // 툴바 줄에 서는 버튼 — 높이는 control-scale 한 값(세로 패딩으로 만들지 않는다).
  const btnCls = `${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_OFF} disabled:opacity-50`;

  // 팝오버에 담을 항목 수 — 권한이 없어 '엑셀' 하나뿐이면 접는 게 순손해라 평면으로 둔다.
  const canFileImport = canImport && exportsAllowed;
  const canSheetImport = canSync && (canStructureImport || canImport);
  const showMasterImport = subjectKey === "english" && canMasterImport;
  const itemCount = 1 + (canFileImport ? 1 : 0) + (canSync ? 1 : 0) + (canSheetImport ? 1 : 0) + (sheetUrl ? 1 : 0) + (showMasterImport ? 1 : 0);
  // 진행 중 표시(트리거) — 내 실행 + 남의 실행(리스) 둘 다. 접었을 때 안쪽 스피너가 안 보이므로 트리거에 올린다.
  const anyBusy = pending || (rows ?? []).some((r) => r.busy);

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
            {tt("엑셀 내보내기")}</a>
        ) : (
          <button type="button" disabled title={tt(KIND_EXPORT_TITLE)} className={btnCls}>
            <FileSpreadsheet className="size-3" />
            {tt("엑셀 내보내기")}</button>
        )}
      </div>
    );
  }

  return (
    <div className="print:hidden flex items-center gap-1">
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger
          className={`${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_OFF} data-[popup-open]:bg-bg-soft`}
          title={sheetSection ? tt("엑셀 내보내기·가져오기, 시트로 보내기·가져오기") : tt("엑셀 내보내기·가져오기")}
        >
          {/* 진행 중이면 트리거에서 바로 보이게 — 접으면 안쪽 스피너가 안 보인다. */}
          {anyBusy ? <Loader2 className="size-3 animate-spin" /> : <FileSpreadsheet className="size-3" />}
          {/* 이름은 모든 탭과 같은 한 벌(원장 2026-09-29 *"엑셀 내보내기/가져오기 로 통일"*) — 시트로 보내기·가져오기는 같은 메뉴 아래칸. */}
          {EXCEL_MENU_LABEL}
          <ChevronDown className="size-3" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            {/* 폭 296px = '수학 시트로' + 'yy.mm.dd hh:mm'이 한 줄에 들어가는 값(줄바꿈되면 탭 타겟이 흔들린다). */}
            <Popover.Popup className="bg-card border-line shadow-card w-[296px] max-w-[calc(100vw-2rem)] rounded-xl border p-2 text-left outline-none">
              {exportsAllowed ? (
                <a href={exportHref} className={itemCls} onClick={() => setMenuOpen(false)}>
                  <FileSpreadsheet className="size-3 shrink-0" />
                  {tt("엑셀 내보내기")}</a>
              ) : (
                <>
                  <button type="button" disabled className={itemCls}>
                    <FileSpreadsheet className="size-3 shrink-0" />
                    {tt("엑셀 내보내기")}</button>
                  <Reason text={tt(KIND_EXPORT_TITLE)} />
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
                  {tt("엑셀 가져오기")}</button>
              ) : null}

              {sheetSection ? <div className="border-line my-1 border-t" /> : null}
              {showMasterImport ? <Link href="/timetable/english-sheet" className={itemCls} onClick={() => setMenuOpen(false)}><Sheet className="size-3 shrink-0" />{tt("영어 시트 반영")}</Link> : null}

              {/* 과목별 '시트로 보내기' — 원장 2026-09-10 "영어/수학 과목별로 시트 반영. 우측에 최근 반영 날짜".
                  ⚠️ 여기선 팝오버를 **닫지 않는다** — 닫으면 진행 스피너와 결과 문구를 볼 곳이 사라진다
                  (다이얼로그와 달리 이 동작은 제자리에서 끝난다). */}
              {sheetSection && rows === null ? (
                <>
                  <button type="button" disabled className={itemCls}>
                    <Sheet className="size-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{tt("시트로 보내기")}</span>
                    <span className="text-text-faint shrink-0 text-xs">
                      {rowsFailed ? tt("상태 확인 실패") : tt("불러오는 중…")}
                    </span>
                  </button>
                  {rowsFailed ? (
                    <Reason text={tt("시트 연동 상태를 불러오지 못했습니다 — 잠시 후 다시 열어 보세요.")} />
                  ) : null}
                </>
              ) : null}

              {sheetSection && rows?.length === 0 ? <Reason text={tt(NO_SHEET_SUBJECT_TITLE)} /> : null}

              {sheetSection && rows?.length
                ? rows.map((row) => {
                    const label = subjectMaps.labelOf(row.subject);
                    return (
                      <button
                        key={row.subject}
                        type="button"
                        onClick={() => pushToSheet(row, label)}
                        disabled={pending || row.busy || !exportsAllowed || !row.connected}
                        title={`${label} 시간표를 연결된 구글 시트로 보냅니다`}
                        className={itemCls}
                      >
                        {running === row.subject || row.busy ? (
                          <Loader2 className="size-3 shrink-0 animate-spin" />
                        ) : (
                          <Sheet className="size-3 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{label} {tt("시트로")}</span>
                        <span className="text-text-faint shrink-0 text-xs tabular-nums">{stampOf(row)}</span>
                      </button>
                    );
                  })
                : null}

              {/* 비활성 사유는 **한 줄만** — 여러 줄이 쌓이면 진짜 이유가 묻힌다. 넓은 것부터(구분 → 미등록 → 진행 중). */}
              {sheetSection && rows?.length ? (
                !exportsAllowed ? (
                  <Reason text={tt(KIND_EXPORT_TITLE)} />
                ) : rows.some((r) => !r.connected) ? (
                  <Reason text={tt(NO_SHEET_TARGET_TITLE)} />
                ) : rows.some((r) => r.busy) ? (
                  <Reason text={SYNC_BUSY_TITLE} />
                ) : null
              ) : null}

              {msg ? (
                <p
                  className={`px-2 pb-1 text-xs leading-snug break-keep ${
                    msg.ok ? "text-primary" : "text-chart-4"
                  }`}
                >
                  {msg.text}
                </p>
              ) : null}

              {canSheetImport ? (
                <>
                  <button
                    type="button"
                    className={itemCls}
                    disabled={
                      pending ||
                      (rows ?? []).some((r) => r.subject === subjectKey && r.busy) ||
                      !exportsAllowed
                    }
                    onClick={() => {
                      setMenuOpen(false);
                      setOpenDialog("sheet");
                    }}
                  >
                    <Sheet className="size-3 shrink-0" />
                    {tt("시트에서 가져오기")}</button>
                  {!exportsAllowed ? <Reason text={tt(KIND_EXPORT_TITLE)} /> : null}
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
                  {tt("시트 열기")}</a>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {dialogs}
    </div>
  );
}
