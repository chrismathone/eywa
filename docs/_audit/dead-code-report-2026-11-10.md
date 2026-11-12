# 안 쓰는 코드 보고서 — 2026-11-10 (수정 계획 P4 · 보고 모드)

🔴 **보고만 한다** — 자동 삭제·게이트 차단 없음(결정 #7). 지울 때는 한 덩어리씩: 참조 그래프 + 문자열 가드(`readFileSync`) + Next 진입점 + `scripts/`·`experiments/`·연동 앱을 다시 확인하고, 게이트·적대적 리뷰를 거친다(P3-X·P3-D와 같은 절차).

만든 법: `knip`을 새 의존성으로 들이지 않고, import 그래프(정적·동적 import·`require`·`@import`)를 Next 진입점(`page`·`layout`·`loading`·`route` 등)과 `scripts/`·루트 설정에서 따라가 닿지 않는 파일을 셌다. 시험 파일은 진입점이 아니다(시험만 부르는 파일 = 운영에선 죽은 코드). export는 저장소 전체(src·scripts·experiments·apps)에서 이름이 정의 한 번만 나오는 것.

⚠️ 오탐 가능: 문자열로만 부르는 경로(크론 주소·연동 PC가 여는 주소), `.d.ts`, 개발 전용 화면이 쓰는 것. `date-fns`·`react-hook-form` 의존성(참조 0 — lockfile peer 표기가 크게 바뀌어 P3-X에서 보류).

## 진입점에서 닿지 않는 파일 (80개)

`경로 <- 이 파일을 import하는 곳`(없으면 none — 대개 시험만 부른다)

```
src/app/(shell)/classes/_components/classroom-assign-dialog.tsx <- (none)
src/app/(shell)/consultations/_components/stats/stats-gap.tsx <- (none)
src/app/(shell)/dashboard/_instruments/engine/index.d.ts <- (none)
src/app/(shell)/staff/[id]/_components/schedule-editor.tsx <- src/app/(shell)/staff/[id]/_tabs/schedule-tab.tsx
src/app/(shell)/staff/[id]/_tabs/schedule-tab.tsx <- (none)
src/app/(shell)/timetable/english-sheet/test-preview.ts <- src/app/(shell)/timetable/english-sheet/issues-panel.test.tsx, src/app/(shell)/timetable/english-sheet/omitted-classes.test.tsx, src/app/(shell)/timetable/english-sheet/sheet-form.test.tsx
src/components/atoms/section-title.tsx <- (none)
src/components/ui/label.tsx <- (none)
src/components/ui/separator.tsx <- src/components/ui/sidebar.tsx
src/components/ui/sidebar.tsx <- (none)
src/features/assistant/server/__fixtures__/explain-plans.json <- src/features/assistant/server/executor.test.ts
src/features/attendance/server/makeup-reservation-complete-test-context.ts <- src/features/attendance/server/makeup-reservation-complete-add.test.ts, src/features/attendance/server/makeup-reservation-complete-calendar.test.ts, src/features/attendance/server/makeup-reservation-complete-repair.test.ts, src/features/attendance/server/makeup-reservation-complete-settings.test.ts, src/features/attendance/server/makeup-reservation-complete.test.ts
src/features/billing/golden/fixtures/class-amount-cases.json <- src/features/billing/golden/golden.test.ts
src/features/billing/golden/fixtures/invoices-2026-07.json <- src/features/billing/golden/golden.test.ts
src/features/billing/golden/fixtures/plan-cases.json <- src/features/billing/golden/golden.test.ts
src/features/billing/golden/fixtures/session-audit-cases.json <- src/features/billing/golden/golden.test.ts
src/features/class-sheets/click-hint.ts <- (none)
src/features/classes/server/fake-classes-db.test-support.ts <- src/features/classes/server/class-name-conflict-actions.test.ts, src/features/classes/server/class-name-guard.test.ts
src/features/english-assessment/area.ts <- src/features/english-assessment/report.test.ts, src/features/english-assessment/report.ts, src/features/english-assessment/sample.ts
src/features/english-assessment/levels.ts <- src/features/english-assessment/area.ts, src/features/english-assessment/peers.ts, src/features/english-assessment/report.test.ts, src/features/english-assessment/report.ts, src/features/english-assessment/sample.ts
src/features/english-assessment/peers.ts <- src/features/english-assessment/report.test.ts, src/features/english-assessment/report.ts
src/features/english-assessment/report.ts <- src/features/english-assessment/report.test.ts, src/features/english-assessment/sample.ts
src/features/english-assessment/sample.ts <- src/features/english-assessment/report.test.ts
src/features/exports/english-timetable/integrated-sheet.ts <- src/features/exports/english-timetable/export.test.ts
src/features/grades/unified/server/roster-action.ts <- (none)
src/features/integrations/todays-math/sync-browser.test-support.ts <- src/features/integrations/todays-math/sync-authorize-fallback.test.ts, src/features/integrations/todays-math/sync-launch.test.ts
src/features/makeups/additional.ts <- src/features/makeups/decisions.test.ts
src/features/makeups/components/ui-test-fixtures.ts <- src/features/makeups/components/allocation-picker.test.tsx, src/features/makeups/components/case-detail-history.test.tsx, src/features/makeups/components/case-history.test.tsx, src/features/makeups/components/participation-form.test.tsx, src/features/makeups/components/session-operations.test.tsx
src/features/makeups/occurrence.ts <- src/features/makeups/decisions.test.ts
src/features/makeups/permissions.ts <- src/features/makeups/decisions.test.ts
src/features/makeups/quantity.ts <- src/features/makeups/quantity.test.ts
src/features/makeups/server/adapters/effects-test-double.ts <- src/features/makeups/server/adapters/effects-actor.test.ts, src/features/makeups/server/adapters/effects.test.ts
src/features/math-progress-map/components/detail-day-lists.tsx <- src/features/math-progress-map/components/detail-panel.tsx
src/features/math-progress-map/components/detail-lists.tsx <- src/features/math-progress-map/components/detail-day-lists.tsx, src/features/math-progress-map/components/detail-panel.tsx, src/features/math-progress-map/course-end.test.tsx
src/features/math-progress-map/components/detail-panel.tsx <- (none)
src/features/math-progress-map/components/progress-summary.tsx <- src/features/math-progress-map/components/map-state.test.tsx
src/features/math-progress-map/components/timeline/circular-progress-clock.tsx <- src/features/math-progress-map/components/timeline/timeline-sidebar.tsx
src/features/math-progress-map/components/timeline/math-progress-timeline.tsx <- (none)
src/features/math-progress-map/components/timeline/timeline-sidebar.tsx <- src/features/math-progress-map/components/timeline/math-progress-timeline.tsx
src/features/math-progress-map/components/timeline/use-clock-navigation.ts <- src/features/math-progress-map/components/timeline/circular-progress-clock.tsx
src/features/math-progress-map/learning-map.test-fixture.ts <- src/features/math-progress-map/components/learning-report-list.test.tsx, src/features/math-progress-map/components/linked-learning-map.test.tsx, src/features/math-progress-map/course-start.test.tsx, src/features/math-progress-map/learning-dashboard.test.ts, src/features/math-progress-map/learning-map.test.ts, src/features/math-progress-map/server/learning-map-page.test.tsx, src/features/math-progress-map/server/learning-map-query.test.ts, src/features/math-sheets/components/learning-overview.test.tsx
src/features/math-sheets/components/goal-cell.tsx <- src/features/math-sheets/components/student-head-cell.tsx
src/features/math-sheets/components/goal-rail-bar.tsx <- src/features/math-sheets/components/goal-fill-color.test.ts, src/features/math-sheets/components/month-client.tsx, src/features/math-sheets/components/student-head-cell.tsx
src/features/math-sheets/components/month-client.tsx <- (none)
src/features/math-sheets/components/month-day-cells.tsx <- src/features/math-sheets/components/month-grid.tsx
src/features/math-sheets/components/month-grid.tsx <- src/features/math-sheets/components/month-client.tsx
src/features/math-sheets/components/student-head-cell.tsx <- src/features/math-sheets/components/month-grid.tsx
src/features/math-sheets/components/use-student-goals.ts <- src/features/math-sheets/components/goal-cell.tsx, src/features/math-sheets/components/month-client.tsx, src/features/math-sheets/components/month-grid.tsx, src/features/math-sheets/components/student-head-cell.tsx
src/features/math-sheets/server/goal-audit-actions.ts <- src/features/math-sheets/components/month-client.tsx
src/features/newcomers/board-fixtures.test-support.ts <- src/app/(shell)/newcomers/_components/newcomer-board.test.tsx, src/features/newcomers/board-model.test.ts
src/features/onescreen/server/roster-conducted.test-support.ts <- src/features/onescreen/server/roster-conducted.test.ts
src/features/owner/components/setting-roles-button.tsx <- src/features/owner/components/setting-roles-button.test.tsx, src/features/owner/components/setting-roles-control.tsx
src/features/owner/components/setting-roles-control.tsx <- (none)
src/features/owner/server/setting-role-actions.ts <- src/features/owner/components/setting-roles-button.tsx, src/features/owner/server/setting-role-actions.test.ts
src/features/owner/setting-roles.ts <- src/features/owner/components/setting-roles-button.test.tsx, src/features/owner/components/setting-roles-button.tsx, src/features/owner/components/setting-roles-control.tsx, src/features/owner/server/permissions-save.test.ts, src/features/owner/server/setting-role-actions.test.ts, src/features/owner/server/setting-role-actions.ts, src/features/owner/setting-roles.test.ts
src/features/payroll/server/settlement-queries.ts <- src/features/billing/session-terms/server/pricing.test.ts
src/features/progress/server/backfill-actions.ts <- (none)
src/features/report-rating/server/rate-now.ts <- (none)
src/features/students/stats/makeedu-history-bills.ts <- src/features/students/stats/makeedu-history-bills.test.ts
src/features/teacher-portfolio/model/stored-exit-reasons.ts <- src/features/teacher-portfolio/model/stored-exit-reasons.test.ts
src/features/timetable/import/master/attendance-absence-fixture.ts <- src/app/(shell)/timetable/english-sheet/attendance-migration.test.tsx, src/features/timetable/import/master/attendance-absence.test.ts, src/features/timetable/server/master-sheet-absence.test.ts
src/features/timetable/import/master/attendance-test-fixture.ts <- src/features/timetable/import/master/attendance-absence-fixture.ts, src/features/timetable/import/master/attendance-migration.test.ts, src/features/timetable/server/master-sheet-attendance.test.ts, src/features/timetable/server/master-sheet-native-links.test.ts, src/features/timetable/server/master-sheet-seat-move.test.ts
src/features/timetable/import/master/test-fixture.ts <- src/features/timetable/import/master/attendance-test-fixture.ts, src/features/timetable/import/master/memo-slots.test.ts, src/features/timetable/import/master/plan.test.ts, src/features/timetable/import/master/teacher-mappings.test.ts
src/features/timetable/import/math-grid/test-fixture.ts <- src/features/timetable/import/math-grid/apply-plan.test.ts, src/features/timetable/import/math-grid/math-grid-edits.test.ts, src/features/timetable/import/math-grid/math-grid-safety.test.ts, src/features/timetable/import/math-grid/math-grid-traps.test.ts, src/features/timetable/import/math-grid/math-grid.test.ts
src/features/timetable/import/structure/fixtures/aywa-teacher-grid.sample.json <- src/features/timetable/import/structure/parse-aywa-grid.test.ts
src/features/timetable/import/structure/fixtures/teacher-grid.sample.json <- src/features/timetable/import/structure/match.test.ts, src/features/timetable/import/structure/parse-grid.test.ts
src/features/timetable/server/master-native-read-double.ts <- src/features/timetable/server/master-sheet-attendance.test.ts, src/features/timetable/server/master-sheet-native-links.test.ts, src/features/timetable/server/master-sheet-store.test.ts, src/features/timetable/server/master-sheet-terms.test.ts
src/features/timetable/server/master-sheet-test-fixture.ts <- src/features/timetable/server/master-sheet-attendance.test.ts, src/features/timetable/server/master-sheet-native-links.test.ts, src/features/timetable/server/master-sheet-store.test.ts, src/features/timetable/server/master-sheet-terms.test.ts
src/features/timetable-cell-memo/server/fake-admin.test-util.ts <- src/features/timetable-cell-memo/server/actions.test.ts
src/features/timetable-lab/editor/constraints-reference.test-support.ts <- src/features/timetable-lab/editor/performance.test.ts
src/features/timetable-lab/editor/performance.test-support.ts <- src/features/timetable-lab/editor/performance.test.ts
src/features/timetable-lab/editor/source-fixture.test-support.ts <- src/features/timetable-lab/editor/native.test.ts, src/features/timetable-lab/editor/views.test.ts, experiments/timetable-lab-p0/tests/library.spec.ts, experiments/timetable-lab-p0/tests/native.spec.ts, experiments/timetable-lab-p0/tests/views.spec.ts
src/features/timetable-memo/google.ts <- src/features/timetable-memo/pack.test.ts
src/features/video-submit/server/account-fixture.test-util.ts <- src/app/api/integrations/homework-video-drive/callback/route.test.ts, src/app/api/integrations/homework-video-drive/start/route.test.ts, src/app/api/internal/video-drive-token/route.test.ts, src/features/video-submit/server/drive-credentials.test.ts, src/features/video-submit/server/drive-quota.test.ts, src/features/video-submit/server/drive-settings-actions.test.ts, src/features/video-submit/server/drive-settings.test.ts, src/features/video-submit/server/site-setup-pending.test.ts, src/features/video-submit/server/site.test.ts, src/features/video-submit/server/upload-accounts.test.ts
src/features/video-submit/server/fake-db.test-util.ts <- src/app/api/integrations/homework-video-drive/callback/route.test.ts, src/app/api/integrations/homework-video-drive/start/route.test.ts, src/app/api/internal/video-drive-token/route.test.ts, src/features/student-contribution/server/score-roster.test.ts, src/features/student-contribution/server/video-check-action.test.ts, src/features/video-homework/server/assignment-availability.test.ts, src/features/video-homework/server/assignments-extra.test.ts, src/features/video-homework/server/cancel-homework.test.ts, src/features/video-homework/server/cancels.test.ts, src/features/video-homework/server/issue-actions.test.ts, src/features/video-homework/server/receipt-comment.test.ts, src/features/video-homework/server/reconcile-outcomes.test.ts, src/features/video-homework/server/reject-videos.test.ts, src/features/video-homework/server/video-assignment.test.ts, src/features/video-submit/server/account-fixture.test-util.ts, src/features/video-submit/server/drive-credentials.test.ts, src/features/video-submit/server/drive-quota.test.ts, src/features/video-submit/server/drive-settings-actions.test.ts, src/features/video-submit/server/drive-settings.test.ts, src/features/video-submit/server/report-link.test.ts, src/features/video-submit/server/site-setup-pending.test.ts, src/features/video-submit/server/site.test.ts, src/features/video-submit/server/test-fixture.test-util.ts, src/features/video-submit/server/upload-accounts.test.ts, src/features/video-submit/server/upload-complete.test.ts, src/features/video-submit/server/upload-diagnostics.test.ts, src/features/video-submit/server/upload-start.test.ts
src/features/video-submit/server/test-fixture.test-util.ts <- src/app/api/integrations/homework-video-drive/callback/route.test.ts, src/app/api/integrations/homework-video-drive/start/route.test.ts, src/app/api/internal/video-drive-token/route.test.ts, src/features/video-submit/server/actions.test.ts, src/features/video-submit/server/drive-config.test.ts, src/features/video-submit/server/drive-credentials.test.ts, src/features/video-submit/server/drive-quota.test.ts, src/features/video-submit/server/drive-settings-actions.test.ts, src/features/video-submit/server/drive-settings.test.ts, src/features/video-submit/server/report-link.test.ts, src/features/video-submit/server/site-setup-pending.test.ts, src/features/video-submit/server/site.test.ts, src/features/video-submit/server/upload-accounts.test.ts, src/features/video-submit/server/upload-complete.test.ts, src/features/video-submit/server/upload-diagnostics.test.ts, src/features/video-submit/server/upload-start.test.ts
src/features/withdrawal-reports/archive-match.ts <- src/features/withdrawal-reports/archive-match.test.ts
src/features/withdrawal-reports/archive-normalize.ts <- src/features/withdrawal-reports/archive-match.ts
src/features/withdrawal-reports/refund-keys-overlap.cases.json <- src/features/withdrawal-reports/refund-keys.test.ts
src/lib/db/schema-columns.ts <- src/features/onescreen/server/ment-preview.test.ts, src/features/timetable/lib/slot-anchor-columns.test.ts
```

## 정의만 있고 아무도 안 부르는 export (132개)

```
src/app/(shell)/owner/_components/fields.tsx	SelectField
src/app/(shell)/owner/_components/list-editors.tsx	TermListEditor
src/app/(shell)/timetable/_components/search-context.tsx	VisibleClassCount
src/components/workspace/motion.ts	prefersReducedMotion
src/components/workspace/open-window-button.tsx	OpenWindowButton
src/components/workspace/window-geometry.ts	pointInRect
src/data/marketing.ts	INQUIRY_NOTE
src/features/academy-knowledge/catalog.ts	WORKBOOK
src/features/academy-knowledge/records.ts	saveRequest
src/features/academy-knowledge/records.ts	latestRecords
src/features/academy-knowledge/records.ts	validateTransition
src/features/academy-knowledge/studio-model.ts	studioRequest
src/features/academy-knowledge/studio-model.ts	validateStudioKey
src/features/academy-knowledge/studio-model.ts	edgeAppearance
src/features/approvals/types.ts	isApprovalForm
src/features/approvals/types.ts	STEP_DECISION_COLOR
src/features/approvals/types.ts	isApprovedDecision
src/features/attendance/hub-search.ts	HUB_SUBJECT_FALLBACK
src/features/attendance/live/signals.ts	LIVE_GRACE_MIN
src/features/attendance/units-master.ts	MASTER_SEATS
src/features/billing/refund-prefill.ts	REFUND_PREFILL_FIELDS
src/features/billing/server/queries.ts	getBillingSummary
src/features/billing/server/tuition-quote-queries.ts	getQuoteCount
src/features/billing/session-terms/server/term-materialize.ts	ensureSessionTermRow
src/features/billing/status-color.ts	BILLING_SOLID
src/features/class-sheets/chrome.ts	SHEET_FACE_TITLE
src/features/class-sheets/click-hint.ts	EMPTY_CLICK_LABEL
src/features/class-splits/server/queries.ts	getSplitsOfStudent
src/features/classnote-reply/reply-policy.ts	REPLY_BUSY
src/features/consultations/server/actions.ts	runStudentCareAnalysis
src/features/consultations/template-vars.ts	TEMPLATE_VAR_HINTS
src/features/dashboard/overview/kpi-links.ts	studentsCompositionHref
src/features/dashboard/overview/kpi-links.ts	studentsUnenrolledHref
src/features/dashboard/server/queries.ts	getMostRecentAttendanceSnapshot
src/features/english-assessment/report.ts	MEDAL_LABEL
src/features/excel-import/spec.ts	WEEKDAY_LABELS
src/features/explore/components/network/time-tree.ts	isGroupId
src/features/explore/model.ts	KIND_TITLE
src/features/explore/model.ts	sectorDef
src/features/explore/view-prefs.ts	DEFAULT_EXPLORE_PREFS
src/features/grades/server/write.ts	updateUnslottedGrade
src/features/help/hub.ts	QUICKSTART
src/features/integrations/server/sheet-sync-lease.ts	touchSheetSyncLease
src/features/integrations/todays-math/sync-contract.ts	SYNC_VERSION
src/features/inventory/qr.ts	QR_LABELS_PER_ROW
src/features/inventory/qr.ts	QR_LABELS_PER_PAGE
src/features/makeups/occurrence.ts	additionalOccurrenceKey
src/features/makeups/occurrence.ts	sameOccurrence
src/features/makeups/occurrence.ts	distinctLessons
src/features/makeups/occurrence.ts	correctionDisposition
src/features/makeups/occurrence.ts	reintakeKey
src/features/marketing/input-model.ts	reviewInputSchema
src/features/math-progress-map/calendar.ts	monthLabelKo
src/features/math-progress-map/components/detail-panel.tsx	ProgressDetailPanel
src/features/math-progress-map/components/timeline/math-progress-timeline.tsx	MathProgressTimeline
src/features/math-progress-map/learning-map.ts	learningMapHref
src/features/math-progress-map/palette.ts	HOLIDAY_TICK_FILL
src/features/math-progress-map/palette.ts	NO_CLASS_TICK_FILL
src/features/math-progress-map/view-mode.ts	MODE_OF_RING
src/features/math-sheets/lib/class-days.ts	slotTimesLabel
src/features/math-sheets/lib/learning-path.ts	regularBlockCount
src/features/meetings/server/ai.ts	formatMeetingTranscript
src/features/newcomers/care-cells.ts	careCellDaysLeft
src/features/newcomers/completion.ts	completionMemo
src/features/newcomers/followup-model.ts	assignmentSchema
src/features/newcomers/followup-model.ts	reviewSchema
src/features/onescreen/curriculum.ts	semestersForGrade
src/features/onescreen/makeup-remove-plan.ts	MAKEUP_RECALLED
src/features/onescreen/report-video.ts	REPORT_VIDEO_MAX_COUNT
src/features/onescreen/server/ment-source-db.ts	_resetMentSourceProbeForTest
src/features/onescreen/server/notice-image-upload.ts	NOTICE_IMAGE_ACCEPT
src/features/owner/operations-context.tsx	useJobTitles
src/features/owner/subjects.ts	SUBJECT_ICON_BG
src/features/periods/verify.ts	findTeachingGapDays
src/features/report-admin/report-recall.ts	RECALL_STATUSES
src/features/report-templates/defaults.ts	TEMPLATE_IMAGE_TOKENS
src/features/schools/school-name.ts	SCHOOL_KIND
src/features/shuttle/server/actions.ts	updateRun
src/features/shuttle/server/actions.ts	deleteRun
src/features/staff/notion/notion-tasks.ts	spansPlain
src/features/staff/resume/server/resume-queries.ts	getStaffResumes
src/features/student-contribution/server/live-query.ts	getLiveConnections
src/features/students/ontology/summary.ts	RECENT_SUMMARY_PROMPT
src/features/students/server/queries.ts	getStudentAttendanceCalendar
src/features/students/stats/model.ts	TREND_VIEWS
src/features/students/status/status-labels.ts	STUDENT_STATUS_COLOR
src/features/super-admin/server/audit.ts	getAuditLogs
src/features/super-admin/server/queries.ts	getTenantPlanStats
src/features/sync-agent/protocol.ts	AGENT_VERSION
src/features/teacher-hub/server.ts	saveTeacherCapacity
src/features/teacher-portfolio/view.ts	REPORT_STATE_LABEL
src/features/teacher-view/i18n.ts	sheetTranslator
src/features/textbooks/roadmap-calendar.ts	dateAtLessonsIn
src/features/timetable-memo/ops.ts	hasMergeIn
src/features/timetable-memo/ops.ts	clampRange
src/features/timetable-memo/ops.ts	hasTextIn
src/features/video-homework/components/video-homework-provider.tsx	useVideoHomework
src/features/video-homework/server/queries.ts	getVideoHomeworkHistory
src/features/video-homework/server/queries.ts	getVideoHomeworkRoster
src/features/video-review/storage-paths.ts	frameLabel
src/features/video-submit/server/link-choice-db.ts	_resetVideoSubmitLinkColumnForTest
src/features/withdrawal-reports/server/refund.ts	UNALLOCATED_LINE
src/features/withdrawals/report-date-link.ts	REPORT_DATE_KIND_LABEL
src/features/work-records/model.ts	workRequestSchema
src/features/work-records/model.ts	validateWorkTransition
src/lib/auth/tenant-view.ts	assertNotTenantView
src/lib/db/schema.ts	academyDocumentCategoryEnum
src/lib/db/schema.ts	staffContracts
src/lib/db/schema.ts	intakeAttempts
src/lib/db/schema.ts	shareLinkViews
src/lib/db/schema.ts	onescreenDailySessions
src/lib/db/schema.ts	progressEvents
src/lib/db/schema.ts	aiPromptOverrides
src/lib/db/schema.ts	teacherMentStyles
src/lib/db/schema.ts	consultationRecordings
src/lib/db/schema.ts	helpAnswers
src/lib/db/schema.ts	textbookOrders
src/lib/db/schema.ts	textbookCatalog
src/lib/db/schema.ts	tuitionCatalog
src/lib/db/schema.ts	invoiceSessionTerms
src/lib/db/schema.ts	invoiceTeacherSplits
src/lib/db/schema.ts	tuitionQuotes
src/lib/db/schema.ts	gradeGoals
src/lib/db/schema.ts	gradeComments
src/lib/db/schema.ts	noticeDismissals
src/lib/db/schema.ts	labMenuAssignments
src/lib/db/schema.ts	withdrawalReportEvents
src/lib/db/schema.ts	withdrawalReportRefunds
src/lib/db/schema.ts	withdrawalReportSources
src/lib/db/schema.ts	withdrawalReportArchiveMappings
src/lib/navigation.ts	EXTERNAL_NAV
src/lib/notion/client.ts	listUsersAll
```
