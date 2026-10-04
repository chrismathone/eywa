"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveVideoDriveSetting } from "@/features/video-submit/server/drive-settings-actions";

/** 서버가 읽은 설정 중 화면에 필요한 것만 — 🔴 폴더 번호는 받지 않는다(이 화면에서 Drive 주소를 만들 길을 두지 않는다). */
export type VideoDriveFormState = {
  /** 설정을 저장할 준비가 됐나 — 아니면 지금 쓰는 폴더만 보이고 바꿀 수 없다. */
  ready: boolean;
  /** 영상을 저장하는 연동 계정이 연결돼 있나 — 아니면 새 폴더를 확인할 수 없다(해제는 된다). */
  authReady: boolean;
  enabled: boolean;
  source: "saved" | "legacy" | "none";
  folderName: string | null;
  /** 저장할 때 함께 보내는 값 — 그사이 다른 화면에서 바뀌었으면 서버가 거절한다. */
  version: string | null;
};

const SAVE_FAILED = "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const DISCONNECT_CONFIRM =
  "저장 폴더 연결을 해제할까요?\n해제하면 이 지점은 숙제 영상을 새로 받지 않습니다. 이미 보관된 영상은 그대로 볼 수 있고, 올리는 중이던 영상은 끝까지 올라갑니다.";

/** 지금 상태 한 줄 — 폴더 이름과 상태만(링크 없음). */
function CurrentFolder({ state }: { state: VideoDriveFormState }) {
  if (state.enabled)
    return (
      <div className="border-line rounded-lg border px-3 py-2">
        <p className="text-text-dim text-xs">현재 저장 폴더</p>
        <p className="text-foreground mt-0.5 text-sm font-bold break-all">{state.folderName ?? (state.source === "legacy" ? "기존에 연결된 폴더" : "지정된 폴더")}</p>
        {state.source === "legacy" ? (
          <p className="text-text-dim mt-1 text-xs break-keep">처음부터 쓰던 폴더입니다. 다른 폴더로 바꾸려면 아래에서 새 폴더를 저장하세요.</p>
        ) : null}
      </div>
    );
  return (
    <p className="bg-bg-soft text-foreground rounded-lg px-3 py-2 text-sm break-keep">
      {state.source === "saved"
        ? "저장 폴더 연결이 해제되어 있습니다. 숙제 영상을 받지 않습니다 — 폴더를 저장하면 다시 받습니다."
        : "아직 저장 폴더가 없습니다. 폴더를 저장하면 숙제 영상을 받기 시작합니다."}
    </p>
  );
}

/**
 * 숙제영상 저장 폴더 폼 — 폴더 주소(또는 폴더 번호)를 붙여 넣고 [확인 후 저장]. 서버가 폴더·권한·빈 폴더·다른 지점과의 겹침을 확인한 뒤 저장한다.
 * 액션을 직접 부른다(`<form action>` 아님) — React 19의 폼 자동 리셋으로 입력이 지워지거나 옛 값으로 굳지 않게([[#83]]).
 * 실패 문구는 서버가 준 한글 한 줄만 보인다(원문·주소·계정 정보는 오지 않는다). 예기치 못한 실패도 한글 한 줄로 받는다.
 */
export function VideoDriveForm({ state, readOnly }: { state: VideoDriveFormState; readOnly: boolean }) {
  const inputId = useId();
  const [folder, setFolder] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    <div className="space-y-4">
      <CurrentFolder state={state} />
      {readOnly ? (
        <p className="text-text-dim text-sm break-keep">저장 폴더는 연동 설정을 바꿀 수 있는 계정만 변경할 수 있습니다.</p>
      ) : !state.ready ? (
        <p className="text-text-dim text-sm break-keep">저장 폴더 설정을 아직 준비 중입니다. 준비되면 여기서 폴더를 바꿀 수 있습니다.</p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (folder.trim() && state.authReady) run("save");
          }}
        >
          <label htmlFor={inputId} className="text-foreground block text-sm font-bold">
            {state.enabled ? "다른 폴더로 바꾸기" : "저장 폴더 정하기"}
            <span className="text-text-dim ml-2 text-xs font-normal">Google Drive 폴더 주소 또는 폴더 번호</span>
          </label>
          {!state.authReady ? (
            <p className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm break-keep">
              영상을 저장하는 연동 계정이 아직 준비되지 않아 새 폴더를 저장할 수 없습니다.
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
              disabled={pending || !state.authReady}
              className="border-line bg-bg-soft focus:border-primary h-(--control-h) min-w-64 flex-1 rounded-lg border px-2.5 text-sm outline-none disabled:opacity-60"
            />
            <Button type="submit" disabled={pending || !folder.trim() || !state.authReady}>
              {pending ? "확인하는 중…" : "확인 후 저장"}
            </Button>
            {state.enabled ? (
              <Button type="button" variant="outline" disabled={pending} onClick={() => window.confirm(DISCONNECT_CONFIRM) && run("disconnect")}>
                연결 해제
              </Button>
            ) : null}
          </div>
        </form>
      )}
      {error ? <p className="text-danger text-sm font-bold break-keep" role="alert">{error}</p> : null}
      {message ? <p className="text-primary text-sm font-bold break-keep" role="status">{message}</p> : null}
      <ul className="text-text-dim list-disc space-y-1 pl-5 text-xs break-keep">
        <li>새로 정하는 폴더는 <strong className="text-foreground">비어 있어야</strong> 합니다. 이 지점이 전에 쓰던 폴더는 그대로 다시 정할 수 있습니다.</li>
        <li>영상을 저장하는 연동 계정이 그 폴더에 <strong className="text-foreground">파일을 추가할 수 있어야</strong> 합니다 — 폴더를 연동 계정에 &lsquo;편집자&rsquo;로 공유해 주세요.</li>
        <li>다른 지점이 쓰는 폴더와 그 위·아래 폴더는 정할 수 없습니다.</li>
        <li>폴더를 바꿔도 이미 보관된 영상은 옮겨지지 않고 지금처럼 재생됩니다. 올리는 중이던 영상은 처음 폴더에 마무리됩니다.</li>
        <li>영상은 보는 사람의 Google 계정 권한으로 열립니다 — 영상을 볼 선생님에게 그 폴더 보기 권한을 주세요.</li>
      </ul>
    </div>
  );
}
