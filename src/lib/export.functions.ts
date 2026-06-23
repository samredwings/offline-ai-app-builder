// Export APK bundle — local, in-browser zipping.
import { zipSync, strToU8 } from "fflate";
import { getProjectRow, getVersion } from "./local-db";
import { renderAppHTML } from "./app-runtime";
import type { Tab } from "./types";

// Kept for backward compat with the editor UI; AI runtime is now configured globally
// in Settings, not per-project.
export async function updateAIRuntime(_opts: unknown) {
  return { ok: true };
}

const README_TEMPLATE = (opts: {
  title: string;
  slug: string;
}) => `# ${opts.title} — APK export bundle

This bundle contains a static web build of your app plus a Capacitor Android shell.

## Build steps

1. Install Android Studio (free) and Node.js 20+
2. \`npm install\` inside this folder
3. \`npx cap sync android\`
4. \`npx cap open android\` → Build → Build APK(s)

The signed APK lands in \`android/app/build/outputs/apk/\`.

App slug: \`${opts.slug}\`
`;

const PACKAGE_JSON_TEMPLATE = (slug: string) => `{
  "name": "${slug}-apk",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "sync": "cap sync android",
    "open": "cap open android"
  },
  "dependencies": {
    "@capacitor/android": "^6.1.2",
    "@capacitor/core": "^6.1.2"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.1.2"
  }
}
`;

const CAPACITOR_CONFIG = (title: string, slug: string) =>
  JSON.stringify(
    {
      appId: `app.local.${slug.replace(/[^a-z0-9]/g, "")}`,
      appName: title,
      webDir: "www",
    },
    null,
    2,
  );

export async function exportAPKBundle({
  data,
}: {
  data: { projectId: string; origin: string };
}) {
  const project = await getProjectRow(data.projectId);
  if (!project) throw new Error("Not found");
  if (!project.current_version_id) throw new Error("No current version");
  const version = await getVersion(data.projectId, project.current_version_id);
  const tabs = (version?.tabs ?? []) as Tab[];

  const indexHTML = renderAppHTML({
    slug: project.slug,
    title: project.title,
    theme: project.theme,
    iconUrl: project.icon_url,
    tabs,
    manifestUrl: "manifest.webmanifest",
  });

  const manifest = {
    name: project.title,
    short_name: project.title.slice(0, 12),
    start_url: "./index.html",
    display: "standalone",
    background_color: project.theme.background,
    theme_color: project.theme.primary,
    icons: [],
  };

  const files: Record<string, Uint8Array> = {
    "README.md": strToU8(README_TEMPLATE({ title: project.title, slug: project.slug })),
    "package.json": strToU8(PACKAGE_JSON_TEMPLATE(project.slug)),
    "capacitor.config.json": strToU8(CAPACITOR_CONFIG(project.title, project.slug)),
    "www/index.html": strToU8(indexHTML),
    "www/manifest.webmanifest": strToU8(JSON.stringify(manifest, null, 2)),
    ".gitignore": strToU8("node_modules\nandroid/app/build\nandroid/.gradle\n"),
  };

  const zipped = zipSync(files, { level: 6 });
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < zipped.length; i += chunk) {
    bin += String.fromCharCode(...zipped.subarray(i, i + chunk));
  }
  return {
    filename: `${project.slug}-apk-bundle.zip`,
    base64: btoa(bin),
  };
}
