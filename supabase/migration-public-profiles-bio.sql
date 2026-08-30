-- Include bio in public_profiles view
drop view if exists public_profiles;
create view public_profiles as
select
  user_id,
  username,
  display_name,
  avatar_url,
  bio
from profiles;

-- Grant select on public_profiles view
grant select on public_profiles to anon, authenticated;
