import { createFileRoute, notFound } from "@tanstack/react-router";

// In local-only mode there is no shared cloud DB to fetch a published app from.
// We keep this route so old links don't 500 — they 404 with a friendly message.
export const Route = createFileRoute("/a/$slug")({
  loader: () => {
    throw notFound();
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">App not available</h1>
        <p className="text-sm text-muted-foreground">
          This builder runs locally on your device. Public web hosting of generated apps is
          disabled — export the APK / web bundle from the builder instead.
        </p>
      </div>
    </div>
  ),
  component: () => null,
});
