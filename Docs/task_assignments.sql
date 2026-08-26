-- Task assignment system for Tierramor Ops Portal
-- Run in Supabase SQL Editor after reviewing existing schema.

CREATE TABLE public.assigned_tasks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  description              text,
  assigned_to              uuid NOT NULL REFERENCES public.profiles(id),
  assigned_by              uuid NOT NULL REFERENCES public.profiles(id),
  module_key               text NOT NULL CHECK (module_key IN ('alimentos', 'biofabrica', 'vivero')),
  form_key                 text NOT NULL,
  record_resource          text NOT NULL,
  due_date                 date NOT NULL,
  recurrence               text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'weekly', 'biweekly', 'monthly')),
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at             timestamptz,
  completed_by             uuid REFERENCES public.profiles(id),
  completed_record_id      uuid,
  completed_record_resource text,
  source_task_id           uuid REFERENCES public.assigned_tasks(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assigned_tasks_assigned_to_status_due_idx
  ON public.assigned_tasks (assigned_to, status, due_date);

CREATE INDEX assigned_tasks_status_due_idx
  ON public.assigned_tasks (status, due_date);

COMMENT ON TABLE public.assigned_tasks IS
  'Tareas asignadas por admin a perfiles no-admin. Se completan al enviar el formulario requerido.';
