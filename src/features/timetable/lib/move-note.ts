/**
 * **'이동 대기'(예약된 반 이동) 툴팁 문구** — 순수 함수 단일 소스.
 *
 * 원장 2026-09-09: *"대신 이렇게 '반이동 대기'일 경우에 툴팁에 기존 반이름도 나와있어야함."*
 * 그래서 출발·도착 어느 쪽 줄에 붙든 **기존 반 이름이 반드시 들어간다**(도착 반 대기 칸에 낯선 이름이
 * 앉아 있을 때 "지금 어느 반 학생인가"가 곧 알고 싶은 것이다).
 *
 * 🔴 **저장 전(큐)과 예약(저장됨)을 문구로 가른다** — 색만 같고 뜻이 다르다:
 *    저장 전은 이 브라우저에만 있고 '취소'로 사라지지만, 예약은 DB에 들어가 그날 저절로 일어난다.
 *    화면에서 안 갈리면 "저장한 줄 알았는데 아니었다"가 조용히 생긴다.
 * ⚠️ 화면 파일에서 문장을 새로 조립하지 말 것 — 같은 사실이 자리마다 다르게 적히면 그게 곧 거짓말이다.
 */

/** `2026-09-15` → `9월 15일`. 형식이 아니면 원문 그대로(모르면 지어내지 않는다). */
export function koreanMonthDay(date: string | null | undefined): string {
  if (!date) return "";
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : date;
}

export type MoveNoteInput = {
  /** 나가는 쪽 줄이면 `out`, 들어올 쪽(도착 반 대기 칸) 줄이면 `in`. */
  side: "out" | "in";
  /** 지금 다니는 반(=기존 반) 이름 — 원장 지시로 **양쪽 모두** 여기에 담는다. */
  fromClassName: string;
  /** 가게 될 반 이름. */
  toClassName: string;
  /** 적용일(`YYYY-MM-DD`). 없으면 날짜 없이 적는다(모르는 것을 지어내지 않는다). */
  on: string | null | undefined;
  /**
   * DB에 예약으로 들어가 있나 — `false`면 아직 이 브라우저의 큐일 뿐이라 '저장'을 눌러야 한다.
   */
  saved: boolean;
};

/** 툴팁 한 줄 — 색(연보라)이 상태를 말하고, 이 문장이 사실을 말한다. */
export function moveWaitTitle(input: MoveNoteInput): string {
  const { side, fromClassName, toClassName, on, saved } = input;
  const from = fromClassName || "지금 반";
  const to = toClassName || "다른 반";
  const when = koreanMonthDay(on);
  const head = saved ? "이동 대기" : "이동 대기(저장 전)";
  const body =
    side === "out"
      ? `${when ? `${when}부터 ` : ""}${to} 반으로 이동합니다`
      : `${when ? `${when}부터 ` : ""}${to} 반으로 옵니다`;
  const tail = `기존 반: ${from}`;
  const note = saved ? "" : " · '저장'을 눌러야 반영됩니다";
  return `${head} — ${body} · ${tail}${note}`;
}

/** 저장된 예약 이동 한 건(상대 반 이름은 화면 밖이면 null). */
export type SavedScheduledMove = { on: string; className: string | null };

/**
 * 한 줄에 붙일 **예약 이동 표시**를 고른다 — 나가는 쪽/들어오는 쪽 중 무엇을 말할지의 단일 규칙.
 *
 * 🔴 한 수강이 **둘 다** 걸릴 수 있다(9/12에 들어와 9/20에 또 나가는 연속 이동) — 그때 무엇을 말할지는
 *    그 줄이 지금 **어느 칸에 서 있는가**로 정한다: 아직 안 들어온 줄(대기)은 '들어옴'이 사건이고,
 *    이미 다니는 줄(재원)은 '나감'이 사건이다. 규칙을 화면마다 다시 쓰면 같은 학생이 뷰마다 달라진다.
 * 🔴 퇴원 줄엔 아무것도 안 붙인다 — 끝난 기록에 "곧 옮겨 갑니다"는 거짓이다(서버도 안 실어 보낸다).
 */
export function savedMoveView(input: {
  status?: "active" | "hold" | "withdrawn";
  movingOut?: SavedScheduledMove | null;
  movingIn?: SavedScheduledMove | null;
  /** 이 줄이 서 있는 반 이름(툴팁의 '기존 반'·'가는 반' 한쪽을 채운다). */
  thisClassName: string;
}): { side: "out" | "in"; on: string; title: string } | null {
  const { status, movingOut, movingIn, thisClassName } = input;
  if (status === "withdrawn") return null;
  const pickIn = status === "hold" && movingIn;
  const chosen = pickIn ? movingIn : (movingOut ?? movingIn);
  if (!chosen) return null;
  const side: "out" | "in" = chosen === movingIn ? "in" : "out";
  return {
    side,
    on: chosen.on,
    title: moveWaitTitle({
      side,
      // 나가는 쪽 줄은 **자기 반**이 기존 반이고, 들어오는 쪽 줄은 **상대 반**이 기존 반이다.
      fromClassName: side === "out" ? thisClassName : (chosen.className ?? "다른 반"),
      toClassName: side === "out" ? (chosen.className ?? "다른 반") : thisClassName,
      on: chosen.on,
      saved: true,
    }),
  };
}
