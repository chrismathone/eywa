/**
 * **수업목록 '요일' 열의 조회 규약** — 청크로 나누는 것만으론 모자라고 **청크 안에서 페이징**해야 한다.
 *
 * 2026-09-07 실사고(원장 제보 *"이 반은 왜 스케줄이 안나와?"* — 중등E_중2 정규 B):
 * `class_schedules`는 운영 이력을 함께 담아 반 하나가 12행씩 갖는다([[#88]]). 100반 청크가
 * **1,042행**을 요청했는데 PostgREST는 1,000행에서 **에러 없이 잘랐고**([[#54]]), 꼬리에 걸린 반은
 * 슬롯이 한 행도 안 와서 요일 칸이 `—`가 됐다. 반 상세엔 화·금이 멀쩡히 떠 있어 "화면마다 다른 사실"이
 * 됐고, RLS가 붙는 로그인 세션과 service_role의 실행 계획이 달라 **누가 잘리는지도 사람마다 달랐다**.
 *
 * 🔴 청크 크기를 줄이는 건 답이 아니다 — 이 표는 시간표 가져오기마다 행이 늘어난다(행 분할 이력).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const queries = strip(read("src", "features", "classes", "server", "queries.ts"));

/**
 * `.from("class_schedules")`마다 **뒤로 훑어 그 조회를 감싼 헬퍼**를 찾는다.
 * ⚠️ "헬퍼에서 다음 헬퍼까지"로 자르면 안 된다 — 사이에 낀 남의 코드가 딸려 들어와, `users`를 읽는
 *    조회가 뒤쪽 `class_schedules` 문자열을 품고 요일 조회인 척한다(가드가 거짓 실패했다).
 */
function scheduleReads(src: string): { helper: string; body: string }[] {
  const out: { helper: string; body: string }[] = [];
  const NEEDLE = '.from("class_schedules")';
  for (let at = src.indexOf(NEEDLE); at >= 0; at = src.indexOf(NEEDLE, at + 1)) {
    const before = src.slice(0, at);
    const owner = Math.max(before.lastIndexOf("fetchAllPagedInChunks<"), before.lastIndexOf("fetchInChunks<"));
    // 헬퍼가 멀리 있으면 이 조회는 그 안이 아니다(청크를 안 쓰는 단건·전건 조회) — 이 가드 밖.
    if (owner < 0 || at - owner > 400) continue;
    // ⚠️ 창은 **다음 class_schedules 조회 앞에서 끊는다** — 안 그러면 남의 select 문자열을 주워
    //    엉뚱한 조회가 요일 조회로 잡힌다(실제로 3건이 됐다).
    const next = src.indexOf(NEEDLE, at + 1);
    const end = Math.min(at + 600, next < 0 ? src.length : next);
    out.push({
      helper: before.lastIndexOf("fetchAllPagedInChunks<") > before.lastIndexOf("fetchInChunks<")
        ? "fetchAllPagedInChunks"
        : "fetchInChunks",
      body: src.slice(owner, end),
    });
  }
  return out;
}

/**
 * 요일 칩의 재료를 읽는 조회 — select 문자열로 정확히 집는다.
 * ⚠️ 강의실 자동배정(`class_id, day_of_week, start_time, end_time`)은 **일부러 뺐다** — 만료 행을
 *    서버에서 걸러 2026-09-07 실측 569행이라 청크당 1000행과 거리가 멀다. 그 조회가 이력까지 받도록
 *    바뀌면 그때 여기 포함할 것.
 */
const dayReads = scheduleReads(queries).filter((c) =>
  c.body.includes('"class_id, day_of_week, start_time, valid_from, valid_to"'),
);

describe("🔴 요일 조회는 청크 안에서도 페이징한다", () => {
  it("요일 칩 재료를 읽는 조회가 실제로 둘 있다(가드가 헛돌지 않게)", () => {
    // getClassesList · getClassesPage — 같은 화면의 두 진입점이라 규약도 같아야 한다.
    expect(dayReads.length).toBe(2);
  });

  it("페이징 헬퍼로 전건을 받는다 — 페이징 없는 fetchInChunks로 되돌리지 말 것", () => {
    for (const c of dayReads) expect(c.helper).toBe("fetchAllPagedInChunks");
  });

  it(".range(from, to)로 페이지를 실제로 넘긴다", () => {
    for (const c of dayReads) expect(c.body).toContain(".range(from, to)");
  });

  it("페이지 경계가 흔들리지 않게 유일 키로 정렬한다 — 정렬 없는 .range는 겹치거나 빈다", () => {
    for (const c of dayReads) {
      expect(c.body).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
    }
  });

  it("⚠️ 유효 기간으로 걸러 행 수를 줄이는 우회 금지 — 종강 반은 요일이 통째로 사라진다", () => {
    // 이 조회는 만료 행까지 받아야 한다(`daysStale`로 흐리게 보여 주는 폴백의 재료).
    for (const c of dayReads) expect(c.body).not.toContain("valid_to.gte.");
  });
});
