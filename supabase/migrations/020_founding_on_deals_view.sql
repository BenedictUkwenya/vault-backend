-- Recreate deals_with_business with founding fields.
-- CREATE OR REPLACE cannot change column order/names — must drop first.
DROP VIEW IF EXISTS deals_with_business;

CREATE VIEW deals_with_business AS
SELECT
  d.*,
  b.name            AS business_name,
  b.logo_url        AS business_logo_url,
  b.city            AS business_city,
  b.state           AS business_state,
  b.is_approved     AS business_is_approved,
  b.is_founding_member AS business_is_founding_member,
  b.founding_member_number AS business_founding_member_number,
  c.name            AS category_name,
  c.id              AS category_id
FROM deals d
JOIN businesses b ON d.business_id = b.id
LEFT JOIN categories c ON b.category_id = c.id;
