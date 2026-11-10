-- CSOD Survey provisional v1 reference data.
-- This is a draft dataset for review. Localities are representative names,
-- not claims about official municipal wards or boundaries.
--
-- Safe to run repeatedly:
--   * city rows are reconciled by slug;
--   * existing zones are left unchanged;
--   * existing question definitions are never updated or deleted.
--
-- No participants or submissions are inserted.

insert into public.cities (name, slug, city_code, is_active)
values
  ('Bhubaneswar', 'bhubaneswar', 'BBS', true),
  ('Mumbai', 'mumbai', 'MUM', true),
  ('Bengaluru', 'bengaluru', 'BLR', true),
  ('Jamshedpur', 'jamshedpur', 'JSP', true),
  ('Patna', 'patna', 'PAT', true)
on conflict (slug) do update
set name = excluded.name,
    is_active = excluded.is_active;

with zone_data (slug, zone_name) as (
  values
    ('bhubaneswar', 'Patia'),
    ('bhubaneswar', 'Chandrasekharpur'),
    ('bhubaneswar', 'Nayapalli'),
    ('bhubaneswar', 'Sahid Nagar'),
    ('bhubaneswar', 'Khandagiri'),
    ('bhubaneswar', 'Old Town'),
    ('bhubaneswar', 'Tamando'),
    ('bhubaneswar', 'Pokhariput'),
    ('bhubaneswar', 'Baramunda'),
    ('bhubaneswar', 'Mancheswar'),
    ('mumbai', 'Andheri'),
    ('mumbai', 'Bandra'),
    ('mumbai', 'Borivali'),
    ('mumbai', 'Dadar'),
    ('mumbai', 'Goregaon'),
    ('mumbai', 'Kurla'),
    ('mumbai', 'Powai'),
    ('mumbai', 'Vikhroli'),
    ('mumbai', 'Chembur'),
    ('mumbai', 'Colaba'),
    ('bengaluru', 'Whitefield'),
    ('bengaluru', 'Electronic City'),
    ('bengaluru', 'Indiranagar'),
    ('bengaluru', 'Koramangala'),
    ('bengaluru', 'Jayanagar'),
    ('bengaluru', 'Malleshwaram'),
    ('bengaluru', 'Yeshwanthpur'),
    ('bengaluru', 'Hebbal'),
    ('bengaluru', 'Rajajinagar'),
    ('bengaluru', 'HSR Layout'),
    ('jamshedpur', 'Bistupur'),
    ('jamshedpur', 'Sakchi'),
    ('jamshedpur', 'Sonari'),
    ('jamshedpur', 'Kadma'),
    ('jamshedpur', 'Mango'),
    ('jamshedpur', 'Adityapur'),
    ('jamshedpur', 'Telco'),
    ('jamshedpur', 'Golmuri'),
    ('jamshedpur', 'Sidhgora'),
    ('jamshedpur', 'Jugsalai'),
    ('patna', 'Patna City'),
    ('patna', 'Kankarbagh'),
    ('patna', 'Rajendra Nagar'),
    ('patna', 'Boring Road'),
    ('patna', 'Bailey Road'),
    ('patna', 'Danapur'),
    ('patna', 'Phulwarisharif'),
    ('patna', 'Gandhi Maidan'),
    ('patna', 'Digha'),
    ('patna', 'Ashiana Nagar')
)
insert into public.city_zones (city_id, zone_name)
select cities.id, zone_data.zone_name
  from zone_data
  join public.cities on cities.slug = zone_data.slug
on conflict (city_id, zone_name) do nothing;

insert into public.survey_questions
  (question_key, question_text, question_type, section, options,
   validation_rules, visibility_rule, is_required, display_order,
   survey_version, is_active)
values
  ('environment_setting', 'Which setting best describes where you spend most of your time?', 'multiple_choice', 'Your environment',
   '["Residential area","Commercial area","Industrial area","Mixed residential and commercial area","Peri-urban or rural edge"]'::jsonb,
   '{"allowed_values":["Residential area","Commercial area","Industrial area","Mixed residential and commercial area","Peri-urban or rural edge"]}'::jsonb,
   null, true, 10, 'v1', true),
  ('main_transport_mode', 'What is your main mode of transportation on a typical day?', 'multiple_choice', 'Daily travel',
   '["Walk","Bicycle","Two-wheeler","Car","Auto-rickshaw","Bus","Metro or local train","Work from home or no regular travel"]'::jsonb,
   '{"allowed_values":["Walk","Bicycle","Two-wheeler","Car","Auto-rickshaw","Bus","Metro or local train","Work from home or no regular travel"]}'::jsonb,
   null, true, 20, 'v1', true),
  ('daily_travel_duration', 'How much time do you usually spend travelling each day?', 'multiple_choice', 'Daily travel',
   '["I do not travel regularly","Less than 30 minutes","30–60 minutes","1–2 hours","More than 2 hours"]'::jsonb,
   '{"allowed_values":["I do not travel regularly","Less than 30 minutes","30–60 minutes","1–2 hours","More than 2 hours"]}'::jsonb,
   null, true, 30, 'v1', true),
  ('daily_outdoor_time', 'How much time do you typically spend outdoors on a usual day?', 'multiple_choice', 'Your environment',
   '["Less than 30 minutes","30 minutes–1 hour","1–3 hours","3–6 hours","More than 6 hours"]'::jsonb,
   '{"allowed_values":["Less than 30 minutes","30 minutes–1 hour","1–3 hours","3–6 hours","More than 6 hours"]}'::jsonb,
   null, true, 40, 'v1', true),
  ('traffic_exposure', 'How often are you close to heavy traffic or congested roads?', 'multiple_choice', 'Pollution exposure',
   '["Never","Rarely","Sometimes","Often","Almost every day"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Almost every day"]}'::jsonb,
   null, true, 50, 'v1', true),
  ('roadside_pollution', 'How often do you notice smoke, dust, or strong exhaust near roads you use?', 'multiple_choice', 'Pollution observations',
   '["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]'::jsonb,
   '{"allowed_values":["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]}'::jsonb,
   null, true, 60, 'v1', true),
  ('nearby_industry', 'Are there industrial facilities or large workshops near places you regularly visit?', 'multiple_choice', 'Local sources',
   '["Yes","No","Not sure"]'::jsonb,
   '{"allowed_values":["Yes","No","Not sure"]}'::jsonb,
   null, true, 70, 'v1', true),
  ('construction_activity', 'How often do you notice dust or activity from construction near you?', 'multiple_choice', 'Local sources',
   '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb,
   null, true, 80, 'v1', true),
  ('waste_burning', 'How often do you see waste or other material being burned outdoors?', 'multiple_choice', 'Local sources',
   '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb,
   null, true, 90, 'v1', true),
  ('observed_pollution_sources', 'Which pollution sources do you commonly observe? Select all that apply.', 'checkboxes', 'Local sources',
   '["Vehicle exhaust","Road dust","Construction dust","Industrial emissions","Waste burning","Diesel generators","Household solid-fuel smoke","Agricultural or seasonal burning","I do not notice these sources","Not sure"]'::jsonb,
   '{"allowed_values":["Vehicle exhaust","Road dust","Construction dust","Industrial emissions","Waste burning","Diesel generators","Household solid-fuel smoke","Agricultural or seasonal burning","I do not notice these sources","Not sure"],"min_items":1,"max_items":5,"mutually_exclusive":["I do not notice these sources","Not sure"]}'::jsonb,
   null, true, 100, 'v1', true),
  ('perceived_air_quality', 'How would you rate the air quality where you are most often?', 'linear_scale', 'Air-quality perception',
   '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
   '{"min":1,"max":10,"step":1,"labels":{"1":"Very poor","10":"Excellent"}}'::jsonb,
   null, true, 110, 'v1', true),
  ('aqi_awareness', 'Before today, had you heard of the Air Quality Index (AQI)?', 'multiple_choice', 'Air-quality awareness',
   '["Yes","No","Not sure"]'::jsonb,
   '{"allowed_values":["Yes","No","Not sure"]}'::jsonb,
   null, true, 120, 'v1', true),
  ('aqi_check_frequency', 'How often do you check or receive information about AQI?', 'multiple_choice', 'Air-quality awareness',
   '["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]'::jsonb,
   '{"allowed_values":["Never","Less than monthly","Monthly","Weekly","Several times a week","Daily"]}'::jsonb,
   null, true, 130, 'v1', true),
  ('pollution_observation_frequency', 'How often do you notice air pollution in your surroundings?', 'multiple_choice', 'Pollution observations',
   '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
   '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb,
   null, true, 140, 'v1', true),
  ('public_transport_awareness', 'How aware are you of public-transport options that could reduce traffic-related pollution?', 'linear_scale', 'Air-quality awareness',
   '["1","2","3","4","5","6","7","8","9","10"]'::jsonb,
   '{"min":1,"max":10,"step":1,"labels":{"1":"Not aware at all","10":"Extremely aware"}}'::jsonb,
   null, true, 150, 'v1', true),
  ('pollution_change', 'Compared with one year ago, how does the air quality around you seem?', 'multiple_choice', 'Air-quality perception',
   '["Much worse","Somewhat worse","About the same","Somewhat better","Much better","Not sure"]'::jsonb,
   '{"allowed_values":["Much worse","Somewhat worse","About the same","Somewhat better","Much better","Not sure"]}'::jsonb,
   null, true, 160, 'v1', true),
  ('air_quality_observation', 'What is one air-quality change or pollution event you have noticed recently?', 'long_text', 'Your observations',
   '[]'::jsonb,
   '{"max_length":1000}'::jsonb,
   null, false, 180, 'v1', true),
  ('improvement_priority', 'Which action would most improve air quality where you live or travel?', 'multiple_choice', 'Your observations',
   '["Cleaner public transport","Better traffic management","Dust control at construction sites","Stronger industrial controls","Prevention of open waste burning","More trees and green spaces","Better air-quality information","Not sure"]'::jsonb,
   '{"allowed_values":["Cleaner public transport","Better traffic management","Dust control at construction sites","Stronger industrial controls","Prevention of open waste burning","More trees and green spaces","Better air-quality information","Not sure"]}'::jsonb,
   null, true, 190, 'v1', true)
on conflict do nothing;

with city_questions (slug, question_key, question_text, question_type, section,
                     options, validation_rules, is_required, display_order) as (
  values
    ('bhubaneswar', 'bbs_seasonal_dust_and_burning', 'During dry or hot periods, how often do you notice dust or outdoor burning affecting your area?', 'multiple_choice', 'Bhubaneswar observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 201),
    ('bhubaneswar', 'bbs_traffic_growth_exposure', 'How often do traffic growth or road works make your usual route feel more polluted?', 'multiple_choice', 'Bhubaneswar observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 202),
    ('mumbai', 'mum_traffic_corridor_exposure', 'How often do you spend time near a major traffic corridor, flyover, or busy junction?', 'multiple_choice', 'Mumbai observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 211),
    ('mumbai', 'mum_construction_dust', 'How often do you notice construction or demolition dust in your neighbourhood?', 'multiple_choice', 'Mumbai observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 212),
    ('bengaluru', 'blr_traffic_idling', 'How often do you experience long vehicle idling or congestion on your regular routes?', 'multiple_choice', 'Bengaluru observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 221),
    ('bengaluru', 'blr_road_dust', 'How often do you notice road dust near active roadworks or unpaved shoulders?', 'multiple_choice', 'Bengaluru observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 222),
    ('jamshedpur', 'jsp_industrial_emissions', 'How often do you notice smoke, dust, or odour that you associate with nearby industrial activity?', 'multiple_choice', 'Jamshedpur observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 231),
    ('jamshedpur', 'jsp_mining_or_material_dust', 'How often do you notice dust from heavy vehicles, material handling, or mining-related movement?', 'multiple_choice', 'Jamshedpur observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 232),
    ('patna', 'pat_road_dust_congestion', 'How often do congestion and road dust affect the air on your regular routes?', 'multiple_choice', 'Patna observations',
     '["Never","Rarely","Sometimes","Often","Daily"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily"]}'::jsonb, false, 241),
    ('patna', 'pat_seasonal_burning', 'How often do you notice smoke that may be related to seasonal or outdoor burning near your area?', 'multiple_choice', 'Patna observations',
     '["Never","Rarely","Sometimes","Often","Daily","Not sure"]'::jsonb,
     '{"allowed_values":["Never","Rarely","Sometimes","Often","Daily","Not sure"]}'::jsonb, false, 242)
)
insert into public.survey_questions
  (question_key, question_text, question_type, section, city_id, options,
   validation_rules, visibility_rule, is_required, display_order,
   survey_version, is_active)
select city_questions.question_key,
       city_questions.question_text,
       city_questions.question_type::public.question_type,
       city_questions.section,
       cities.id,
       city_questions.options,
       city_questions.validation_rules,
       null,
       city_questions.is_required,
       city_questions.display_order,
       'v1',
       true
  from city_questions
  join public.cities on cities.slug = city_questions.slug
on conflict do nothing;
