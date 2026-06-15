
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_project_published(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.is_published = true);
$$;

REVOKE ALL ON FUNCTION app_private.is_project_published(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_project_published(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "anyone insert app data for published projects" ON public.app_data;
DROP POLICY IF EXISTS "read own device app data for published projects" ON public.app_data;
DROP POLICY IF EXISTS "update own device app data for published projects" ON public.app_data;

CREATE POLICY "anyone insert app data for published projects"
  ON public.app_data FOR INSERT
  WITH CHECK (app_private.is_project_published(project_id));

CREATE POLICY "read own device app data for published projects"
  ON public.app_data FOR SELECT
  USING (
    device_key IS NOT NULL
    AND device_key = ((current_setting('request.headers'::text, true))::json ->> 'x-device-key'::text)
    AND app_private.is_project_published(project_id)
  );

CREATE POLICY "update own device app data for published projects"
  ON public.app_data FOR UPDATE
  USING (
    device_key IS NOT NULL
    AND device_key = ((current_setting('request.headers'::text, true))::json ->> 'x-device-key'::text)
    AND app_private.is_project_published(project_id)
  )
  WITH CHECK (
    device_key IS NOT NULL
    AND device_key = ((current_setting('request.headers'::text, true))::json ->> 'x-device-key'::text)
    AND app_private.is_project_published(project_id)
  );

DROP FUNCTION IF EXISTS public.is_project_published(uuid);
