-- Seguimiento de Siembra por lote
-- Ejecutar una vez en Supabase SQL Editor. No usar BEGIN/ROLLBACK.

ALTER TABLE public.plantings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'lost')),
  ADD COLUMN IF NOT EXISTS establishment_due_date date,
  ADD COLUMN IF NOT EXISTS location_note text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS closure_reason text;

CREATE INDEX IF NOT EXISTS plantings_active_bed_idx
  ON public.plantings (bed_id, date DESC)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.planting_lot_followups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planting_id     uuid NOT NULL REFERENCES public.plantings(id) ON DELETE CASCADE,
  date            date NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN ('establishment', 'observation', 'incident', 'count')),
  live_count      integer CHECK (live_count >= 0),
  growth_stage    text,
  health_status   text CHECK (health_status IN ('healthy', 'attention', 'critical')),
  issue_type      text,
  severity        text CHECK (severity IN ('low', 'medium', 'high')),
  actions_taken   text,
  observations    text,
  photo_urls      text[],
  performed_by    uuid NOT NULL REFERENCES public.profiles(id),
  created_by      uuid NOT NULL REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planting_lot_followups_planting_date_idx
  ON public.planting_lot_followups (planting_id, date DESC);

CREATE TABLE IF NOT EXISTS public.planting_lot_status_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planting_id     uuid NOT NULL REFERENCES public.plantings(id) ON DELETE CASCADE,
  date            date NOT NULL,
  previous_status text,
  status          text NOT NULL CHECK (status IN ('active', 'closed', 'lost')),
  reason          text,
  observations    text,
  performed_by    uuid NOT NULL REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planting_lot_status_events_planting_date_idx
  ON public.planting_lot_status_events (planting_id, date DESC);

-- Snapshot de los lotes que recibieron una actividad. No guarda cantidades exactas
-- por lote: los costos se calculan como estimación con reparto igual.
CREATE TABLE IF NOT EXISTS public.input_application_plantings (
  application_id  uuid NOT NULL REFERENCES public.input_applications(id) ON DELETE CASCADE,
  planting_id     uuid NOT NULL REFERENCES public.plantings(id) ON DELETE RESTRICT,
  allocation_method text NOT NULL DEFAULT 'equal_estimate'
    CHECK (allocation_method IN ('equal_estimate')),
  PRIMARY KEY (application_id, planting_id)
);

CREATE TABLE IF NOT EXISTS public.area_maintenance_plantings (
  maintenance_id  uuid NOT NULL REFERENCES public.area_maintenance(id) ON DELETE CASCADE,
  planting_id     uuid NOT NULL REFERENCES public.plantings(id) ON DELETE RESTRICT,
  PRIMARY KEY (maintenance_id, planting_id)
);

COMMENT ON TABLE public.planting_lot_followups IS
  'Seguimientos event-driven de lotes de siembra: establecimiento, observaciones, incidencias y conteos.';
COMMENT ON TABLE public.input_application_plantings IS
  'Lotes activos detectados automáticamente al registrar una aplicación. El costo por lote es una estimación de reparto igual.';
