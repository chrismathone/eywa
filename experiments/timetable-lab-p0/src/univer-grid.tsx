import { useEffect, useRef } from 'react';
import { createUniver, LocaleType } from '@univerjs/presets';
import { UniverSheetsCorePreset, SetRangeValuesMutation, IEditorBridgeService, ISheetClipboardService } from '@univerjs/preset-sheets-core';
import coreKo from '@univerjs/preset-sheets-core/locales/ko-KR';
import { CanceledError, ICommandService, IUndoRedoService, type ICellData, type IObjectMatrixPrimitiveType, type IStyleData } from '@univerjs/core';
import '@univerjs/preset-sheets-core/lib/index.css';
import { historyOverride, workbookId } from './univer-history';
import type { DraftStore } from '@/features/timetable-lab/editor/store';
import type { Draft } from '@/features/timetable-lab/editor/model';
import { installNavigation } from './univer-navigation';

const sheetId = 'teacher';
function matrix(draft: Draft): IObjectMatrixPrimitiveType<ICellData> {
  return Object.fromEntries(draft.cells.map((row, r) => [r, Object.fromEntries(row.map((cell, c) => [c, {
    v: cell.text, f: cell.formula ?? null, p: (cell.richText as ICellData['p']) ?? null, t: 1,
    s: { n: { pattern: '@' }, bg: { rgb: r === 0 ? '#eaf0f7' : '#ffffff' }, ...cell.format, bl: cell.bold ? 1 : 0 },
  } satisfies ICellData]))]));
}
export type EngineProbe = { nativeHistory: () => number; select: (range: string) => void; value: (range: string, text: string) => void; bold: (range: string) => void; cell: (range: string) => unknown; undo: () => void };
declare global { interface Window { univerProbe?: EngineProbe } }
export default function UniverGrid({ store, announce }: { store: DraftStore; announce: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let projecting = false;
    let capture = () => {};
    let selectRange: (range: string) => void = () => {};
    let isEditing = () => true;
    const removeNavigation = new URLSearchParams(location.search).has('native') ? () => {} : installNavigation({
      host: container.current, select: range => selectRange(range), isEditing: () => isEditing(),
    });
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.KO_KR, locales: { [LocaleType.KO_KR]: coreKo }, logCommandExecution: false,
      override: historyOverride(store, () => { if (!projecting) capture(); }),
      presets: [UniverSheetsCorePreset({ container: container.current })],
    });
    const book = univerAPI.createWorkbook({ id: workbookId, name: '영어 연습안 · 합성 자료', sheetOrder: [sheetId], sheets: {
      [sheetId]: { id: sheetId, name: '강사 배치', rowCount: 10, columnCount: 6, defaultColumnWidth: 130, defaultRowHeight: 34, cellData: matrix(store.getSnapshot().draft) },
    } });
    const sheet = book.getSheetBySheetId(sheetId)!;
    selectRange = range => sheet.setActiveRange(sheet.getRange(range));
    const commands = univer.__getInjector().get(ICommandService);
    const editor = univer.__getInjector().get(IEditorBridgeService);
    isEditing = () => editor.isVisible().visible;
    const history = univer.__getInjector().get(IUndoRedoService) as IUndoRedoService & { nativeWorkbookHistorySize: () => number };
    capture = () => {
      const snapshot = book.save(), previous = store.getSnapshot().draft;
      const next = structuredClone(previous);
      next.cells = previous.cells.map((row, r) => row.map((old, c) => {
        const cell = snapshot.sheets[sheetId].cellData?.[r]?.[c];
        const style: IStyleData | undefined = (typeof cell?.s === 'string' ? snapshot.styles?.[cell.s] : cell?.s) ?? undefined;
        const text = cell?.p?.body?.dataStream?.replace(/\r\n$/, '') ?? String(cell?.v ?? '');
        // Automatic formula calculation never changes the confirmed schedule value.
        return { text: cell?.f ? old.text : text, formula: cell?.f || undefined, bold: style?.bl === 1,
          format: style ? structuredClone(style) as Record<string, unknown> : undefined,
          richText: cell?.p ? structuredClone(cell.p) as unknown as Record<string, unknown> : undefined };
      }));
      store.commit('시트 편집', next);
    };
    function project() {
      projecting = true;
      try {
        commands.syncExecuteCommand(SetRangeValuesMutation.id, { unitId: workbookId, subUnitId: sheetId, cellValue: matrix(store.getSnapshot().draft), isOverrideStyle: true });
      } finally { projecting = false; }
    }
    const unsubscribe = store.subscribe(project);
    const clipboard = univer.__getInjector().get(ISheetClipboardService).addClipboardHook({
      id: 'lab-fixed-boundary', priority: 1000,
      onBeforePaste: ({ range, unitId, subUnitId }) => {
        const cells = store.getSnapshot().draft.cells;
        if (unitId !== workbookId || subUnitId !== sheetId || range.rows.some(r => r < 0 || r >= cells.length) || range.cols.some(c => c < 0 || c >= cells[0].length)) {
          announce('붙여넣기 범위를 벗어났습니다. 원본은 그대로입니다.'); return false;
        }
        return true;
      },
    });
    // Fixed row bindings are deliberate P0 limits. Never silently let structural edits lose IDs.
    const guard = commands.beforeCommandExecuted(command => {
      if (/^sheet\.command\.(insert-row|insert-col|remove-row|remove-col|move-rows|move-cols|copy-sheet|remove-sheet|insert-sheet|set-worksheet-name|add-worksheet-merge|remove-worksheet-merge)(-|$)/.test(command.id)) {
        announce('행·열·시트 구조 변경은 이 실험의 연결 검증 범위 밖입니다. 내용은 유지됩니다.');
        throw new CanceledError();
      }
    });
    window.univerProbe = {
      nativeHistory: () => history.nativeWorkbookHistorySize(),
      select: range => { sheet.setActiveRange(sheet.getRange(range)); },
      value: (range, text) => { sheet.getRange(range).setValue(text); },
      bold: range => { sheet.getRange(range).setFontWeight('bold'); },
      cell: range => sheet.getRange(range).getCellData(),
      undo: () => { book.undo(); },
    };
    return () => { delete window.univerProbe; removeNavigation(); unsubscribe(); clipboard.dispose(); guard.dispose(); univer.dispose(); };
  }, [store, announce]);
  return <div className="univer-host" ref={container} aria-label="Univer 강사 배치" />;
}
