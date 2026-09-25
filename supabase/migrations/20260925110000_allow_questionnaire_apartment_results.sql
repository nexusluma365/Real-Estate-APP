alter table public.apartment_results
  drop constraint if exists apartment_results_category_check;

alter table public.apartment_results
  add constraint apartment_results_category_check
  check (category in ('questionnaire', 'modern', 'luxury', 'apartment_prep'));
