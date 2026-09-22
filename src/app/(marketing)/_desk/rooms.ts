import type { AywaIconName } from "@/components/icons/aywa-icons";
import { CLASSES, DATES, DAYS } from "./data";

/** 모형 그림 위 방 점 좌표(그림 기준 %) — Blender 렌더(c5)의 핫스팟 값 그대로. */
export const HOTSPOTS = {
  office: [44.7, 23.63], classA: [34.83, 48.15], classB: [54.07, 52.17], desk: [42.55, 70.72], shuttle: [73.09, 76.45],
} as const;
export type RoomId = keyof typeof HOTSPOTS;
/** 모형 그림 폭/높이(1500×1706). */
export const MODEL_ASPECT = 1500 / 1706;

export type WinType =
  | "brief" | "staff" | "meet" | "att" | "tt" | "classes" | "os" | "sheet"
  | "enroll" | "students" | "stu" | "cons" | "billing" | "wd" | "bus" | "help";

export const ROOMS: Record<RoomId, { fl: string; name: string; menus: WinType[]; side: "l" | "r" }> = {
  office: { fl: "3F", name: "원장실", menus: ["brief", "staff", "meet"], side: "r" },
  classA: { fl: "2F", name: "수학 교실", menus: ["att", "tt", "classes"], side: "l" },
  classB: { fl: "2F", name: "영어 교실", menus: ["os", "sheet"], side: "r" },
  desk: { fl: "1F", name: "데스크", menus: ["enroll", "students", "cons", "billing", "wd"], side: "l" },
  shuttle: { fl: "앞", name: "앞마당", menus: ["bus"], side: "r" },
};
export const ROOM_ORDER: RoomId[] = ["office", "classA", "classB", "desk", "shuttle"];

type Meta = { room: RoomId | null; label: string; icon: AywaIconName; size: [number, number]; sub: string };
export const WIN_META: Record<WinType, Meta> = {
  brief: { room: "office", label: "운영실", icon: "layoutGrid", size: [400, 600], sub: "오늘" },
  staff: { room: "office", label: "직원관리", icon: "userSettings", size: [400, 320], sub: "재직 6명" },
  meet: { room: "office", label: "회의록", icon: "note", size: [400, 420], sub: "주간 운영 회의" },
  att: { room: "classA", label: "출석부", icon: "clipboardCheck", size: [440, 360], sub: "" },
  tt: { room: "classA", label: "시간표", icon: "weekGrid", size: [480, 340], sub: "9월 4주" },
  classes: { room: "classA", label: "수업목록", icon: "book", size: [450, 300], sub: "운영 중 6개" },
  os: { room: "classB", label: "원스크린", icon: "screen", size: [440, 430], sub: "초6 영어 · 9월 22일" },
  sheet: { room: "classB", label: "강사 시트", icon: "sheetColumns", size: [460, 330], sub: "중등 영어 B · 9월 4주" },
  enroll: { room: "desk", label: "콜&상담", icon: "userPlus", size: [470, 300], sub: "9월" },
  students: { room: "desk", label: "원생목록", icon: "users", size: [430, 400], sub: "재원 12명" },
  stu: { room: "desk", label: "원생 정보", icon: "users", size: [380, 400], sub: "" },
  cons: { room: "desk", label: "원생상담", icon: "messages", size: [460, 440], sub: "녹음 · AI 분석" },
  billing: { room: "desk", label: "수납관리", icon: "wallet", size: [440, 390], sub: "2026년 9월" },
  wd: { room: "desk", label: "퇴원관리", icon: "userMinus", size: [420, 250], sub: "이번 달" },
  bus: { room: "shuttle", label: "셔틀 등하원", icon: "bus", size: [370, 370], sub: "오늘" },
  help: { room: null, label: "도움말", icon: "help", size: [380, 400], sub: "이 모형 쓰는 법" },
};

export const winTitle = (type: WinType) => (type === "sheet" ? "영어 강사 시트" : WIN_META[type].label);

/** 출석부 인자 = "반@요일칸". */
export function parseAtt(arg: string | null) {
  const [k, d] = String(arg ?? "m2a@1").split("@");
  return { k: CLASSES[k] ? k : "m2a", d: Number(d) || 0 };
}
export function winSub(type: WinType, arg: string | null) {
  if (type === "att") { const x = parseAtt(arg); return `${CLASSES[x.k].name} · ${DATES[x.d]} (${DAYS[x.d]})`; }
  if (type === "stu") return arg ?? "";
  return WIN_META[type].sub;
}
export const winId = (type: WinType, arg: string | null) => (arg != null ? `${type}:${arg}` : type);
