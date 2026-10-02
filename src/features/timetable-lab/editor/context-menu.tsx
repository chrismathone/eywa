import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MenuItem } from './editor-actions';

export type MenuState = { x: number; y: number; title: string; items: MenuItem[] };
/** 우클릭 메뉴. 화면 밖으로 나가지 않게 자리를 고치고, 바깥 클릭·Esc·스크롤에 닫힌다. 화살표와 Enter로도 고를 수 있다. */
export function ContextMenu({ menu, close }: { menu: MenuState; close: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // 크기를 잰 뒤 화면 안으로 옮긴다(상태로 두면 한 번 더 그리게 되므로 스타일을 직접 고친다).
    const el = root.current!, box = el.getBoundingClientRect(), before = document.activeElement as HTMLElement | null;
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - box.height - 4))}px`;
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    // 닫히면 열기 전에 쓰던 곳(시간표)으로 초점을 돌려 단축키가 이어지게 한다. 메뉴가 연 창은 그 뒤에 스스로 초점을 가져간다.
    return () => { if (before?.isConnected && el.contains(document.activeElement)) before.focus(); };
  }, [menu]);
  useEffect(() => {
    const outside = (e: Event) => { if (!root.current?.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('blur', close);
    window.addEventListener('resize', close); window.addEventListener('wheel', outside, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', close);
      window.removeEventListener('resize', close); window.removeEventListener('wheel', outside, true);
    };
  }, [close]);
  function key(e: React.KeyboardEvent) {
    const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  }
  return <div ref={root} className="lab-menu" role="menu" aria-label={menu.title} style={{ left: menu.x, top: menu.y }} onKeyDown={key} onContextMenu={e => e.preventDefault()}>
    <div className="lab-menu-title">{menu.title}</div>
    {menu.items.map((item, i) => item === null ? <hr key={i} /> : <button key={i} role="menuitem" disabled={item.disabled} className={item.danger ? 'danger' : undefined}
      onClick={() => { close(); item.run(); }}><span>{item.label}</span>{item.hint && <kbd>{item.hint}</kbd>}</button>)}
  </div>;
}
