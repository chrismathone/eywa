"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveVideoDriveSetting } from "@/features/video-submit/server/drive-settings-actions";

/** 서버가 읽은 설정 중 화면에 필요한 것만 — 🔴 폴더 번호는 받지 않는다(이 화면에서 Drive 주소를 만들 길을 두지 않는다). */
export type VideoDriveFormState = {
  /** 설정을 저장할 준비가 됐나 — 아니면 지금 쓰는 폴더만 보이고 바꿀 수 없다. */
  ready: boolean;
  /** 이 지점이 연결한 Google 계정 — `ready`일 때만 새 폴더를 정할 수 있다(그 계정으로 폴더를 확인한다). 해제는 언제든 된다. */
  account: "none" | "ready" | "needs_reauth";
  enabled: boolean;
  source: "saved" | "legacy" | "none";
  folderName: string | null;
  /** 저장할 때 함께 보내는 값 — 그사이 다른 화면에서 바뀌었으면 서버가 거절한다. */
  version: string | null;
};

const SAVE_FAILED = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const DISCONNECT_CONFIRM =
  "연결을 해제할까요?\n해제하면 이 지점은 숙제 영상을 새로 받지 않습니다. 이미 보관된 영상은 그대로 볼 수 있고, 올리는 중이던 영상은 끝까지 올라갑니다.\nGoogle 계정에 남은 앱 권한은 Google 계정 설정에서 직접 지울 수 있습니다.";
/** 처음부터 쓰던 폴더는 해제하면 같은 방식으로 되돌릴 수 없다 — 다시 받으려면 계정을 연결해야 한다는 것을 먼저 알린다. */
const LEGACY_DISCONNECT_CONFIRM =
  "지금 쓰는 저장 폴더 연결을 해제할까요?\n해제하면 이 지점은 숙제 영상을 새로 받지 않습니다. 다시 받으려면 Google 계정을 연결하고 새 저장 폴더를 정해야 합니다.\n이미 보관된 영상은 그대로 볼 수 있고, 올리는 중이던 영상은 끝까지 올라갑니다.";

/** 지금 상태 한 줄 — 폴더 이름과 상태만(링크 없음). */
function CurrentFolder({ state }: { state: VideoDriveFormState }) {
  if (state.enabled)
    return (
      <div className="border-line rounded-lg border px-3 py-2">
        <p className="text-text-dim text-xs">현재 저장 폴더</p>
        <p className="text-foreground mt-0.5 text-sm font-bold break-all">{state.folderName ?? (state.source === "legacy" ? "기존에 연결된 폴더" : "지정된 폴더")}</p>
        {state.source === "legacy" ? (
          <p className="text-text-dim mt-1 text-xs break-keep">처음부터 쓰던 폴더입니다. 다른 폴더로 바꾸려면 위에서 이 지점의 Google 계정을 연결한 뒤 새 폴더를 저장하세요.</p>
        ) : null}
      </div>
    );
  return (
    <p className="bg-bg-soft text-foreground rounded-lg px-3 py-2 text-sm break-keep">
      {state.account !== "none"
        ? "아직 저장 폴더가 없습니다. 폴더를 저장하면 연결한 계정으로 숙제 영상을 받기 시작합니다."
        : state.source === "saved"
          ? "저장 폴더 연결이 해제되어 있습니다. 숙제 영상을 받지 않습니다 — Google 계정을 연결하고 폴더를 저장하면 다시 받습니다."
          : "아직 저장 폴더가 없습니다. Google 계정을 연결하고 폴더를 저장하면 숙제 영상을 받기 시작합니다."}
    </p>
  );
}

/**
 * 숙제영상 저장 폴더 폼 — 폴더 주소(또는 폴더 번호)를 붙여 넣고 [확인 후 저장]. 서버가 **연결한 Google 계정으로** 폴더·권한·빈 폴더·
 * 다른 지점과의 겹침을 확인한 뒤 저장한다. 계정을 연결하기 전에는 폴더를 정할 수 없다(해제는 된다).
 * 액션을 직접 부른다(`<form action>` 아님) — React 19의 폼 자동 리셋으로 입력이 지워지거나 옛 값으로 굳지 않게([[#83]]).
 * 실패 문구는 서버가 준 한글 한 줄만 보인다(원문·주소·계정 정보는 오지 않는다). 예기치 못한 실패도 한글 한 줄로 받는다.
 */
export function VideoDriveForm({ state, readOnly }: { state: VideoDriveFormState; readOnly: boolean }) {
  const inputId = useId();
  const [folder, setFolder] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canSave = state.account === "ready";

  const run = (intent: "save" | "disconnect") => {
    if (pending || readOnly) return;
    setError(null);
    setMessage(null);
    const form = new FormData();
    form.set("folder", intent === "save" ? folder.trim() : "");
    form.set("version", state.version ?? "");
    form.set("intent", intent);
    start(async () => {
      try {
        const result = await saveVideoDriveSetting(undefined, form);
        if (result.ok) {
          setFolder("");
          setMessage(intent === "save" ? "저장 폴더를 저장했습니다. 지금부터 올라오는 영상은 이 폴더에 보관됩니다." : "저장 폴더 연결을 해제했습니다.");
        } else setError(result.error ?? SAVE_FAILED);
      } catch {
        setError(SAVE_FAILED);
      }
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm font-bold">저장 폴더</p>
      <CurrentFolder state={state} />
      {readOnly ? (
        <p className="text-text-dim text-sm break-keep">Google 계정과 저장 폴더는 연동 설정을 바꿀 수 있는 계정만 변경할 수 있습니다.</p>
      ) : !state.ready ? (
        <p className="text-text-dim text-sm break-keep">저장 폴더 설정을 아직 준비 중입니다. 준비되면 여기서 폴더를 바꿀 수 있습니다.</p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (folder.trim() && canSave) run("save");
          }}
        >
          <label htmlFor={inputId} className="text-foreground block text-sm font-bold">
            {state.enabled ? "다른 폴더로 바꾸기" : "저장 폴더 정하기"}
            <span className="text-text-dim ml-2 text-xs font-normal">Google Drive 폴더 주소 또는 폴더 번호</span>
          </label>
          {!canSave ? (
            <p className="bg-bg-soft text-foreground rounded-lg px-3 py-2 text-sm break-keep">
              {state.account === "needs_reauth" ? "Google 계정을 다시 연결하면 저장 폴더를 정할 수 있습니다." : "위에서 Google 계정을 연결하면 저장 폴더를 정할 수 있습니다."}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value);
                setError(null);
              }}
              placeholder="폴더 주소를 붙여 넣으세요"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              maxLength={300}
              disabled={pending || !canSave}
              className="border-line bg-bg-soft focus:border-primary h-(--control-h) min-w-64 flex-1 rounded-lg border px-2.5 text-sm outline-none disabled:opacity-60"
            />
            <Button type="submit" disabled={pending || !folder.trim() || !canSave}>
              {pending ? "확인하는 중…" : "확인 후 저장"}
            </Button>
            {state.enabled || state.account !== "none" ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => window.confirm(state.source === "legacy" ? LEGACY_DISCONNECT_CONFIRM : DISCONNECT_CONFIRM) && run("disconnect")}
              >
                연결 해제
              </Button>
            ) : null}
          </div>
        </form>
      )}
      {error ? <p className="text-danger text-sm font-bold break-keep" role="alert">{error}</p> : null}
      {message ? <p className="text-primary text-sm font-bold break-keep" role="status">{message}</p> : null}
      <ul className="text-text-dim list-disc space-y-1 pl-5 text-xs break-keep">
        <li>새로 정하는 폴더는 <strong className="text-foreground">비어 있어야</strong> 합니다. 이 지점이 같은 계정으로 전에 쓰던 폴더는 그대로 다시 정할 수 있습니다.</li>
        <li>폴더는 <strong className="text-foreground">연결한 Google 계정의 내 드라이브 안</strong>에 있어야 합니다 — 다른 계정이 공유해 준 폴더는 쓸 수 없습니다.</li>
        <li>다른 지점이 쓰는 폴더와 그 위·아래 폴더는 정할 수 없습니다.</li>
        <li>폴더를 바꿔도 이미 보관된 영상은 옮겨지지 않고 지금처럼 재생됩니다. 올리는 중이던 영상은 처음 폴더에 마무리됩니다.</li>
        <li>영상은 보는 사람의 Google 계정 권한으로 열립니다 — 영상을 볼 선생님에게 그 폴더 보기 권한을 주세요.</li>
      </ul>
    </div>
  );
}
