import { afterEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({setting:{enabled:true,rootId:"DB_TENANT_ROOT"},folder:vi.fn()}));
vi.mock("./video-drive-settings.mjs",()=>({loadWorkerVideoDriveSetting:async()=>m.setting}));
vi.mock("./video-drive.mjs",()=>({checkDriveFolder:m.folder}));
import {checkConfiguredVideoDrive} from "./check-video-drive.mjs";
afterEach(()=>{vi.unstubAllEnvs();m.folder.mockReset();});
describe("PC 인증 점검의 실제 지점 폴더 배선",()=>{
  it("환경 폴더가 달라도 DB에서 지정한 지점 폴더를 검사한다",async()=>{
    vi.stubEnv("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID","OBSOLETE_ENV_ROOT");
    m.setting={enabled:true,rootId:"DB_TENANT_ROOT"};
    const auth={accessToken:vi.fn()};
    expect(await checkConfiguredVideoDrive({},"tenant",{auth})).toBe("folder");
    expect(m.folder).toHaveBeenCalledWith("DB_TENANT_ROOT",auth);
  });
  it("연결 해제 때는 남아 있는 환경 폴더로 돌아가지 않고 인증만 검사한다",async()=>{
    vi.stubEnv("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID","OBSOLETE_ENV_ROOT");
    m.setting={enabled:false,rootId:null};
    const auth={accessToken:vi.fn().mockResolvedValue("token")};
    expect(await checkConfiguredVideoDrive({},"tenant",{auth})).toBe("auth");
    expect(m.folder).not.toHaveBeenCalled();expect(auth.accessToken).toHaveBeenCalledOnce();
  });
  it("저장 폴더 설정을 확인하지 못하면 인증 성공으로 끝내지 않는다",async()=>{
    m.setting={enabled:false,rootId:null,source:"unknown",error:true};
    const auth={accessToken:vi.fn()};
    await expect(checkConfiguredVideoDrive({},"tenant",{auth})).rejects.toThrow("영상 저장 폴더 설정을 확인하지 못했습니다.");
    expect(m.folder).not.toHaveBeenCalled();
    expect(auth.accessToken).not.toHaveBeenCalled();
  });
});
