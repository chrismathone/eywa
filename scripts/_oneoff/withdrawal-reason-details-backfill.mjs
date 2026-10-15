/**
 * 퇴원 사유 2단계(원장 2026-10-15) — 메모로 실제 사유를 알 수 있는 옛 퇴원 55건을 새 대분류·세부로 옮긴다.
 * 매핑은 원장이 표로 확인한 것(학생 이름·메모 원문은 여기 적지 않는다 — 메모는 md5로만 대조).
 *
 *   node --env-file=.env.local scripts/_oneoff/withdrawal-reason-details-backfill.mjs [--tenant=cs] [--apply]
 *
 * 🔴 기본은 미리 보기(읽기 전용) — 줄마다 지금 사유·메모가 표를 만들 때와 같은지 본다. `--apply`는 한 트랜잭션에서 쓴다.
 * 🔴 순서 = 0367a 적용 · 새 앱 배포 확인 → `--apply`(옛 화면은 새 대분류 키를 '기타'로 읽는다).
 * 멈추는 경우(덮어쓰지 않는다): 학생을 못 찾음 · 지금 사유나 메모가 표와 다름(그새 누가 고침) — 아무것도 쓰지 않는다.
 * 바꾸는 것은 `withdrawal_metadata`의 reason·detail뿐(메모·상담 기록·퇴원보고서 번호는 그대로) · 줄마다 감사로그(withdrawal_update).
 * + 그 퇴원이 함께 닫은 수강(퇴원일에 끝난 줄 · 반 이동 제외 · 사유가 옛 사유 그대로)의 `withdrawal_reason`도 새 대분류로 —
 *   퇴원율·시간표 X는 수강 사유도 읽어서(`excusedReasonOf`) 학생 사유만 바꾸면 '졸업'에서 고친 퇴원이 계속 빠진다(퇴원 상세의
 *   사유 저장 `syncWithdrawalEnrollmentReasons`와 같은 규칙). 수강 표 트리거가 문장마다 도니 UPDATE는 한 문장으로.
 */
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
const APPLY = process.argv.includes("--apply");
const slug = (process.argv.find((a) => a.startsWith("--tenant=")) || "--tenant=cs").slice("--tenant=".length);
// 감사로그의 행위자 = 지시한 원장.
const ACTOR = { id: "94007db7-12d3-4b5d-97f2-39071446536b", name: "원일" };
const stop = (msg) => { throw new Error(msg); };

/** [학생 id, 지금 사유(null = 없음), 새 대분류, 새 세부(null = 미기재), 메모 md5] */
const PLAN = [
  ["8f640d80-e8d0-47f8-aed0-3fe0aedd3c78", "other", "dissatisfaction", "teacher_reassigned", "67e387a1ac0cf91b5cec73ded6bdf072"],
  ["c37e8e2f-acc3-4161-ae7f-c1885c8847eb", "other", "grades", "school_grades", "d11977eb2b5af1e15d4a2bb7b2c28861"],
  ["3a1034b5-6c33-4195-b6d0-c0726ac0a441", "other", "dissatisfaction", "class_grouping", "01235cf6f1827074f6db9fd9638d61b3"],
  ["a76c5f1b-08fc-4191-9b1a-91fbafab05e2", "dissatisfaction", "dissatisfaction", "teaching_style", "6ccda55455f8350e0b6c34aeefe88d97"],
  ["de779d17-8dbd-4d0f-a062-e99c8b92af13", "other", "career", "vocational_school", "d863deb1d35e5930db635f504bd4062a"],
  ["064c749d-a2ef-4038-9517-6e62bb89be4c", "other", "dissatisfaction", "teacher_changes", "0a15af8d2827a92c92565983f1c29ec4"],
  ["2bbe0f71-3cce-4335-800e-e98583345afc", "other", "motivation", "struggling", "0626972aa4e588a2f98aba93d52f4139"],
  ["49fa61d8-0cfd-41ef-863c-2036b3ab57f5", "other", "motivation", "low_motivation", "23e8add1d31cb37e04bb832e68af2d7c"],
  ["62c7f682-df2a-4f94-af40-4872dce2abb2", "other", "method", "home_study", "a014fb13381d3cf609a67c21c00ce5cb"],
  ["08737050-edd4-4656-9653-55cf41e5867d", "dissatisfaction", "dissatisfaction", "teacher_changes", "03058543007113f94e97fabecccc091a"],
  ["1bb3e2d6-e86a-49c9-8824-9d2cf7beeead", "other", "method", "self_study", "61b2b65efd30f5d22cf998bbe700867c"],
  ["7d1a28f6-f132-4b58-881b-b2f3967f62e6", "other", "motivation", "wants_break", "02cb3bb75e20129b3faaa6712468b8b7"],
  ["00f50527-2045-4904-8feb-137d6cf9233e", "other", "career", "career_change", "645b7d3514fc5bb5c750e4d96eb52749"],
  ["26e91c56-41ce-4eb1-98ea-721e8284da8e", "other", "dissatisfaction", "teacher_changes", "03058543007113f94e97fabecccc091a"],
  ["8f562ad6-df66-41da-bf53-435c4f7bc701", "other", "dissatisfaction", "teacher_changes", "03058543007113f94e97fabecccc091a"],
  ["0ff9732b-830c-4fef-b114-f769913ea884", "other", "career", "career_change", "6efb30467d3b028c81a2cb1727422150"],
  ["6cffbcb5-cb58-45b5-95a1-e43959650911", "other", "motivation", "struggling", "b70928045527cff69d78be2c6877616b"],
  ["a1e50ab9-416f-452f-b3c4-fc119ca60228", "competitor", "method", "private_tutor", "815a990b2f3081b2d078a204533866b5"],
  ["a30071b4-ac41-4ac9-b5a9-0f8e58abbae6", "other", "peers", null, "b9c476138814f88bc420e76b699fdba7"],
  ["c2665c65-4161-4c4d-a972-cd6c339400a4", "other", "schedule", "other_academy_conflict", "27b412e520d4aba43531f29219f9e149"],
  ["f8f06a3f-19a5-42cd-a1e2-bb0e85c2e976", "other", "dissatisfaction", "teacher_changes", "03058543007113f94e97fabecccc091a"],
  ["6ddc2922-5e12-4795-bae9-310a60fe303d", "dissatisfaction", "dissatisfaction", "teacher_changes", "f7207d10273632564fe7de44863aae24"],
  ["130ec253-59ce-481e-902a-19fc7edab8ad", "dissatisfaction", "grades", null, "842be62e194474e6f64160abe2d1c66f"],
  ["295fe009-bb69-441f-a2a0-fda727ec00f6", "dissatisfaction", "grades", "school_grades", "44ebfa208d8cd3c5f587fb9ea8ac179e"],
  ["2bb5d069-2b80-424d-9e34-49064e9132bb", "dissatisfaction", "grades", null, "842be62e194474e6f64160abe2d1c66f"],
  ["43365321-7a7c-4878-96c9-197ec073d6fb", "other", "dissatisfaction", "teacher_reassigned", "61870e219e7c32f544360aebf5a2a0da"],
  ["8836dc67-b7b1-4b0d-9cf5-e4e19722984b", "dissatisfaction", "grades", "school_grades", "44ebfa208d8cd3c5f587fb9ea8ac179e"],
  ["a132d508-399d-402c-a24b-57424d708b25", "other", "peers", "friends_left", "c97221dcfcf7a6c6bbac15d02b8d22a4"],
  ["b8ae7a51-1677-4138-8057-8489224a71d1", "dissatisfaction", "grades", null, "842be62e194474e6f64160abe2d1c66f"],
  ["edc4236d-f130-42ed-8bec-e2463488868e", "dissatisfaction", "grades", null, "842be62e194474e6f64160abe2d1c66f"],
  ["1278686e-1989-4f18-9924-6d1b6638fded", "other", "illness", "mental", "2193ac36408b3853a058313c2a334ac0"],
  ["13330e94-00a6-4169-a4b2-131f248ccd1f", "dissatisfaction", "motivation", "low_motivation", "6c04dd7f971c78d1727e859c353f9c37"],
  ["64a821ff-b436-49d2-a453-d712db1b90bf", "other", "peers", "family_conflict", "2d5357b3d6039139d79e6bb12736db46"],
  ["29ffd80f-8c91-46dc-b702-5d6ca844d8ec", "competitor", "competitor", "with_friends", "4b2cd2464588cdd40eaad76f7e9faa10"],
  ["324e0454-3343-4784-93b6-366b813cde3b", "graduated", "competitor", null, "939acca928e07b752297e6a2bb8175ed"],
  ["5bf474b2-d15a-4bc4-97d2-7655705db5a6", "dissatisfaction", "schedule", "distance_shuttle", "474b568ebac0c479ced88b625d27d4c8"],
  ["c3f1e23f-2e91-4392-9607-fbefa0a94d3a", "other", "motivation", "low_motivation", "8fe96237885bd2e0f3186b2e89644066"],
  ["59aee328-e179-4fb7-ae88-776b2fc56d2f", "other", "peers", "with_sibling", "b261913a4ccbd7f0204a552923ca6a25"],
  ["a379db27-6b51-4756-9e1f-067b0af8a02f", "other", "motivation", "wants_break", "02cb3bb75e20129b3faaa6712468b8b7"],
  ["65de97fd-466a-4912-883a-e846f980140e", "other", "dissatisfaction", "teacher_reassigned", "f46b4f2722c3f903e5d9d8ec44806e2a"],
  ["8af6a870-7505-4d08-8106-e7b20eefaf12", "graduated", "peers", "friends_left", "02275e6bd91f3b73c327828f26d6ced6"],
  ["24d06b25-813f-4e80-8138-91e3bb44d697", "other", "dissatisfaction", "teacher_reassigned", "dd00741600a3ec8539315edbc268d7d5"],
  ["43eb048c-aa9a-4353-8a23-8af1f59f652e", "other", "dissatisfaction", "teacher_reassigned", "f46b4f2722c3f903e5d9d8ec44806e2a"],
  ["701f0561-23ea-47f6-9478-5f745789b40f", "other", "dissatisfaction", "teacher_reassigned", "fb969a2c02a0838020cb3ee5924cdaa4"],
  ["a5be0b50-d009-40c4-90bc-c783a306575e", "other", "dissatisfaction", "teacher_reassigned", "f46b4f2722c3f903e5d9d8ec44806e2a"],
  ["1048e34b-1efc-40e5-8024-7840744e71ac", "graduated", "dissatisfaction", "teacher_changes", "aa13da9edefd2dd66e610b648a35b678"],
  ["581d94ee-56dc-47b5-ac23-a9d7c4adb9b9", "other", "grades", "school_grades", "aedad1bf43202e7269a15ede240f8f7b"],
  ["9e3461c3-49b0-4a6c-a5d7-631102f2ce88", "other", "career", "career_change", "ce1509fb2dd7526507f0815deb0c66b2"],
  ["dbfb5311-9975-400e-9b5e-ee26d9919e04", "other", "dissatisfaction", "teacher_left", "8f802fe02c69e6aadfec66efec5ca9b7"],
  ["d5a6f41c-4712-4718-8e60-84aaf9af46ac", "dissatisfaction", "dissatisfaction", "teaching_style", "85c2986f0c2ff440501ec91ff39a6e56"],
  ["2a7c88cb-e25f-4b36-9e5e-401bd5407ee6", "other", "motivation", "low_motivation", "66671d9dfd7217f0201033a3a126834c"],
  ["48c0c4e1-b5b1-48aa-8069-ac6692fb32b0", "other", "method", "private_tutor", "ce57ac9a005b5b3766bbddbdccca9bde"],
  ["42d1df6a-7869-4ee1-b085-b4041f5351a1", "other", "schedule", "travel_vacation", "bc013e96c7f6f586d05db6426514f0f6"],
  ["e130c39c-fb97-448d-b13a-8be64083d111", null, "relocation", null, "91f07c5ad6c03b9ce6b1f9f97fc99ed9"],
  ["f6fcfd54-988c-4a35-9010-74016d67940b", "other", "method", "other_subject_focus", "ca74d7eb50231b3dbf7ddecceebd0362"],
];

try {
  await sql.begin(APPLY ? "read write" : "read only", async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    const tenants = await tx`select id from tenants where slug = ${slug}`;
    if (tenants.length !== 1) stop(`지점 '${slug}'을(를) 하나로 찾지 못함`);
    const tenantId = tenants[0].id;
    const ids = PLAN.map((p) => p[0]);
    const cur = await tx`select id, withdrawal_metadata->>'reason' as reason, md5(withdrawal_metadata->>'memo') as memo_md5
      from students where tenant_id = ${tenantId} and status = 'withdrawn' and id = any(${ids}::uuid[]) ${APPLY ? tx`for update` : tx``}`;
    const byId = new Map(cur.map((r) => [r.id, r]));
    const bad = PLAN.filter(([id, from, , , memo]) => {
      const r = byId.get(id);
      return !r || r.reason !== from || r.memo_md5 !== memo;
    });
    if (bad.length) stop(`표와 다른 줄 ${bad.length}건(그새 바뀜 · 못 찾음) — 멈춤: ${bad.map((b) => b[0]).join(", ")}`);
    // 그 퇴원이 함께 닫은 수강 — 퇴원일에 끝난 줄 · 반 이동 아님 · 사유가 옛 사유 그대로인 것만(다른 사유로 따로 끝난 줄은 그대로).
    const planById = new Map(PLAN.map((p) => [p[0], p]));
    const enr = await tx`select e.id, e.student_id, e.withdrawal_reason as reason
      from enrollments e join students s on s.id = e.student_id
      where s.tenant_id = ${tenantId} and s.id = any(${ids}::uuid[]) and e.tenant_id = ${tenantId}
        and e.end_date = s.withdrawn_at and e.is_transferred = false ${APPLY ? tx`for update of e` : tx``}`;
    const enrTargets = enr
      .map((e) => ({ ...e, plan: planById.get(e.student_id) }))
      // 옛 사유가 없던 퇴원은 건너뛴다(앱의 사유 저장과 같다 — 빈 칸은 학생 사유를 따르니 없던 값을 새로 적지 않는다).
      .filter(({ reason, plan: [, from, to] }) => from !== null && from !== to && reason === from);
    const enrTally = {};
    for (const { reason, plan: [, , to] } of enrTargets) {
      const k = `${reason ?? "(없음)"} → ${to}`;
      enrTally[k] = (enrTally[k] ?? 0) + 1;
    }
    const changes = {};
    for (const [, from, to, detail] of PLAN) {
      const k = `${from ?? "(없음)"} → ${to}${detail ? `·${detail}` : ""}`;
      changes[k] = (changes[k] ?? 0) + 1;
    }
    console.log(`[${slug}] 옮길 퇴원 ${PLAN.length}건 — 지금 값이 표와 모두 같다.`);
    for (const [k, n] of Object.entries(changes).sort()) console.log(`  ${n}건  ${k}`);
    console.log(`함께 닫힌 수강의 사유도 맞춤 ${enrTargets.length}줄(퇴원일에 끝난 수강 ${enr.length}줄 중):`);
    for (const [k, n] of Object.entries(enrTally).sort()) console.log(`  ${n}줄  ${k}`);
    if (!APPLY) {
      console.log("미리 보기만 했습니다. 쓰려면 --apply");
      return;
    }
    // 수강 사유 — 한 문장(트리거가 문장마다 시간표 충돌을 다시 훑는다).
    if (enrTargets.length) {
      const done = await tx`update enrollments e set withdrawal_reason = v.r
        from unnest(${enrTargets.map((e) => e.id)}::uuid[], ${enrTargets.map((e) => e.plan[2])}::text[]) as v(id, r)
        where e.id = v.id and e.tenant_id = ${tenantId} returning e.id`;
      if (done.length !== enrTargets.length) stop(`수강 사유를 다 쓰지 못함: ${done.length}/${enrTargets.length}`);
    }
    const enrCount = new Map();
    for (const e of enrTargets) enrCount.set(e.student_id, (enrCount.get(e.student_id) ?? 0) + 1);
    let written = 0;
    for (const [id, from, to, detail] of PLAN) {
      const patch = detail ? { reason: to, detail } : { reason: to };
      const done = await tx`update students set withdrawal_metadata = (withdrawal_metadata - 'detail') || ${tx.json(patch)}
        where id = ${id} and tenant_id = ${tenantId} returning id`;
      if (done.length !== 1) stop(`쓰지 못함: ${id}`);
      await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, metadata)
        values (${tenantId}, ${ACTOR.id}, ${ACTOR.name}, 'withdrawal_update', 'student',
          ${tx.json({ studentId: id, reason: to, detail, from, enrollments: enrCount.get(id) ?? 0, source: "reason_detail_backfill" })})`;
      written++;
    }
    // 되읽어 확인 — 쓴 값이 그대로인지(jsonb 이중 인코딩 #82 같은 조용한 손실을 잡는다).
    const after = await tx`select id, withdrawal_metadata->>'reason' as reason, withdrawal_metadata->>'detail' as detail
      from students where id = any(${ids}::uuid[])`;
    const got = new Map(after.map((r) => [r.id, r]));
    const wrong = PLAN.filter(([id, , to, detail]) => got.get(id)?.reason !== to || (got.get(id)?.detail ?? null) !== detail);
    if (wrong.length) stop(`되읽은 값이 다름 ${wrong.length}건 — 되돌림`);
    const enrAfter = enrTargets.length
      ? await tx`select id, withdrawal_reason as reason from enrollments where id = any(${enrTargets.map((e) => e.id)}::uuid[])`
      : [];
    const enrGot = new Map(enrAfter.map((r) => [r.id, r.reason]));
    const enrWrong = enrTargets.filter((e) => enrGot.get(e.id) !== e.plan[2]);
    if (enrWrong.length) stop(`되읽은 수강 사유가 다름 ${enrWrong.length}줄 — 되돌림`);
    console.log(`썼습니다: ${written}건 · 감사로그 ${written}건 · 수강 사유 ${enrTargets.length}줄`);
  });
} finally {
  await sql.end();
}
