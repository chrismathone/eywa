import { getVideoDriveSettingsView } from "@/features/video-submit/server/drive-settings-actions";
import { VideoDriveForm } from "./video-drive-form";

/**
 * 학원 설정 '연동' → **숙제영상 드라이브** — 이 지점의 숙제 영상(올리기 사이트·ClassNote 수집·직접 제출)이 들어갈 Google Drive 폴더를
 * 지점마다 따로 정한다(원장 2026-10-04). ClassNote 기능이 켜진 지점에만 선다(탭 판정은 `IntegrationsFace`).
 *
 * 🔴 이 카드는 **Drive로 나가는 링크를 만들지 않는다** — 폴더 번호도 화면으로 내려보내지 않고 이름과 상태만 보인다.
 * 🔴 첫 렌더에서 Drive를 부르지 않는다([[#76]]) — 저장된 값만 읽고, 폴더 확인(형식·권한·빈 폴더)은 [확인 후 저장]을 눌렀을 때 서버가 한다.
 * 조회·저장·권한 판정은 서버 한 곳([`drive-settings-actions.ts`](../../../../features/video-submit/server/drive-settings-actions.ts))이 한다
 * — 여기서는 그 결과를 그릴 뿐이다(화면 조건은 게이트가 아니다, [[#77]]).
 */
export async function VideoDriveCard() {
  let view: Awaited<ReturnType<typeof getVideoDriveSettingsView>> | null;
  try {
    view = await getVideoDriveSettingsView();
  } catch {
    view = null;
  }

  return (
    <section className="border-border bg-card space-y-4 rounded-2xl border p-5" aria-label="숙제영상 드라이브">
      <div>
        <h3 className="text-foreground text-sm font-bold">숙제영상 드라이브</h3>
        <p className="text-text-dim mt-1 text-xs break-keep">
          학생이 올린 숙제 영상과 ClassNote에서 모은 숙제 영상을 보관할 Google Drive 폴더를 이 지점 전용으로 정합니다.
        </p>
      </div>
      {view ? (
        <VideoDriveForm
          state={{
            ready: view.setting.ready,
            authReady: view.setting.authReady,
            enabled: view.setting.enabled,
            source: view.setting.source,
            folderName: view.setting.folderName,
            version: view.setting.version,
          }}
          readOnly={view.readOnly}
        />
      ) : (
        <p className="text-danger text-sm">저장 폴더 설정을 읽지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      )}
    </section>
  );
}
