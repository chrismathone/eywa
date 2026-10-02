type Options = { host: HTMLElement; select: (range: string) => void; isEditing: () => boolean };
/** Google Sheets PC Ctrl+Home. Text-edit buffers retain native navigation. */
export function installNavigation({ host, select, isEditing }: Options) {
  const focusGrid = () => {
    const canvases = Array.from(host.querySelectorAll('canvas'));
    canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !host.contains(target)) return;
    const gridFocus = target instanceof HTMLCanvasElement || target.matches('[data-u-comp="editor"][id$="DOCS_NORMAL"]');
    if (gridFocus && !isEditing() && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Home') {
      event.preventDefault(); event.stopImmediatePropagation(); select('A1'); focusGrid();
    }
  };
  // Univer also handles keys during capture. Register before the engine, scoped to this host.
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
