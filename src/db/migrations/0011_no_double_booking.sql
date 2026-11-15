-- The rule against double-booking (F20, playbook 8.11, data-model Section 6).
-- No two active appointments for the same person may overlap, counting the
-- blocked time after each one. It is keyed on the person, not her membership,
-- so it holds across every business she works at. Drizzle cannot express an
-- exclusion constraint, so it is written here by hand.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_double_booking"
  EXCLUDE USING gist (
    "professional_user_id" WITH =,
    tstzrange("starts_at", "blocked_until", '[)') WITH &&
  )
  WHERE ("status" = 'active' AND "professional_user_id" IS NOT NULL);
