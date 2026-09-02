/**
 * 테스트 보드 `(수학)학원이`에 **센터 교사를 전원 연결**한다 (원장 2026-09-02:
 * *"학원이는 배정 제외하고 classnote에 전부 배정해야돼 … 테스트 공지 등을 확인하기 위해서"*).
 *
 * 🔴 **해제는 REST에 없다** — `/api/v1/employments/{id}/` DELETE는 405, 교사 제거 라우트는 404
 *    (docs/classnote-integration.md §3). 되돌리려면 ClassNote UI에서 사람이 손으로 뺀다.
 *    그래서 ① 드라이런이 기본 ② `--canary`로 1명 먼저 ③ 매 건 뒤 재조회로 확인한다.
 *
 * 🔴 **쓰기는 `POST /api/v1/employments/ {teacher, class_in_charge}` 한 가지만 쓴다**(한 건 추가).
 *    ⚠️ 필드 이름은 **`class_in_charge`다** — 문서에 오래 적혀 있던 `belong_to_class`(학생 배정
 *    `enrollments`의 필드를 미검증으로 옮겨 적은 것)는 **HTTP 500**을 낸다(2026-09-02 실측:
 *    `{}`→400 `teacher_required` · `{teacher}`→500 · `{teacher, belong_to_class}`→500 ·
 *    `{teacher, class_in_charge}`→**201**). ⚠️ 교사 프로필 화면이 쓰는
 *    `POST /v1_2/teachers/{id}/employments {teacher, class_in_charge:[...]}`는 **배열을 통째로 보내는**
 *    모양이라 그 교사의 다른 보드를 지울 수 있다 — 쓰지 말 것.
 *
 * ⚠️ 이름이 `.`인 계정은 사람이 아니라 잔재라 제외한다(`--include-placeholder`로만 포함).
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/assign-hakwoni-teachers.mjs            # 드라이런
 *   node --env-file=.env.local scripts/_classnote/assign-hakwoni-teachers.mjs --canary --apply
 *   node --env-file=.env.local scripts/_classnote/assign-hakwoni-teachers.mjs --apply
 */
import { fetchAllDrf, fetchBoards, fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";

const BOARD_NAME = "(수학)학원이";
const APPLY = process.argv.includes("--apply");
const CANARY = process.argv.includes("--canary");
const INCLUDE_PLACEHOLDER = process.argv.includes("--include-placeholder");
/** 사람 이름이 아닌 계정(가입 잔재) — 실제로 로그인해 보는 사람이 아니라 테스트 대상이 아니다. */
const isPlaceholderName = (n) => !n || n.trim() === "." || n.trim() === "-";

const browser = await launchAdminBrowser({ headed: false });
try {
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const board = (await fetchBoards(page, centerId)).find((b) => b.name === BOARD_NAME);
  if (!board) throw new Error(`보드 '${BOARD_NAME}'를 찾지 못했습니다`);

  const readEmployments = () =>
    page.evaluate(async (c) => {
      const r = await fetch(`/api/v1_2/centers/${c}/employments`, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("employments " + r.status);
      return r.json();
    }, centerId);

  const before = await readEmployments();
  const teachers = await fetchAllDrf(page, `/api/v1_2/centers/${centerId}/teachers`);
  const onBoard = new Set(before.filter((e) => e.class_in_charge === board.id).map((e) => e.teacher_id));
  /** 그 교사가 지금 들고 있는 보드 수 — 쓰기 뒤 **줄지 않았는지** 확인하는 기준선. */
  const boardCount = (list, id) => list.filter((e) => e.teacher_id === id).length;

  let targets = teachers.filter((t) => !onBoard.has(t.id));
  if (!INCLUDE_PLACEHOLDER) targets = targets.filter((t) => !isPlaceholderName(t.name));
  if (CANARY) targets = targets.slice(0, 1);

  console.log(`보드 ${board.name}(id ${board.id}) · 센터 교사 ${teachers.length}명 · 이미 연결 ${onBoard.size}명`);
  console.log(`${APPLY ? (CANARY ? "카나리 1명" : "전체") + " 연결" : "[드라이런] 연결 예정"}: ${targets.length}명`);
  for (const t of targets) console.log(`  · ${t.name} (teacher ${t.id}, 현재 보드 ${boardCount(before, t.id)}개)`);
  if (!APPLY) {
    console.log("\n--apply 를 줘야 실제로 연결됩니다. 되돌리기는 ClassNote UI 수동뿐입니다.");
  } else {
    for (const t of targets) {
      const res = await page.evaluate(
        async ([teacher, cls]) => {
          const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "";
          const r = await fetch("/api/v1/employments/", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json", "x-csrftoken": csrf },
            body: JSON.stringify({ teacher, class_in_charge: cls }),
          });
          return { status: r.status, body: (await r.text()).slice(0, 200) };
        },
        [t.id, board.id],
      );
      console.log(`  ${t.name}: HTTP ${res.status} ${res.status >= 300 ? res.body : ""}`);
    }
    // 🔴 재조회로 **더해졌는지 + 남의 보드가 안 줄었는지** 둘 다 본다(배열 교체형 API 사고 방지).
    const after = await readEmployments();
    const nowOn = new Set(after.filter((e) => e.class_in_charge === board.id).map((e) => e.teacher_id));
    console.log(`\n확인: 보드 연결 교사 ${onBoard.size} → ${nowOn.size}명`);
    for (const t of targets) {
      const b = boardCount(before, t.id);
      const a = boardCount(after, t.id);
      const ok = nowOn.has(t.id) && a >= b;
      console.log(`  ${ok ? "✅" : "🔴"} ${t.name}: 보드 ${b} → ${a}${nowOn.has(t.id) ? "" : " (연결 안 됨)"}`);
    }
  }
} finally {
  await browser.close();
}
