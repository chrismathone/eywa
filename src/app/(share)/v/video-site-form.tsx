"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  isLast4, isSiteName, SITE_BRANCH_STORAGE_KEY,
  type SiteBranch, type SiteBranchNeeded, type SiteChoice, type SiteLookupResult, type SiteOpenResult,
} from "@/features/video-submit/site";
import { SiteAskFields, SiteBranchChooser, SiteHomeworkChoices } from "./video-site-parts";

/** `tenant` = 조회할 때의 지점(하나뿐이면 그 지점에 고정된 값) — 열기는 조회와 **같은 지점**으로 보낸다. */
type Asked = { last4: string; name: string; tenant: string | undefined };
type Phase =
  | { kind: "ask" }
  | { kind: "looking" }
  | { kind: "choose"; asked: Asked; choices: SiteChoice[] }
  | { kind: "opening"; asked: Asked; choices: SiteChoice[]; picked: string };

const NETWORK = "연결이 끊겼습니다. 잠시 후 다시 해 주세요.";

async function post<T>(body: unknown): Promise<T | null> {
  try {
    const res = await fetch("/api/video-submit/site", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// 이 기기에서 마지막으로 고른 지점 — 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에선 그냥 매번 고른다.
const subscribeNever = () => () => {};
const readRemembered = (): string | null => {
  try {
    return window.localStorage.getItem(SITE_BRANCH_STORAGE_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    window.localStorage.setItem(SITE_BRANCH_STORAGE_KEY, id);
  } catch {
    // 못 적어도 이번 화면에서는 고른 지점으로 그대로 간다.
  }
};

/**
 * 숙제 영상 올리기 사이트 — 학생 폰이 기본(한 열·큰 버튼). 뒷 4자리 + 이름 → 선생님이 낸 영상 숙제 고르기 → 제출 화면으로.
 * 원장 2026-10-03: 이름까지 넣어야 반이 보이고, 선생님이 낸 영상 숙제가 있어야 올릴 수 있다(숙제를 골라 올리면 그 숙제에 묶인다).
 * 문구는 전부 한글, 원문 오류는 내보내지 않는다. 이름은 서버가 가운데를 가려 보낸다.
 *
 * 지점(2026-10-04): 주소에는 지점을 넣지 않는다. `branches` = 지금 사이트를 쓸 수 있는 지점.
 *  · 하나뿐이면 묻지 않고 **그 지점에 고정**한다(화면은 지금까지와 같다) — 요청마다 그 지점을 실어 보낸다.
 *  · 여럿이거나 `mustChoose`(판정하지 못한 지점이 있다)면 맨 먼저 지점을 고른다. 고른 지점은 이 기기에 기억해 다음엔 미리 골라 둔다(바꿀 수 있다).
 * 🔴 보낸 지점은 서버가 다시 확인한다. 그 지점이 그사이 꺼졌거나 목록이 바뀌었으면 서버가 `code: "branch"`와 새 목록을 주고,
 *    화면은 **지점 수와 무관하게 다시 고르게 한다** — 남은 지점이 하나뿐이어도 그 지점으로 저절로 옮겨 가지 않는다(다른 학원의 학생을 찾게 된다).
 */
export function VideoSiteForm({ academyName, branches = [], mustChoose = false, maxLabel }: {
  academyName: string; branches?: SiteBranch[]; mustChoose?: boolean; maxLabel: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [digits, setDigits] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // "찾지 못했다"(빨강)와 "올릴 숙제가 없다"(안내)를 가른다 — 숙제가 없는 것은 잘못 넣은 것이 아니다.
  const [notice, setNotice] = useState<string | null>(null);
  const [branchList, setBranchList] = useState<SiteBranch[]>(branches);
  // 서버가 지점을 다시 고르라고 한 뒤로는 지점이 하나만 남아도 직접 고르게 한다(저절로 옮겨 가지 않는다).
  const [forceChoose, setForceChoose] = useState(mustChoose);
  // undefined = 아직 손대지 않았다(기억해 둔 지점을 쓴다) · null = 고르는 중 · 문자열 = 이 화면에서 고른 지점
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  // 기억해 둔 지점은 하이드레이션 뒤에 읽는다(서버 렌더와 첫 클라 렌더가 같아야 한다 — [[#75]]).
  const remembered = useSyncExternalStore(subscribeNever, readRemembered, () => null);
  const choosing = forceChoose || branchList.length > 1;
  // 고르는 화면이 아니면(하나뿐) 그 지점에 고정한다. 고르는 화면이면 고른 지점(없으면 기억해 둔 지점 — 목록에 있을 때만).
  const branch = choosing ? branchList.find((b) => b.id === (picked === undefined ? remembered : picked)) ?? null : branchList[0] ?? null;

  // 제출 화면에서 뒤로 가기로 돌아오면 브라우저가 이 화면을 그대로 되살릴 수 있다(bfcache) — '여는 중…'으로 잠긴 채 남지 않게 처음으로 돌린다.
  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) setPhase({ kind: "ask" });
    };
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);

  function pickBranch(id: string) {
    remember(id);
    setPicked(id);
    setError(null);
    setNotice(null);
  }
  function changeBranch() {
    setPicked(null);
    setError(null);
    setNotice(null);
    setPhase({ kind: "ask" });
  }
  /** 서버가 지점을 다시 고르라고 했다 — 새 목록으로 갈아 끼우고 지점부터 다시(하나만 남았어도 직접 고른다). */
  function branchNeeded(res: SiteBranchNeeded) {
    setBranchList(res.branches);
    setForceChoose(true);
    setPicked(null);
    setNotice(null);
    setError(res.error);
    setPhase({ kind: "ask" });
  }

  async function lookup() {
    if (!isLast4(digits)) {
      setError("휴대폰 번호 뒷 4자리(숫자 4개)를 입력해 주세요.");
      return;
    }
    if (!isSiteName(name)) {
      setError("이름을 두 글자 이상 입력해 주세요.");
      return;
    }
    setError(null);
    setNotice(null);
    setPhase({ kind: "looking" });
    const tenant = branch?.id;
    const res = await post<SiteLookupResult>({ op: "lookup", last4: digits, name, tenant });
    if (!res || !res.ok) {
      if (res?.code === "branch") return branchNeeded(res);
      if (res?.code === "no_homework") setNotice(res.error);
      else setError(res ? res.error : NETWORK);
      setPhase({ kind: "ask" });
      return;
    }
    setPhase({ kind: "choose", asked: { last4: digits, name, tenant }, choices: res.choices });
  }

  async function open(asked: Asked, choices: SiteChoice[], id: string) {
    setError(null);
    setPhase({ kind: "opening", asked, choices, picked: id });
    const res = await post<SiteOpenResult>({ op: "open", last4: asked.last4, name: asked.name, choice: id, tenant: asked.tenant });
    if (!res || !res.ok) {
      if (res?.code === "branch") return branchNeeded(res);
      setError(res ? res.error : NETWORK);
      // 숙제가 더는 맞지 않는다(날짜가 바뀌었거나 그사이 냈거나 명단이 달라짐) — 낡은 목록을 다시 누르게 두지 않고 처음으로 돌린다.
      setPhase(res && res.code === "invalid" ? { kind: "ask" } : { kind: "choose", asked, choices });
      return;
    }
    // 제출 화면으로 — 문서 이동(뒤로 가기로 이 화면에 돌아오면 처음부터 다시 한다).
    window.location.assign(res.url);
  }

  const clear = () => { setError(null); setNotice(null); };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pt-8 pb-8 lg:pb-10">
      <header className="space-y-1">
        <p className="text-text-dim text-sm">{choosing ? branch?.name ?? academyName : academyName}</p>
        <h1 className="text-foreground text-2xl font-bold">숙제 영상 올리기</h1>
      </header>
      <section className="bg-card border-line space-y-4 rounded-2xl border p-5">
        {choosing && !branch ? (
          <SiteBranchChooser branches={branchList} onPick={pickBranch} />
        ) : phase.kind === "ask" || phase.kind === "looking" ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
            <SiteAskFields
              digits={digits} name={name} looking={phase.kind === "looking"} maxLabel={maxLabel}
              branchName={choosing && branch ? branch.name : null}
              onDigits={(value) => { setDigits(value); clear(); }}
              onName={(value) => { setName(value); clear(); }}
              onChangeBranch={changeBranch}
            />
          </form>
        ) : (
          <SiteHomeworkChoices
            choices={phase.choices} openingId={phase.kind === "opening" ? phase.picked : null}
            onOpen={(id) => void open(phase.asked, phase.choices, id)}
            onReset={() => { setPhase({ kind: "ask" }); clear(); }}
          />
        )}
        {notice ? <p className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm break-keep" role="status">{notice}</p> : null}
        {error ? <p className="text-danger text-sm font-bold break-keep" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
