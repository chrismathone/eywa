import { z } from "zod";

/**
 * 오늘 수학 지점 사용 메뉴 — 에이와 원장이 보는 · 바꾸는 값의 모양(원장 2026-10-19 *"이 On/off 토글은 에이와<->오늘 수학 연동되게"*).
 * 저장은 오늘 수학 한 곳(`branch.owner_disabled_menus`)이고 에이와는 서명 통로(`/api/integrations/eywa/v2/branch-menus`)로
 * 읽고 쓴다 — 에이와에 사본을 두지 않으니 두 화면이 어긋날 수 없다. 오늘 수학 최고관리자가 열지 않은 메뉴(`open:false`)는 켤 수 없다.
 * 순수 모듈(클라이언트도 타입·계산을 쓴다).
 */
const itemSchema = z.object({
  menu: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  product: z.enum(["math", "english"]),
  open: z.boolean(),
  on: z.boolean(),
});
export const todaysMathMenusSchema = z.object({
  revision: z.number().int().positive(),
  items: z.array(itemSchema).max(60),
});
export type TodaysMathMenus = z.infer<typeof todaysMathMenusSchema>;
export type TodaysMathMenuItem = z.infer<typeof itemSchema>;

export const todaysMathMenusWriteReplySchema = z.discriminatedUnion("ok", [
  todaysMathMenusSchema.extend({ ok: z.literal(true), changed: z.boolean() }),
  z.object({ ok: z.literal(false), code: z.enum(["NOT_FOUND", "CONFLICT", "MENU_NOT_OPEN"]) }),
]);

export const TODAYS_MATH_PRODUCTS = [
  { id: "math", label: "오늘 수학" },
  { id: "english", label: "오늘 영어" },
] as const;

/** 감사 기록의 '켠 것 · 끈 것' — 저장 전 값과 저장 후 값의 차이(이름으로). 순수 함수. */
export function menuDiff(before: readonly TodaysMathMenuItem[], after: readonly TodaysMathMenuItem[]) {
  const was = new Set(before.filter((i) => i.on).map((i) => i.menu));
  const now = new Set(after.filter((i) => i.on).map((i) => i.menu));
  return {
    turnedOn: after.filter((i) => now.has(i.menu) && !was.has(i.menu)).map((i) => i.label),
    turnedOff: after.filter((i) => was.has(i.menu) && !now.has(i.menu)).map((i) => i.label),
  };
}
