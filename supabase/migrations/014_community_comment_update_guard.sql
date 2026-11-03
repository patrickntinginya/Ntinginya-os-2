create or replace function public.community_guard_comment_retarget()
returns trigger language plpgsql security invoker set search_path = public as $$
declare target_accepts_comments boolean;
begin
  if new.post_id is not distinct from old.post_id then return new; end if;
  if not public.community_can_post() then raise exception 'community_suspended'; end if;

  select p.allow_comments and p.status = 'visible'
    into target_accepts_comments
    from public.community_posts p
    where p.id = new.post_id;
  if target_accepts_comments is distinct from true then raise exception 'comments_closed'; end if;
  return new;
end $$;

drop trigger if exists community_comments_retarget on public.community_comments;
create trigger community_comments_retarget
before update of post_id on public.community_comments
for each row execute function public.community_guard_comment_retarget();
