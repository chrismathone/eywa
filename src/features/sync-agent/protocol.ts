import { z } from "zod";

export const AGENT_PROTOCOL = 1;
export const AGENT_VERSION = "1.0.3";
export const UUID = z.string().uuid();
export const Version = z.string().regex(/^\d+\.\d+\.\d+$/).max(32);
export const MODULES = ["classnote", "makeedu"] as const;
export type AgentModule = typeof MODULES[number];
export const CodeInput = z.string().transform((s) => s.replace(/[\s-]/g, "")).pipe(z.string().regex(/^\d{12}$/));
export const PairInput = z.object({ code: CodeInput, deviceId: UUID, secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/), name: z.string().trim().min(1).max(80) }).strict();
export const StatusInput = z.object({
  state: z.enum(["ready", "paused", "working", "offline", "attention", "updating"]),
  classnote: z.enum(["off", "waiting", "running", "draining", "error"]),
  makeedu: z.enum(["off", "waiting", "running", "draining", "error"]),
  update: z.enum(["idle", "downloading", "ready", "applying", "rollback", "error"]),
  busy: z.boolean(),
}).strict();
export const LeaseInput = z.object({ instanceId: UUID, version: Version }).strict();
export const BeatInput = LeaseInput.extend({ generation: z.string().regex(/^[1-9]\d{0,17}$/), status: StatusInput }).strict();
export const EventKind = z.enum(["app_started", "app_stopped", "paired", "paused", "resumed", "lease_lost", "connection_lost", "connection_restored", "module_started", "module_stopped", "module_failed", "module_retry", "job_started", "job_succeeded", "job_failed", "update_available", "update_downloaded", "update_applied", "update_failed", "update_rollback", "legacy_detected", "logs_dropped", "credentials_needed"]);
export const TASK_LABELS = {queue:"보고서 발송",notice:"개별 공지",classNotice:"반 공지",recall:"발송 회수",autoSync:"반 자동 동기화",syncNow:"지금 동기화",parentReply:"학부모 답장",parentReaction:"학부모 반응",provision:"신입 준비",classBoardSync:"반 보드",childmap:"학생 연결",posts:"학부모 게시글",comments:"학부모 댓글",reads:"읽음 확인",roster:"반 명단",video:"영상 보관",sync:"정기 동기화",login:"로그인 점검",push:"상담 전송"} as const;
export const TaskKind=z.enum(Object.keys(TASK_LABELS) as [keyof typeof TASK_LABELS,...Array<keyof typeof TASK_LABELS>]);
export const LOG_CODE_LABELS = {
  makeedu_sync_started:"메이크에듀 동기화 시작",makeedu_sync_complete:"동기화 처리 완료 · 실패 없음",makeedu_sync_partial:"동기화 일부 항목 확인 필요",
  makeedu_students:"학생 동기화 처리 중",makeedu_classes:"반 동기화 처리 중",makeedu_prospects:"예비 상담 동기화 처리 중",makeedu_invoices:"수납 동기화 처리 중",
  makeedu_textbook_checks:"교재 체크 처리 중",makeedu_staff_attendance:"직원 출퇴근 처리 중",makeedu_consultations:"재원 상담 동기화 처리 중",login_ok:"메이크에듀 로그인 확인 완료",
  status_failed:"실행 상태 기록 실패",result_failed:"동기화 완료 기록 저장 실패",poll_failed:"작업 조회 실패 · 다음 주기에 재확인",
  launcher_updated:"실행기를 새 판으로 바꿈",launcher_update_failed:"실행기 교체 실패 · 업데이트 때 따로 둔 새 실행기로 넘김",launcher_handover:"새 실행기로 넘겨 새 버전 시작",
} as const;
export const LogCode=z.enum(Object.keys(LOG_CODE_LABELS) as [keyof typeof LOG_CODE_LABELS,...Array<keyof typeof LOG_CODE_LABELS>]);
export const UPDATE_ERROR_LABELS = {
  manifest_failed:"버전 정보를 확인하지 못했습니다. 서버 연결 후 다시 확인해 주세요.",
  download_failed:"설치 파일을 받지 못했습니다. 인터넷 연결 후 다시 확인해 주세요.",
  download_timeout:"파일 수신이 멈추었거나 제한 시간을 넘었습니다. 새 버전 확인으로 다시 시도해 주세요.",
  disk_full:"설치 준비 공간이 부족합니다. C 드라이브의 여유 공간을 확보해 주세요.",
  files_locked:"업데이트 파일에 접근하지 못했습니다. 파일 권한과 보안 프로그램의 차단 기록을 확인해 주세요.",
  archive_invalid:"파일 검증에 실패했습니다. 새 버전 확인으로 다시 받아 주세요.",
  extract_failed:"압축을 풀지 못했습니다. 디스크 상태를 확인하고 다시 시도해 주세요.",
  release_quarantined:"이 버전은 이전 실행에 실패했습니다. 다음 버전이 배포되면 다시 확인해 주세요.",
  prepare_failed:"업데이트 준비를 마치지 못했습니다. 새 버전 확인으로 다시 시도해 주세요.",
} as const;
export const UpdateErrorCode=z.enum(Object.keys(UPDATE_ERROR_LABELS) as [keyof typeof UPDATE_ERROR_LABELS,...Array<keyof typeof UPDATE_ERROR_LABELS>]);
export const EventInput = z.object({
  id: UUID, at: z.string().datetime(), kind: EventKind.or(z.literal("worker_log")),
  module: z.enum(["app", "classnote", "makeedu", "video", "update"]), level: z.enum(["info", "warning", "error"]),
  detail: z.object({ task:TaskKind.optional(),logCode:LogCode.optional(),updateError:UpdateErrorCode.optional(),count: z.number().int().min(0).max(1000000).optional(), durationMs: z.number().int().min(0).max(86400000).optional(), version: Version.optional() }).strict().default({}),
}).strict();
export const SettingsInput = z.object({ enabled: z.boolean(), classnoteEnabled: z.boolean(), makeeduEnabled: z.boolean(), updatesEnabled: z.boolean(), revision: z.number().int().positive() }).strict();
export const LocalSettingsInput = z.object({
  autoStart: z.boolean(), startMinimized: z.boolean(), paused: z.boolean(),
  classnoteEnabled: z.boolean(), makeeduEnabled: z.boolean(), autoDownload: z.boolean(),
}).strict();
// Old hour windows never grant permission to apply a future release.
const LegacyLocalSettingsInput = LocalSettingsInput.omit({ autoDownload: true }).extend({
  autoUpdate: z.boolean(),
  updateStartHour: z.number().int().min(0).max(23), updateEndHour: z.number().int().min(0).max(23),
}).strict();
export const StoredLocalSettingsInput = z.union([
  LocalSettingsInput,
  LegacyLocalSettingsInput.transform((old) => ({ autoStart: old.autoStart, startMinimized: old.startMinimized, paused: old.paused, classnoteEnabled: old.classnoteEnabled, makeeduEnabled: old.makeeduEnabled, autoDownload: old.autoUpdate })),
]);
export const DEFAULT_LOCAL_SETTINGS = { autoStart: true, startMinimized: true, paused: false, classnoteEnabled: true, makeeduEnabled: true, autoDownload: true };
export const EVENT_LABELS: Record<z.infer<typeof EventKind>, string> = {
  app_started: "앱 시작", app_stopped: "앱 종료", paired: "PC 연결", paused: "일시 중지", resumed: "작업 재개",
  lease_lost: "실행 권한 확인 필요", connection_lost: "서버 연결 끊김", connection_restored: "서버 연결 복구",
  module_started: "연동 시작", module_stopped: "연동 중지", module_failed: "연동 오류", module_retry: "연동 재시도",
  job_started: "작업 시작", job_succeeded: "작업 완료", job_failed: "작업 실패",
  update_available: "새 버전 확인", update_downloaded: "업데이트 다운로드 완료", update_applied: "업데이트 적용",
  update_failed: "업데이트 확인 필요", update_rollback: "이전 버전 복구", legacy_detected: "이전 워커 실행 확인 필요",
  logs_dropped: "오래된 일반 기록 정리", credentials_needed: "연동 계정 설정 필요",
};
