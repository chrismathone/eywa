import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";

/**
 * 탭·메뉴 아이콘 = **그림 파일**(원장 2026-09-08: *"이미지로 생성했으면 개성있고 특색있는 '이미지' 스타일이여야하잖아
 * — 이모지같은"* → 화풍 시안 네 갈래 중 **B 스티커** 채택).
 *
 * 🔴 여기 쓰이는 그림은 손으로 그린 SVG가 아니라 **이미지 생성으로 만든 PNG**다(codex). 다시 선화 글리프로
 *    되돌리지 말 것 — 그러면 이미지 생성을 쓴 의미가 사라진다(원장이 그 이유로 한 번 반려했다).
 *
 * 범위는 **탭과 내부 탭뿐**이다(원장 지시 *"탭 및 내부 탭"*) — 사이드바 업무군·메뉴 버튼·강사 '내 메뉴'.
 * 버튼 안 보조 아이콘·툴바 글리프는 그대로 [`EyIcon`](./eywa-icons.tsx) 선화를 쓴다.
 * 🔴 앱 전체 아이콘을 이걸로 갈아치우지 말 것 — 저장 버튼까지 알록달록한 스티커가 되면 위계가 무너진다.
 *
 * ⚠️ 색이 그림에 박혀 있어 `className`의 글자색(`text-white` 등)을 **따라가지 않는다**. 채택한 스티커 화풍은
 *    굵은 흰 테두리를 둘러 남색 활성 배경 위에서도 형태가 분리돼 읽힌다(시안 검수에서 확인한 채택 근거).
 * ⚠️ 그림이 없는 이름은 조용히 깨진 이미지가 되지 않게 **선화로 폴백**한다(가드 `menu-glyph.test.ts`가
 *    탭 아이콘 전부에 파일이 있는지 잠근다).
 */

/** `public/icons/<name>.png`가 실제로 있는 이름 — 가드가 파일 목록과 대조한다. */
export const MENU_GLYPH_NAMES = new Set<string>([
  "archive", "bellRing", "book", "bookMarked", "bus", "busStop",
  "calendar", "clipboardCheck", "clipboardList", "clock", "eraser", "exam",
  "folder", "formInput", "graduationCap", "help", "history", "invoice",
  "key", "layoutGrid", "listChecks", "mapPin", "megaphone", "messages",
  "note", "palette", "receipt", "report", "screen", "scrollText",
  "seatGrid", "settings", "sheetColumns", "sheetRows", "shield", "spreadsheet",
  "star", "steering", "sync", "tablet", "tag", "undo",
  "userCheck", "userMinus", "userPlus", "userSettings", "users", "wallet",
  "weekGrid", "wrench",
]);

export function hasMenuGlyph(name: string): boolean {
  return MENU_GLYPH_NAMES.has(name);
}

export function MenuGlyph({
  name,
  size = 18,
  className,
}: {
  name: EywaIconName;
  size?: number;
  className?: string;
}) {
  if (!hasMenuGlyph(name)) return <EyIcon name={name} size={size} strokeWidth={1.8} className={className} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 고정 크기 장식 아이콘이라 next/image의 최적화가 이득이 없다.
    <img
      src={`/icons/${name}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={className}
    />
  );
}
