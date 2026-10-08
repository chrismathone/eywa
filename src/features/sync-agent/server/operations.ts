import "server-only";
import { z } from "zod";
import { WorkEnvelope,withAgentWork } from "./gateway";
import { AgentError } from "./security";
import { writeClassBoardSnapshot } from "../../../../scripts/_classnote/math-class-boards-db.mjs";
import { normalizeScope } from "../../../../scripts/_classnote/sync-request-plan.mjs";

const Notification=z.object({tenant_id:z.string().uuid(),recipient_id:z.string().uuid(),type:z.string().max(80),title:z.string().max(1000),body:z.string().max(10000).nullable(),link:z.string().max(2000).nullable()}).strict();
const common={plan:z.array(Notification).max(5000)};
const postInput=z.object({...common,lastSeenId:z.number().nullable(),watermark:z.number()}).strict();
const commentsInput=z.object({...common,readAt:z.string().nullable(),counts:z.record(z.string(),z.unknown()),mark:z.object({id:z.number(),created:z.string().nullable()}).passthrough().nullable()}).strict();
const finishInput=z.object({id:z.string().uuid(),status:z.enum(["done","failed"]),result:z.unknown(),error:z.string().max(4000).nullable()}).strict();
const snapshotInput=z.object({plans:z.array(z.record(z.string(),z.unknown())).max(1000),keepClassIds:z.array(z.string().uuid()).max(5000),scoped:z.boolean()}).strict();
const Envelope=WorkEnvelope.extend({operation:z.enum(["class-board-snapshot","finish-class-sync","feed-posts","feed-comments"]),input:z.unknown()}).strict();

export async function runAgentOperation(device:{id:string;tenantId:string},input:unknown) {
  const parsed=Envelope.safeParse(input); if(!parsed.success) throw new AgentError(400,"invalid_input");
  const p=parsed.data; if(p.module!=="classnote") throw new AgentError(403,"unknown_operation");
  const validator={"class-board-snapshot":snapshotInput,"finish-class-sync":finishInput,"feed-posts":postInput,"feed-comments":commentsInput}[p.operation];
  if(!validator.safeParse(p.input).success) throw new AgentError(400,"invalid_input");
  return withAgentWork(device,p,async sql=>{
    const tenant=device.tenantId;
    if(p.operation==="class-board-snapshot") {
      const args=snapshotInput.parse(p.input);
      // All nested transactions are part of this server-owned transaction.
      const nested=Object.assign((...args: unknown[])=>Reflect.apply(sql,undefined,args),sql,{begin:async(fn:(tx:unknown)=>unknown)=>fn(sql)});
      return writeClassBoardSnapshot(nested,tenant,args.plans as Parameters<typeof writeClassBoardSnapshot>[2],args);
    }
    if(p.operation==="finish-class-sync") {
      const args=finishInput.parse(p.input);
      const [row]=await sql`update classnote_sync_requests set status=${args.status},finished_at=now(),result=${sql.json(args.result as never)},error=${args.error}
        where id=${args.id} and status='running' returning next_scope`;
      if(!row) return {finished:false,requeued:false};
      if(!row.next_scope || typeof row.next_scope!=="object") return {finished:true,requeued:false};
      const inserted=await sql`insert into classnote_sync_requests(tenant_id,scope) values(${tenant},${sql.json(normalizeScope(row.next_scope))}) on conflict do nothing returning id`;
      return {finished:true,requeued:inserted.length>0};
    }
    const savePlan=async(plan:z.infer<typeof Notification>[])=>{
      if(plan.some(row=>row.tenant_id!==tenant)) throw new AgentError(403,"tenant_mismatch");
      if(plan.length) await sql`insert into notifications ${sql(plan,"tenant_id","recipient_id","type","title","body","link")}`;
    };
    if(p.operation==="feed-posts") {
      const args=postInput.parse(p.input);
      const [fresh]=await sql`select last_seen_post_id from classnote_feed_state where tenant_id=${tenant} and scope='parent_posts' for update`;
      const raced=(fresh?.last_seen_post_id==null?null:Number(fresh.last_seen_post_id))!==args.lastSeenId;
      if(!raced) await savePlan(args.plan);
      await sql`insert into classnote_feed_state(tenant_id,scope,last_seen_post_id,last_polled_at,status,error,updated_at)
        values(${tenant},'parent_posts',${args.watermark},now(),'ok',null,now()) on conflict(tenant_id,scope) do update set
        last_seen_post_id=greatest(coalesce(classnote_feed_state.last_seen_post_id,0),excluded.last_seen_post_id),last_polled_at=now(),status='ok',error=null,updated_at=now()`;
      return {raced};
    }
    const args=commentsInput.parse(p.input);
    const [fresh]=await sql`select updated_at from classnote_feed_state where tenant_id=${tenant} and scope='parent_comments' for update`;
    if((fresh?.updated_at?new Date(fresh.updated_at).toISOString():null)!==args.readAt) return {raced:true};
    await savePlan(args.plan);
    await sql`insert into classnote_feed_state(tenant_id,scope,counts,last_polled_at,status,error,updated_at)
      values(${tenant},'parent_comments',${sql.json(args.counts as never)},now(),'ok',null,now()) on conflict(tenant_id,scope) do update set
      counts=excluded.counts,last_polled_at=now(),status='ok',error=null,updated_at=now()`;
    if(args.mark) await sql`insert into classnote_feed_state(tenant_id,scope,last_seen_post_id,counts,last_polled_at,status,error,updated_at)
      values(${tenant},'parent_comment_events',${args.mark.id},${sql.json({lastCreated:args.mark.created})},now(),'ok',null,now())
      on conflict(tenant_id,scope) do update set counts=case when excluded.last_seen_post_id>=coalesce(classnote_feed_state.last_seen_post_id,0)
      then excluded.counts else classnote_feed_state.counts end,last_seen_post_id=greatest(coalesce(classnote_feed_state.last_seen_post_id,0),excluded.last_seen_post_id),
      last_polled_at=now(),status='ok',error=null,updated_at=now()`;
    return {raced:false};
  });
}
