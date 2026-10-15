import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS } from "@/components/workspace/window-signals-core";
import { parseStudentListPrefs } from "@/features/students/list/list-prefs";
import { parseClassListPrefs } from "@/features/classes/list-prefs";
import { parseStaffListPrefs } from "@/features/staff/list/list-prefs";
import {
  FILTER_RESET_AFTER_MS,
  FILTER_SCREENS,
  FILTER_SEEN_KEEP_SEC,
  SAVED_FILTER_KEYS,
  filterScreenOf,
  isFilterSeenFresh,
  parseFilterSeen,
  serializeFilterSeen,
} from "./rules";

// 원장 2026-10-15 *"필터는 10분이상 페이지 재접속하지 않으면 리셋되도록"* · *"다른 필터들도 같은 방식 적용"*.
describe("필터 10분 초기화 — 규칙", () => {
  it("10분은 숨은 화면 새로고침(STALE_AFTER_MS)과 같은 값이다 — 두 번 정하지 않는다", () => {
    expect(FILTER_RESET_AFTER_MS).toBe(10 * 60 * 1000);
    expect(FILTER_RESET_AFTER_MS).toBe(STALE_AFTER_MS);
  });

  it("마지막으로 본 시각 쿠키 — 읽고 쓰기 · 깨진 조각은 버린다 · 하루 넘은 칸은 떨군다", () => {
    expect(parseFilterSeen("students:1760000000~ecs:1760000100")).toEqual({ students: 1760000000, ecs: 1760000100 });
    expect(parseFilterSeen(encodeURIComponent("students:1760000000"))).toEqual({ students: 1760000000 });
    expect(parseFilterSeen("bad~Students:1~x:-1~y:1.5~:3~z:abc~ok:0")).toEqual({ ok: 0 });
    expect(parseFilterSeen(undefined)).toEqual({});
    const now = 1760000000;
    const text = serializeFilterSeen({ students: now - 10, old: now - FILTER_SEEN_KEEP_SEC - 1 }, now);
    expect(text).toBe(`students:${now - 10}`);
    // 쿠키 값 문법에 안전한 문자만
    expect(text).not.toMatch(/[,; ]/);
    expect(parseFilterSeen(text)).toEqual({ students: now - 10 });
  });

  it("10분 안에 봤으면 그대로 · 넘었거나 기록 없음·0이면 기본값", () => {
    const now = Date.UTC(2026, 9, 15, 4, 0, 0);
    const sec = (ms: number) => Math.floor(ms / 1000);
    expect(isFilterSeenFresh(sec(now - 60_000), now)).toBe(true);
    expect(isFilterSeenFresh(sec(now - FILTER_RESET_AFTER_MS), now)).toBe(true);
    expect(isFilterSeenFresh(sec(now - FILTER_RESET_AFTER_MS - 1000), now)).toBe(false);
    expect(isFilterSeenFresh(undefined, now)).toBe(false);
    expect(isFilterSeenFresh(0, now)).toBe(false);
  });

  it("🔴 '본 것'을 적는 화면 = 계정에 필터를 저장하는 화면과 정확히 같다(새로 열 때 걸러지는 곳만 적는다)", () => {
    const saved = new Set(Object.values(SAVED_FILTER_KEYS).map((v) => v.screen));
    expect(new Set(FILTER_SCREENS.map((s) => s.key))).toEqual(saved);
  });

  it("화면 찾기 — 목록 본체만(상세 화면은 아니다) · 영어 시트는 아래 화면 전부", () => {
    expect(filterScreenOf("/students")?.key).toBe("students");
    expect(filterScreenOf("/students/abc")).toBeNull();
    expect(filterScreenOf("/ecs")?.key).toBe("ecs");
    expect(filterScreenOf("/ecs/abc/month")?.key).toBe("ecs");
    expect(filterScreenOf("/ecsx")).toBeNull();
    expect(filterScreenOf("/dashboard")).toBeNull();
    expect(filterScreenOf(null)).toBeNull();
  });

  it("🔴 화면 키는 겹치지 않고 쿠키에 쓸 수 있는 글자만", () => {
    const keys = FILTER_SCREENS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]+$/);
  });

  it("🔴 저장 필터 이름공간은 화면 표에 있고, 필터 키는 그 화면 파서가 아는 키다(정렬·보기 키는 넣지 않는다)", () => {
    for (const { screen } of Object.values(SAVED_FILTER_KEYS)) expect(FILTER_SCREENS.map((s) => s.key)).toContain(screen);
    const parsers: Record<string, unknown> = {
      students: parseStudentListPrefs(undefined),
      classes: parseClassListPrefs(undefined),
      staff: parseStaffListPrefs(undefined),
    };
    for (const [ns, parsed] of Object.entries(parsers)) {
      for (const key of SAVED_FILTER_KEYS[ns as keyof typeof SAVED_FILTER_KEYS].keys) expect(parsed, `${ns}.${key}`).toHaveProperty(key);
      expect(SAVED_FILTER_KEYS[ns as keyof typeof SAVED_FILTER_KEYS].keys).not.toContain("sort");
    }
  });

  it("🔴 저장 필터 이름공간마다 그 값을 읽는 서버 코드가 10분 규칙을 지난다", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(readFileSync(p, "utf8"));
      }
    };
    walk(join(process.cwd(), "src"));
    const all = files.join("\n");
    for (const ns of Object.keys(SAVED_FILTER_KEYS)) {
      expect(all, ns).toMatch(new RegExp(`fresh(SavedFilters|RawUiPrefs)\\(\\s*"${ns}"`));
    }
  });
});
