/**
 * seed-self-contact.ts — one-off, idempotent seed for contacts.is_self
 *
 * Designates Korakuen's own row in the contacts table by setting is_self=true.
 * If the row does not exist yet, creates it via a fresh SUNAT lookup.
 *
 * Runs as the admin user (not service role) so `auth.uid()` inside the
 * activity_log trigger resolves to Alex's ID and the FK to users(id) is
 * satisfied. This also makes the audit trail truthful: every mutation this
 * script performs is logged under Alex's identity, which is correct — he is
 * the person running it.
 *
 * Run from project root (Node 20+):
 *   npx tsx --env-file=.env.local scripts/seed-self-contact.ts
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               TEST_ADMIN_PASSWORD, DECOLECTA_TOKEN
 *
 * Idempotent: running twice is a no-op on the second run. The partial unique
 * index `contacts_single_self` enforces at-most-one self row at the DB level.
 */

import { createClient } from "@supabase/supabase-js";
import { lookupRuc } from "@/lib/sunat";
import { TIPO_PERSONA } from "@/lib/types";

const KORAKUEN_RUC = "20615457109"; // Constructora Korakuen E.I.R.L.
const ADMIN_EMAIL = "alex.ferreira@korakuen.pe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is not set`);
    console.error(
      "Run with: npx tsx --env-file=.env.local scripts/seed-self-contact.ts",
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const adminPassword = requireEnv("TEST_ADMIN_PASSWORD");
  requireEnv("DECOLECTA_TOKEN"); // consumed inside lookupRuc()

  const supabase = createClient(supabaseUrl, anonKey);

  // Sign in as admin so trigger's auth.uid() resolves to a real users row.
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: adminPassword,
  });
  if (signInErr) {
    console.error(`Failed to sign in as ${ADMIN_EMAIL}:`, signInErr.message);
    process.exit(1);
  }

  // 1. Does a non-deleted row for Korakuen's RUC already exist?
  const { data: existing, error: lookupErr } = await supabase
    .from("contacts")
    .select("id, razon_social, is_self, is_partner")
    .eq("ruc", KORAKUEN_RUC)
    .is("deleted_at", null)
    .maybeSingle();

  if (lookupErr) {
    console.error("Failed to query contacts:", lookupErr.message);
    process.exit(1);
  }

  if (existing) {
    if (existing.is_self) {
      console.log(
        `Already seeded: contact ${existing.id} (${existing.razon_social}) — no-op`,
      );
      return;
    }

    const { error: updateErr } = await supabase
      .from("contacts")
      .update({ is_self: true, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (updateErr) {
      console.error("Failed to set is_self:", updateErr.message);
      process.exit(1);
    }

    console.log(
      `Marked contact ${existing.id} (${existing.razon_social}) as is_self`,
    );
    return;
  }

  // 2. Row does not exist — verify via SUNAT and insert a fresh row.
  console.log(`No contact for RUC ${KORAKUEN_RUC}; calling SUNAT…`);
  const sunat = await lookupRuc(KORAKUEN_RUC);

  if (sunat.warning) {
    console.warn(`SUNAT warning: ${sunat.warning}`);
  }

  const now = new Date().toISOString();
  const row = {
    tipo_persona: sunat.tipo_persona ?? TIPO_PERSONA.juridica,
    ruc: KORAKUEN_RUC,
    dni: null,
    razon_social: sunat.razon_social,
    nombre_comercial: null,
    is_client: false,
    is_vendor: false,
    is_partner: true,
    is_self: true,
    email: null,
    phone: null,
    address: sunat.address,
    sunat_estado: sunat.sunat_estado,
    sunat_condicion: sunat.sunat_condicion,
    sunat_verified: true,
    sunat_verified_at: now,
    notes: null,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("contacts")
    .insert(row)
    .select("id, razon_social")
    .single();

  if (insertErr) {
    console.error("Failed to insert self contact:", insertErr.message);
    process.exit(1);
  }

  console.log(
    `Created contact ${inserted.id} (${inserted.razon_social}) with is_self = true`,
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
