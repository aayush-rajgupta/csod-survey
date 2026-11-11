-- next_participant_id returns a public text ID; keep the UUID participant key separate.
create or replace function public.register_participant(
  p_email text,
  p_city_id uuid,
  p_zone_id uuid,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns table (participant_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_email text := public.normalize_email(p_email);
  new_public_participant_id text;
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'Participant email is required';
  end if;

  if p_session_token_hash is null or p_session_token_hash = '' then
    raise exception 'Participant session is required';
  end if;

  if p_session_expires_at <= clock_timestamp() then
    raise exception 'Participant session expiry must be in the future';
  end if;

  if not exists (
    select 1
      from public.cities
     where id = p_city_id
       and is_active
  ) then
    raise exception 'Selected city is unavailable';
  end if;

  if not exists (
    select 1
      from public.city_zones
     where id = p_zone_id
       and city_id = p_city_id
       and is_active
  ) then
    raise exception 'Selected zone is unavailable for this city';
  end if;

  new_public_participant_id := public.next_participant_id(p_city_id);

  insert into public.participants
    (public_participant_id, email, email_verified, email_verified_at, city_id)
  values
    (new_public_participant_id, normalized_email, false, null, p_city_id)
  returning id into register_participant.participant_id;

  insert into public.participant_sessions
    (participant_id, session_token_hash, expires_at)
  values
    (register_participant.participant_id, p_session_token_hash, p_session_expires_at);

  return next;
end;
$$;

revoke all on function public.register_participant(text, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_participant(text, uuid, uuid, text, timestamptz)
  to service_role;
