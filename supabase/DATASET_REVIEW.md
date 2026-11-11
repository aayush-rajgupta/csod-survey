# CSOD Survey provisional v1 dataset review

This is a provisional draft for CSOD-Test review. The localities are
recognisable representative neighbourhoods, not claims that they are official
municipal wards or boundaries. The questionnaire is a draft citizen-science
instrument, not a validated scientific instrument.

## Seed guarantees

- Survey version is `v1`.
- Common questions use `city_id = null` and are inserted once.
- City-specific questions are attached to their matching city.
- City and zone inserts are idempotent.
- Questions use `ON CONFLICT DO NOTHING`; existing definitions are never
  updated or deleted.
- The city upsert never updates an established `city_code`; existing remote
  values remain canonical.
- No participants, submissions, answers, or consent records are inserted.
- Choice options are JSON arrays and validation rules are JSON objects.

## Cities and representative localities

| City | Code | Slug | Localities |
|---|---|---|---|
| Bhubaneswar | `BBS` | `bhubaneswar` | Patia; Chandrasekharpur; Nayapalli; Sahid Nagar; Khandagiri; Old Town; Tamando; Pokhariput; Baramunda; Mancheswar |
| Mumbai | `MUM` | `mumbai` | Andheri; Bandra; Borivali; Dadar; Goregaon; Kurla; Powai; Vikhroli; Chembur; Colaba |
| Bengaluru | `BLR` | `bengaluru` | Whitefield; Electronic City; Indiranagar; Koramangala; Jayanagar; Malleshwaram; Yeshwanthpur; Hebbal; Rajajinagar; HSR Layout |
| Jamshedpur | `JSP` | `jamshedpur` | Bistupur; Sakchi; Sonari; Kadma; Mango; Adityapur; Telco; Golmuri; Sidhgora; Jugsalai |
| Patna | `PAT` | `patna` | Patna City; Kankarbagh; Rajendra Nagar; Boring Road; Bailey Road; Danapur; Phulwarisharif; Gandhi Maidan; Digha; Ashiana Nagar |

## Common questions

All common questions are active, use `v1`, have the displayed order below, and
use the listed options and validation rules. Required means `is_required =
true`.

| Order | Key | Type | Required | Options | Validation |
|---:|---|---|:---:|---|---|
| 10 | `environment_setting` | `multiple_choice` | Yes | Residential area; Commercial area; Industrial area; Mixed residential and commercial area; Peri-urban or rural edge | `allowed_values` must contain the selected option |
| 20 | `main_transport_mode` | `multiple_choice` | Yes | Walk; Bicycle; Two-wheeler; Car; Auto-rickshaw; Bus; Metro or local train; Work from home or no regular travel | `allowed_values` |
| 30 | `daily_travel_duration` | `multiple_choice` | Yes | I do not travel regularly; Less than 30 minutes; 30–60 minutes; 1–2 hours; More than 2 hours | `allowed_values` |
| 40 | `daily_outdoor_time` | `multiple_choice` | Yes | Less than 30 minutes; 30 minutes–1 hour; 1–3 hours; 3–6 hours; More than 6 hours | `allowed_values` |
| 50 | `traffic_exposure` | `multiple_choice` | Yes | Never; Rarely; Sometimes; Often; Almost every day | `allowed_values` |
| 60 | `roadside_pollution` | `multiple_choice` | Yes | Never; Less than monthly; Monthly; Weekly; Several times a week; Daily | `allowed_values` |
| 70 | `nearby_industry` | `multiple_choice` | Yes | Yes; No; Not sure | `allowed_values` |
| 80 | `construction_activity` | `multiple_choice` | Yes | Never; Rarely; Sometimes; Often; Daily | `allowed_values` |
| 90 | `waste_burning` | `multiple_choice` | Yes | Never; Rarely; Sometimes; Often; Daily; Not sure | `allowed_values` |
| 100 | `observed_pollution_sources` | `checkboxes` | Yes | Vehicle exhaust; Road dust; Construction dust; Industrial emissions; Waste burning; Diesel generators; Household solid-fuel smoke; Agricultural or seasonal burning; I do not notice these sources; Not sure | `allowed_values`, `min_items: 1`, `max_items: 5`, and `I do not notice these sources`/`Not sure` are mutually exclusive with every other selection |
| 110 | `perceived_air_quality` | `linear_scale` | Yes | 1; 2; 3; 4; 5 | Integer `1..5`, step 1; 1 = Very poor, 5 = Very good |
| 120 | `aqi_awareness` | `multiple_choice` | Yes | Yes; No; Not sure | `allowed_values` |
| 130 | `aqi_check_frequency` | `multiple_choice` | Yes | Never; Less than monthly; Monthly; Weekly; Several times a week; Daily | `allowed_values` |
| 140 | `pollution_observation_frequency` | `multiple_choice` | Yes | Never; Rarely; Sometimes; Often; Daily | `allowed_values` |
| 150 | `public_transport_awareness` | `linear_scale` | Yes | 1; 2; 3; 4; 5 | Integer `1..5`, step 1; 1 = Not aware, 5 = Very aware |
| 160 | `pollution_change` | `multiple_choice` | Yes | Much worse; Somewhat worse; About the same; Somewhat better; Much better; Not sure | `allowed_values` |
| 180 | `air_quality_observation` | `long_text` | No | None | `max_length: 1000` |
| 190 | `improvement_priority` | `multiple_choice` | Yes | Cleaner public transport; Better traffic management; Dust control at construction sites; Stronger industrial controls; Prevention of open waste burning; More trees and green spaces; Better air-quality information; Not sure | `allowed_values` |

## City-specific questions

All are active, optional, use `v1`, and use `multiple_choice`. Every question
has the listed `allowed_values` validation.

| City | Order | Key | Question | Options |
|---|---:|---|---|---|
| Bhubaneswar | 201 | `bbs_seasonal_dust_and_burning` | During dry or hot periods, how often do you notice dust or outdoor burning affecting your area? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Bhubaneswar | 202 | `bbs_traffic_growth_exposure` | How often do traffic growth or road works make your usual route feel more polluted? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Mumbai | 211 | `mum_traffic_corridor_exposure` | How often do you spend time near a major traffic corridor, flyover, or busy junction? | Never; Rarely; Sometimes; Often; Daily |
| Mumbai | 212 | `mum_construction_dust` | How often do you notice construction or demolition dust in your neighbourhood? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Bengaluru | 221 | `blr_traffic_idling` | How often do you experience long vehicle idling or congestion on your regular routes? | Never; Rarely; Sometimes; Often; Daily |
| Bengaluru | 222 | `blr_road_dust` | How often do you notice road dust near active roadworks or unpaved shoulders? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Jamshedpur | 231 | `jsp_industrial_emissions` | How often do you notice smoke, dust, or odour that you associate with nearby industrial activity? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Jamshedpur | 232 | `jsp_mining_or_material_dust` | How often do you notice dust from heavy vehicles, material handling, or mining-related movement? | Never; Rarely; Sometimes; Often; Daily; Not sure |
| Patna | 241 | `pat_road_dust_congestion` | How often do congestion and road dust affect the air on your regular routes? | Never; Rarely; Sometimes; Often; Daily |
| Patna | 242 | `pat_seasonal_burning` | How often do you notice smoke that may be related to seasonal or outdoor burning near your area? | Never; Rarely; Sometimes; Often; Daily; Not sure |

## Review notes

- Locality names were selected as recognisable city neighbourhoods using
  publicly available locality references. Confirm them before describing them
  as official geographic units.
- The dataset collects no name, phone, address, demographic, health, or exact
  location fields.
- The optional free-text answer should be reviewed by the application layer
  before any future public display.

## Validation boundary

The deployed `submit_participant_survey` function enforces the structural
submission rules: verified participant, active city and zone relationship, one
active survey version, required-question presence, active question membership,
non-null answers, and duplicate-question rejection. It does **not** interpret
the JSONB `validation_rules` object, including `min_items`, `max_items`, or
`mutually_exclusive`. The server-side participant submission validator is the
current enforcement layer for those rules. A future migration is required if
database-level enforcement is needed; this dataset-only refinement does not
silently claim that the RPC enforces them.
