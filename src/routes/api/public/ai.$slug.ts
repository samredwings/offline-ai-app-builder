import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/ai/$slug")({
  server: {
    handlers: {
      POST: async () =>
        new Response("Cloud AI proxy is disabled in local-only mode.", { status: 410 }),
    },
  },
});
