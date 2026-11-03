// 운영관리 명부(`admissioninfos`) 해석 — 해제·배정·퇴원처리가 같은 줄을 서로 다른 뜻으로 센다(2026-11-03 리뷰 A2·B3·B5·B7·B9).
// page.evaluate에 넘긴 함수를 그대로 돌리고 fetch만 갈아 끼운다(브라우저 없이).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdmissions } from "./math-class-boards-load.mjs";

const page = { evaluate: (fn, arg) => fn(arg) };
function serve(rows) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ results: rows }) };
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("fetchAdmissions — 명부 한 줄의 뜻", () => {
  const row = (over = {}) => ({
    child_id: 7,
    basic_info: { child_name: "이지나", carer1_phone: "010-1000-0000", carer2_phone: "010-2000-0000", carer3_phone: "", child_date_birth: "2014-01-01" },
    enrollments: [
      { belong_to_class: 900, class_name: "[ALL] 인재원 전체방", is_approved: true, date_left: null },
      { belong_to_class: 905, class_name: "중등M 중2 B", is_approved: false, date_left: null }, // 승인 대기
      { belong_to_class: 906, class_name: "영어 그룹", is_approved: null, date_left: null }, // 승인 미정
      { belong_to_class: 907, class_name: "지난 반", is_approved: true, date_left: "2026-10-01" }, // 떠남
    ],
    ...over,
  });
  it("🔴 해제 쪽 '남는 배정'(boards) = 승인된 것만 · 퇴원처리 쪽 '막는 배정'(allBoards) = 안 떠난 것 전부(승인 대기·미정 포함) · 캐시 없이 읽는다", async () => {
    const calls = serve([row()]);
    const a = (await fetchAdmissions(page, 1)).get(7);
    expect(a.boards).toEqual([{ id: 900, name: "[ALL] 인재원 전체방" }]);
    expect(a.allBoards.map((b) => [b.id, b.approved])).toEqual([[900, true], [905, false], [906, false]]);
    expect(a.boardNames).toEqual(["[ALL] 인재원 전체방", "중등M 중2 B", "영어 그룹"]);
    expect(calls[0].init.cache).toBe("no-store");
  });
  it("🔴 보호자 전화 = carer 전화 전부(빈 칸은 뺀다) · 예전 칸 `phone`(carer1)은 그대로", async () => {
    serve([row()]);
    const a = (await fetchAdmissions(page, 1)).get(7);
    expect(a.phones).toEqual(["010-1000-0000", "010-2000-0000"]);
    expect(a.phone).toBe("010-1000-0000");
  });
  it("🔴 안 떠난 줄 중 보드 번호(belong_to_class)가 없는 줄이 있으면 보드 번호 목록만 모른다(boards·allBoards null · R6) — 보드 이름 목록은 그대로(2차 리뷰 F1) · 떠난 줄은 상관없다", async () => {
    const live = row();
    live.enrollments = [...live.enrollments, { class_name: "칸이 바뀐 반", is_approved: true, date_left: null }];
    const gone = { ...row(), child_id: 8 };
    gone.enrollments = [...gone.enrollments, { class_name: "떠난 반", is_approved: true, date_left: "2026-09-01" }];
    serve([live, gone]);
    const all = await fetchAdmissions(page, 1);
    expect(all.get(7)).toMatchObject({ boards: null, allBoards: null });
    expect(all.get(7).boardNames).toEqual(["[ALL] 인재원 전체방", "중등M 중2 B", "영어 그룹", "칸이 바뀐 반"]);
    expect(all.get(8).boards).toEqual([{ id: 900, name: "[ALL] 인재원 전체방" }]);
  });
  it("🔴 배정 칸이 배열이 아니면 소속을 **모른다**(null) — 빈 목록으로 두면 가드가 조용히 꺼진다", async () => {
    serve([row({ enrollments: undefined }), { ...row({ enrollments: "x" }), child_id: 8 }]);
    const all = await fetchAdmissions(page, 1);
    for (const id of [7, 8]) expect(all.get(id)).toMatchObject({ boards: null, allBoards: null, boardNames: null });
  });
});
