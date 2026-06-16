-- 1) Scope ai_logs SELECT to authenticated role only
DROP POLICY IF EXISTS "owners view own ai logs" ON public.ai_logs;
CREATE POLICY "owners view own ai logs"
ON public.ai_logs
FOR SELECT
TO authenticated
USING (
  project_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ai_logs.project_id AND p.owner_id = auth.uid()
  )
);

-- 2) Enforce device_key matches request header on app_data INSERT
DROP POLICY IF EXISTS "anyone insert app data for published projects" ON public.app_data;
CREATE POLICY "anyone insert app data for published projects"
ON public.app_data
FOR INSERT
TO public
WITH CHECK (
  device_key IS NOT NULL
  AND device_key = ((current_setting('request.headers', true))::json ->> 'x-device-key')
  AND app_private.is_project_published(project_id)
);