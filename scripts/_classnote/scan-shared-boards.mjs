/**
 * scripts/_classnote/scan-shared-boards.mjs — 공유 보드(한 보드에 2가족+) 상시 감시 스캔. **READ-ONLY**.
 *
 * 배경(2026-07-15 실사고): `(수학)박서준` 보드에 초6·중3 **두 가족**이 함께 연결돼 초6 보고서가 중3 가족에게
 * 노출되고 있었다. aywa DB엔 보드 멤버십이 없어(ClassNote 쪽 상태) 앱에서는 절대 안 보인다 → 이 스캔이
 * 유일한 사전 관측 수단. 발송 워커의 프리플라이트 게이트(board-safety.mjs)가 실제 차단을 담당하고,
 * 이 스캔은 **차단당할 보드를 미리 보여주고 원장 조치(제거 또는 발송 예외 등재)를 유도**한다.
 *
 * 판정: 연결 가족 2+ = 위험. 단 학원설정 `report.classnoteSharedBoardAllowlist`에 등재된 보드는 원장이
 * 확인한 '같은 학생 다계정'이라 발송 허용(=게이트 통과) → 목록에서 [예외 허용]으로 표시.
 * ⚠️ "2가족=오발송"이 항상 참은 아니다 — 학생 본인+학부모가 각자 가입한 정상 케이스가 있다(안은지 실사례).
 * 구분은 **연락처**로만 가능한데 ClassNote API가 전화를 안 줘서 사람이 운영관리 화면에서 대조해야 한다.
 *
 * 실행: node --env-file=.env.local scripts/_classnote/scan-shared-boards.mjs [--json]
 * 아무것도 변경하지 않는다(조회 전용).
 */
import postgres from "postgres";
import { resolveTenant, getClassnoteBoardAllowlist } from "./classnote-core.mjs";
import {
  launchAdminBrowser,
  loginClassnote,
  fetchCenterId,
  fetchBoards,
  fetchBoardChildren,
} from "./classnote-admin-core.mjs";
import { normBoard } from "./board-safety.mjs";

const JSON_OUT = process.argv.includes("--json");
const STUDENT_BOARD = /^\((수학|영어)\)/;

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchAdminBrowser();
const page = await browser.newPage();
try {
  const tenant = await resolveTenant(sql);
  const allowlist = await getClassnoteBoardAllowlist(sql, tenant);
  const allowSet = new Set(allowlist.map(normBoard));

  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);
  // ⚠️ 인원 미확인(children=null)도 **반드시 포함**한다. 예전엔 `(b.children ?? 0) > 1`이라 모름이 0으로
  // 뭉개져 스캔에서 빠졌는데, 하필 게이트(board-safety)도 같은 식을 써서 **둘이 동시에 실명**했다
  // (게이트는 전부 통과 + 스캔은 "공유 보드 0개" = 모든 지표 초록). 상관 실패라 교차검증이 안 된다.
  const studentBoards = boards.filter((b) => STUDENT_BOARD.test(b.name));
  const unknown = studentBoards.filter((b) => b.children == null);
  if (unknown.length)
    console.warn(
      `⚠️ 연결 가족 수를 못 읽은 보드 ${unknown.length}개 — ClassNote API 변경 의심(발송 게이트도 이 보드들을 보류합니다). 예: ${unknown
        .slice(0, 3)
        .map((b) => b.name)
        .join(", ")}`,
    );
  const shared = studentBoards
    .filter((b) => b.children != null && b.children > 1)
    .sort((a, b) => b.children - a.children);

  const rows = [];
  for (const b of shared) {
    const live = await fetchBoardChildren(page, centerId, b.id).catch(() => null);
    const members = (Array.isArray(live) ? live : []).map((k) => ({
      name: k.name ?? "?",
      birth: k.date_birth ?? null,
    }));
    rows.push({
      board: b.name,
      boardId: b.id,
      families: Array.isArray(live) ? live.length : b.children,
      allowed: allowSet.has(normBoard(b.name)),
      members,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ centerId, total: boards.length, shared: rows }, null, 2));
  } else {
    console.log(`ClassNote 보드 ${boards.length}개 중 학생모드 공유(2가족+) ${rows.length}개\n`);
    if (!rows.length) console.log("  ✅ 공유 보드 없음 — 모든 학생모드 보드가 1가족 이하");
    for (const r of rows) {
      const tag = r.allowed ? "🟢 발송 예외 허용(원장 확인함)" : "⛔ 발송 보류 대상(게이트가 차단)";
      console.log(`${tag}  ${r.board}  — 연결 가족 ${r.families} (boardId=${r.boardId})`);
      for (const m of r.members) console.log(`      · ${m.name} (${m.birth ?? "생일?"})`);
    }
    const blocked = rows.filter((r) => !r.allowed);
    if (blocked.length) {
      console.log(`\n조치 필요 ${blocked.length}건 — 클래스노트 **운영관리 > 학생관리**에서 보드를 골라 연락처·보호자 확인:`);
      console.log("  · 같은 학생의 학부모/본인 계정이면 → aywa 수업보고서 > 보고서 설정 > '공유 보드 발송 예외'에 보드명 등재");
      console.log("  · 남의 가족이면 → 클래스노트에서 그 가족 연결 제거(API로는 불가, UI에서만)");
    }
  }
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
