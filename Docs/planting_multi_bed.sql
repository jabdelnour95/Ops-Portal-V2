-- Un lote de siembra puede abarcar varias camas.
-- Ejecutar una vez, después de Docs/planting_lot_tracking.sql.

CREATE TABLE IF NOT EXISTS public.planting_beds (
  planting_id uuid NOT NULL REFERENCES public.plantings(id) ON DELETE CASCADE,
  bed_id      uuid NOT NULL REFERENCES public.beds(id),
  PRIMARY KEY (planting_id, bed_id)
);

-- Conserva todos los lotes existentes como lotes de una cama.
INSERT INTO public.planting_beds (planting_id, bed_id)
SELECT id, bed_id FROM public.plantings
ON CONFLICT (planting_id, bed_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS planting_beds_bed_idx
  ON public.planting_beds (bed_id, planting_id);

COMMENT ON TABLE public.planting_beds IS
  'Camas incluidas en un lote de siembra. plantings.bed_id conserva la primera cama por compatibilidad.';
