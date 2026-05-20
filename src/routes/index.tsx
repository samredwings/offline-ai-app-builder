import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "App Forge — Build mobile apps by describing them" },
      {
        name: "description",
        content:
          "Describe an app idea in plain English. Get a multi-page mobile web app you can install on your phone or wrap as an Android APK.",
      },
      { property: "og:title", content: "App Forge — AI App Builder" },
      {
        property: "og:description",
        content: "Describe an idea. Get a working mobile app. No code.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="font-semibold">
          App Forge
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/auth" className="text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90"
          >
            Get started
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-20 pb-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Describe an app.
          <br />
          <span className="text-primary">Get a real one.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          App Forge turns a sentence into a multi-page mobile app you can install on your phone or
          wrap as an Android APK — without writing code.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link
            to="/auth"
            className="rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90"
          >
            Start building free
          </Link>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-6 text-left sm:grid-cols-3">
          {[
            {
              t: "Describe",
              d: "Type one sentence about what you want. We pick the layout, tabs, and colors.",
            },
            {
              t: "Refine",
              d: "Chat to tweak: 'add a stats tab', 'use a darker theme', 'remember entries'.",
            },
            {
              t: "Install",
              d: "Publish and add to your phone's home screen — or get a signed APK for Android.",
            },
          ].map((s) => (
            <div key={s.t} className="rounded-xl border bg-card p-5">
              <div className="font-semibold">{s.t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
