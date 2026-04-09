-- Migration: contacts
-- Everyone Korakuen transacts with: clients, vendors, partner companies.
-- All contacts must be SUNAT/RENIEC-verified before creation.

CREATE TABLE contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_persona      smallint NOT NULL,                      -- 1=natural, 2=juridica
  ruc               text UNIQUE,                            -- 11 digits (juridica) or 8 (natural w/ RUC)
  dni               text UNIQUE,                            -- 8 digits (natural without RUC)
  razon_social      text NOT NULL,                          -- legal name or full personal name
  nombre_comercial  text,                                   -- trading name (user-entered, editable)
  is_client         boolean NOT NULL DEFAULT false,
  is_vendor         boolean NOT NULL DEFAULT false,
  is_partner        boolean NOT NULL DEFAULT false,
  email             text,
  phone             text,
  address           text,
  -- SUNAT/RENIEC fields — populated by engine, immutable after creation
  sunat_estado      text,                                   -- 'ACTIVO' | 'BAJA DE OFICIO' | etc.
  sunat_condicion   text,                                   -- 'HABIDO' | 'NO HABIDO' | etc.
  sunat_verified    boolean NOT NULL DEFAULT false,
  sunat_verified_at timestamptz NOT NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT contact_has_identifier
    CHECK (ruc IS NOT NULL OR dni IS NOT NULL),

  CONSTRAINT contact_must_be_verified
    CHECK (sunat_verified = true)
);
