-- Migration: cost_categories final list
--
-- Replaces the placeholder seed (Materiales, Mano de Obra, Alquiler de Equipos,
-- Viaticos, Otros) with the canonical 11-category taxonomy approved on
-- 2026-04-19. Renames two existing rows, adds descriptions and sort_order to
-- all five existing rows, and inserts the six new categories.
--
-- Renames:
--   "Alquiler de Equipos" → "Alquiler Equipos"
--   "Viaticos"            → "Viáticos Ingenieros"
--
-- Idempotent: rename UPDATEs filter on the old name (no-op on re-run); the
-- upsert uses ON CONFLICT against cost_categories_parent_name_key.
--
-- Safe to apply: zero rows currently reference cost_categories
-- (verified against payment_lines, incoming_invoice_line_items, project_budgets
-- on 2026-04-19).

-- ============================================================
-- Step 1: rename the two relabeled rows
-- ============================================================

UPDATE cost_categories
   SET name = 'Alquiler Equipos'
 WHERE parent_id IS NULL AND name = 'Alquiler de Equipos';

UPDATE cost_categories
   SET name = 'Viáticos Ingenieros'
 WHERE parent_id IS NULL AND name = 'Viaticos';

-- ============================================================
-- Step 2: upsert the canonical 11-row top-level taxonomy
-- ============================================================

INSERT INTO cost_categories (name, parent_id, sort_order, is_active, description) VALUES
  ('Materiales',          NULL,  1, true,
   'Insumos físicos que se incorporan a la obra: fierro, cemento, maderas, calaminas, yeso, afirmado, clavos, alambre, encofrados, concreto, materiales eléctricos, de gasfitería y sanitarios.'),
  ('Mano de Obra',        NULL,  2, true,
   'Sueldos y salarios del personal obrero directo: obreros, maestro de obra, soldador, almacenero.'),
  ('Servicios Terceros',  NULL,  3, true,
   'Servicios profesionales y trabajos subcontratados: topógrafo, ensayo de suelos (EMS), revisión estructural, notario, expediente técnico, planos, eliminación de desmonte (volquetadas).'),
  ('Alquiler Equipos',    NULL,  4, true,
   'Alquiler de maquinaria y equipos mayores: retroexcavadora, grúa, estación total, caseta prefabricada, trompo (mezcladora).'),
  ('Herramientas',        NULL,  5, true,
   'Herramientas menores y consumibles de trabajo: picos, palanas, sierras, brocas, reglas, winchas, vibrador, máquina de soldar, pintura, brochas.'),
  ('Seguridad y Salud',   NULL,  6, true,
   'Gastos de seguridad y salud ocupacional: SCTR, exámenes médicos, EPPs, señalización, baño químico, bloqueador solar, zapatos de seguridad.'),
  ('Transporte',          NULL,  7, true,
   'Transporte de materiales y envíos: fletes de maderas, fierros, cemento, calaminas, fenólicos; movilidad de equipos e insumos, envíos.'),
  ('Gastos Operativos',   NULL,  8, true,
   'Funcionamiento del sitio: oficina y almacén (mesas, sillas, impresora, piso), cartel de obra, caja chica, útiles de oficina, agua para obra, cochera, pizarras.'),
  ('Viáticos Ingenieros', NULL,  9, true,
   'Estadía del personal técnico: comida, pasajes, housing, uniformes para ingenieros.'),
  ('Socios',              NULL, 10, true,
   'Permanencia de los socios en la obra (100% del tiempo): comida, housing, pasajes, taxi, estacionamiento, gasolina, alquiler y mantenimiento de carro (llantas, inflador, etc.) y accesorios relacionados.'),
  ('Otros',               NULL, 99, true,
   'Gastos residuales de monto menor que no encajan claramente en las categorías anteriores.')
ON CONFLICT ON CONSTRAINT cost_categories_parent_name_key DO UPDATE
  SET sort_order  = EXCLUDED.sort_order,
      description = EXCLUDED.description,
      is_active   = EXCLUDED.is_active,
      updated_at  = now();
