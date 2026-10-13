import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";

/**
 * 탭·메뉴 아이콘 = **그림 파일**(원장 2026-09-08: *"이미지로 생성했으면 개성있고 특색있는 '이미지' 스타일이여야하잖아
 * — 이모지같은"* → 화풍 시안 네 갈래 중 **B 스티커** 채택).
 *
 * 🔴 여기 쓰이는 그림은 손으로 그린 SVG가 아니라 **이미지 생성으로 만든 PNG**다(codex). 다시 선화 글리프로
 *    되돌리지 말 것 — 그러면 이미지 생성을 쓴 의미가 사라진다(원장이 그 이유로 한 번 반려했다).
 *
 * 범위는 **탭·내부 탭 + 표시 자리**다. 처음엔 탭뿐이었고(원장 2026-09-08 *"탭 및 내부 탭"*), 2026-09-09에
 * *"자체 아이콘 세트도 메뉴 탭 스타일처럼"* · *"우리가 코덱스로 만든 스타일이 있잖아. 그걸로"* 지시로 **빅 스탯
 * 지표 칩**(`<BigStat icon=…>`)까지 넓혔다 — 같은 이름(`users`·`listChecks`)이 사이드바에선 스티커, 지표 칩에선
 * 선화로 보여 "이건 아직 미제작이냐"는 물음이 나왔던 자리다.
 * 🔴 **조작(操作) 자리는 그대로 선화**다 — 버튼 안 보조 아이콘·툴바 글리프·입력 안 아이콘·상태 배너는
 *    [`EyIcon`](./aywa-icons.tsx). 저장 버튼까지 알록달록한 스티커가 되면 위계가 무너진다(그 판단은 불변).
 * 🔑 가르는 기준은 크기가 아니라 **역할**이다: "무엇에 대한 화면·수치인가"를 가리키면 스티커, "누르면 무슨 일이
 *    일어나는가"를 가리키면 선화.
 *
 * ⚠️ 색이 그림에 박혀 있어 `className`의 글자색(`text-white` 등)을 **따라가지 않는다**. 채택한 스티커 화풍은
 *    굵은 흰 테두리를 둘러 남색 활성 배경 위에서도 형태가 분리돼 읽힌다(시안 검수에서 확인한 채택 근거).
 * ⚠️ 그림이 없는 이름은 조용히 깨진 이미지가 되지 않게 **선화로 폴백**한다(가드 `menu-glyph.test.ts`가
 *    탭 아이콘 전부에 파일이 있는지 잠근다).
 */

/** `public/icons/<name>.png`가 실제로 있는 이름 — 가드가 파일 목록과 대조한다. */
export const MENU_GLYPH_NAMES = new Set<string>([
  "alarm", "alert", "archive", "bellRing", "book", "bookMarked",
  "bus", "busStop", "calendar", "calendarCheck", "chart", "check",
  "clipboardCheck", "clipboardList", "clock", "eraser", "exam", "folder",
  "formInput", "gauge", "graduationCap", "help", "history", "invoice",
  "key", "layoutGrid", "listChecks", "mail", "mapPin", "megaphone",
  "messages", "note", "palette", "percent", "receipt", "report",
  "screen", "scrollText", "seatGrid", "settings", "sheetColumns", "sheetRows",
  "shield", "sparkle", "spreadsheet", "star", "steering", "sync",
  "tablet", "tag", "trash", "undo", "userCheck", "userMinus",
  "userPlus", "userSettings", "userX", "users", "wallet", "weekGrid",
  "wrench",
]);

export function hasMenuGlyph(name: string): boolean {
  return MENU_GLYPH_NAMES.has(name);
}

export function MenuGlyph({
  name,
  size = 18,
  className,
}: {
  name: AywaIconName;
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
