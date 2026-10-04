"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { VIDEO_OAUTH_CHANNEL, VIDEO_OAUTH_MESSAGE_TYPE, VIDEO_OAUTH_START_PATH } from "@/features/video-submit/drive-oauth-shared";

/** 서버가 읽은 설정 중 화면에 필요한 것만 — 🔴 연결 번호·토큰은 받지 않는다(이메일과 상태뿐). */
export type VideoDriveAccountState = {
  /** 계정 연결을 받을 준비가 됐나(DB·앱 설정 모두) — 아니면 '준비 중'만 보인다. */
  ready: boolean;
  email: string | null;
  /** 연결한 계정의 상태 — 연결이 없으면 null. */
  status: "ready" | "needs_reauth" | null;
  /** 지금 이 지점이 숙제 영상을 받고 있나 — 계정을 바꾸면 새 폴더를 정할 때까지 멈추므로 미리 알린다. */
  receiving: boolean;
  /** 시작할 때 함께 보내는 설정 버전 — 그사이 다른 화면에서 바뀌었으면 서버가 거절한다. */
  version: string | null;
};

const SWITCH_CONFIRM =
  "다른 Google 계정으로 바꿀까요?\n다른 계정으로 로그인하면 새 저장 폴더를 정할 때까지 이 지점은 숙제 영상을 새로 받지 않습니다. 이미 보관된 영상은 그대로 볼 수 있고, 올리는 중이던 영상은 처음 계정으로 끝까지 올라갑니다.";
const FIRST_CONFIRM =
  "이 지점의 Google 계정을 연결할까요?\n연결하면 새 저장 폴더를 정할 때까지 이 지점은 숙제 영상을 새로 받지 않습니다. 지금 폴더에 보관된 영상은 그대로 볼 수 있고, 올리는 중이던 영상은 끝까지 올라갑니다.";

/**
 * 숙제영상 드라이브 — **이 지점의 Google 계정**. 계정 이메일·상태를 보이고, 로그인은 새 탭에서 한다
 * (버튼 = 새 탭으로 POST하는 폼. 창 모드의 iframe 안에서는 Google 화면이 열리지 않는다).
 * '다시 연결'은 지금 계정 그대로, '다른 계정으로 바꾸기'는 확인을 받은 뒤에만 시작한다 — 실수로 계정이 바뀌어 접수가 멈추지 않게.
 * 새 탭이 끝나면 결과 화면이 신호를 보내고(같은 출처에서만 들린다) 이 화면이 스스로 새로 읽는다. 신호를 못 받아도 돌아오면 새로 읽는다.
 */
export function VideoDriveAccount({ state, readOnly }: { state: VideoDriveAccountState; readOnly: boolean }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(false);
  const [result, setResult] = useState<"connected" | "failed" | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(VIDEO_OAUTH_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ type?: unknown; status?: unknown } | null>) => {
      if (event.data?.type !== VIDEO_OAUTH_MESSAGE_TYPE) return;
      setWaiting(false);
      setResult(event.data.status === "connected" ? "connected" : "failed");
      router.refresh();
    };
    return () => channel.close();
  }, [router]);

  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting, router]);

  const start = (confirmText: string | null) => (event: FormEvent<HTMLFormElement>) => {
    if (confirmText && !window.confirm(confirmText)) {
      event.preventDefault();
      return;
    }
    setResult(null);
    setWaiting(true);
  };
  const connected = state.status !== null;
  const switchConfirm = connected ? SWITCH_CONFIRM : state.receiving ? FIRST_CONFIRM : null;

  return (
    <div className="space-y-2">
      <p className="text-foreground text-sm font-bold">Google 계정</p>
      {connected ? (
        <div className="border-line flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-text-dim text-xs">연결된 계정</p>
            <p className="text-foreground mt-0.5 text-sm font-bold break-all">{state.email ?? "연결된 Google 계정"}</p>
          </div>
          <Pill color={TONE_COLOR[state.status === "ready" ? "positive" : "critical"]}>{state.status === "ready" ? "정상" : "다시 연결 필요"}</Pill>
        </div>
      ) : (
        <p className="bg-bg-soft text-foreground rounded-lg px-3 py-2 text-sm break-keep">
          아직 이 지점의 Google 계정을 연결하지 않았습니다. 이 지점 전용 Google 계정으로 로그인하면 그 계정의 Drive에 숙제 영상을 보관합니다.
        </p>
      )}
      {state.status === "needs_reauth" ? (
        <p className="bg-danger-soft text-danger rounded-lg px-3 py-2 text-sm break-keep">
          Google이 이 연결을 더는 받지 않습니다. &lsquo;다시 연결&rsquo;을 눌러 같은 계정으로 다시 로그인해 주세요. 그동안 이 지점은 숙제 영상을 새로 받지 않습니다.
        </p>
      ) : null}
      {readOnly ? null : !state.ready ? (
        <p className="text-text-dim text-sm break-keep">Google 계정 연결을 아직 준비 중입니다. 준비되면 여기서 이 지점의 계정을 연결할 수 있습니다.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <form method="post" action={VIDEO_OAUTH_START_PATH} target="_blank" onSubmit={start(null)}>
              <input type="hidden" name="intent" value="reconnect" />
              <input type="hidden" name="version" value={state.version ?? ""} />
              <Button type="submit">다시 연결</Button>
            </form>
          ) : null}
          <form method="post" action={VIDEO_OAUTH_START_PATH} target="_blank" onSubmit={start(switchConfirm)}>
            <input type="hidden" name="intent" value="switch" />
            <input type="hidden" name="version" value={state.version ?? ""} />
            <Button type="submit" variant={connected ? "outline" : "default"}>{connected ? "다른 계정으로 바꾸기" : "Google 계정 연결"}</Button>
          </form>
        </div>
      )}
      {waiting ? <p className="text-text-dim text-sm break-keep" role="status">새 창에서 Google 로그인을 마치면 이 화면이 바뀝니다.</p> : null}
      {result === "connected" ? <p className="text-primary text-sm font-bold break-keep" role="status">Google 계정을 연결했습니다. 아래에서 저장 폴더를 확인해 주세요.</p> : null}
      {result === "failed" ? <p className="text-danger text-sm font-bold break-keep" role="alert">연결을 마치지 못했습니다. 새 창의 안내를 확인한 뒤 다시 시도해 주세요.</p> : null}
    </div>
  );
}
