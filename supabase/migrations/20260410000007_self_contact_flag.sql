-- Migration: contacts.is_self flag
-- Single canonical marker for "which contact row is Korakuen itself".
-- Korakuen lives in the contacts table alongside its two partner companies
-- (all three with is_partner = true); is_self distinguishes the one that IS us.
--
-- Seeding is handled by scripts/seed-self-contact.ts (not this migration) —
-- the row must be SUNAT-verified, which requires calling the decolecta API.

ALTER TABLE contacts
  ADD COLUMN is_self boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX contacts_single_self
  ON contacts (is_self)
  WHERE is_self = true;
