-- Preserve client appointment history by blocking professional-account deletion while it is referenced.
alter table public.marketplace_appointments
  drop constraint marketplace_appointments_professional_id_fkey,
  add constraint marketplace_appointments_professional_id_fkey
    foreign key (professional_id)
    references public.marketplace_professionals(user_id)
    on delete restrict;
