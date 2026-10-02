import { CommandType, IConfigService, IContextService, ICommandService, IUndoRedoService, IUniverInstanceService,
  LocalUndoRedoService, type IUndoRedoItem, type DependencyOverride } from '@univerjs/core';
import type { DraftStore } from './store';

export const workbookId = 'english-lab-p0';
// Replace the workbook history provider, rather than maintaining a shadow native stack.
// Transient text-edit buffers keep their own in-cell undo; accepted workbook commands do not.
export function historyOverride(store: DraftStore, capture: () => void): DependencyOverride {
  return [[IUndoRedoService, {
    deps: [IUniverInstanceService, ICommandService, IContextService, IConfigService],
    useFactory: (instances: IUniverInstanceService, commands: ICommandService, context: IContextService, config: IConfigService) => {
      class Bridge extends LocalUndoRedoService {
        private grouping = 0;
        private pending = false;
        constructor() {
          super(instances, commands, context, config);
          this.disposeWithMe(commands.registerCommand({ id: 'lab.mutation.undo', type: CommandType.MUTATION, handler: () => store.undo() }));
          this.disposeWithMe(commands.registerCommand({ id: 'lab.mutation.redo', type: CommandType.MUTATION, handler: () => store.redo() }));
          this.disposeWithMe({ dispose: store.subscribe(() => this._updateStatus()) });
        }
        override pushUndoRedo(item: IUndoRedoItem) {
          if (item.unitID === workbookId) { if (this.grouping) this.pending = true; else capture(); }
          else super.pushUndoRedo(item);
        }
        override beginUndoRedoGroup(unitId: string, groupId: string, mode: 'replace' | 'append' = 'replace') {
          if (unitId !== workbookId) return super.beginUndoRedoGroup(unitId, groupId, mode);
          this.grouping++; let disposed = false;
          return { dispose: () => {
            if (disposed) return; disposed = true;
            if (--this.grouping === 0 && this.pending) { this.pending = false; capture(); }
          } };
        }
        override __tempBatchingUndoRedo(unitId: string) { return this.beginUndoRedoGroup(unitId, 'p0-batch', 'append'); }
        override getUndoRedoStatus(unitId: string) {
          if (unitId !== workbookId) return super.getUndoRedoStatus(unitId);
          const { undos, redos } = store.getSnapshot(); return { undos, redos };
        }
        protected override _updateStatus() {
          if (instances.getFocusedUnit()?.getUnitId() === workbookId) this._undoRedoStatus$.next(this.getUndoRedoStatus(workbookId));
          else super._updateStatus();
        }
        private isWorkbook() { return instances.getFocusedUnit()?.getUnitId() === workbookId; }
        override pitchTopUndoElement() {
          if (!this.isWorkbook()) return super.pitchTopUndoElement();
          return store.getSnapshot().undos ? { unitID: workbookId, undoMutations: [{ id: 'lab.mutation.undo', params: {} }], redoMutations: [] } : null;
        }
        override pitchTopRedoElement() {
          if (!this.isWorkbook()) return super.pitchTopRedoElement();
          return store.getSnapshot().redos ? { unitID: workbookId, undoMutations: [], redoMutations: [{ id: 'lab.mutation.redo', params: {} }] } : null;
        }
        override popUndoToRedo() { if (!this.isWorkbook()) super.popUndoToRedo(); }
        override popRedoToUndo() { if (!this.isWorkbook()) super.popRedoToUndo(); }
        nativeWorkbookHistorySize() { return this._undoStacks.get(workbookId)?.length ?? 0; }
      }
      return new Bridge();
    },
  }]];
}
