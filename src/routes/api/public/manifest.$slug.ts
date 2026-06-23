import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/manifest/$slug")({
  server: {
    handlers: {
      GET: async () => new Response("Not found", { status: 404 }),
    },
  },
});
