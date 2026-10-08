create index if not exists sync_agent_events_tenant_occurred_idx
  on public.sync_agent_events(tenant_id,occurred_at desc,event_id desc);
