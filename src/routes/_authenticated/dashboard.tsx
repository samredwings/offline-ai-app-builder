import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listMyProjects, deleteProject } from "@/lib/projects.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Your apps — App Forge" }] }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listMyProjects(),
  });

  const delMut = useMutation({
    mutationFn: (projectId: string) => deleteProject({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Deleted");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Your apps</h1>
          <p className="text-sm text-muted-foreground">Describe an idea, get a working app.</p>
        </div>
        <Button onClick={() => navigate({ to: "/new" })}>+ New app</Button>
      </div>

      {isLoading ? (
        <p className="mt-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <div className="mt-16 rounded-xl border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No apps yet.</p>
          <Link to="/new" className="mt-4 inline-block">
            <Button>Create your first app</Button>
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <div
              key={p.id}
              className="group rounded-xl border bg-card p-4 transition-all hover:shadow-md"
            >
              <Link
                to="/editor/$id"
                params={{ id: p.id }}
                className="flex items-center gap-4"
              >
                {p.icon_url ? (
                  <img src={p.icon_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
                ) : (
                  <div
                    className="h-12 w-12 rounded-xl"
                    style={{ background: p.theme?.primary ?? "#4f46e5" }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.title}</div>
                  <div className="flex gap-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <span>ID: {p.id.slice(0, 8)}</span>
                    <span>{new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Progress</span>
                  <span>{p.progress.done}/{p.progress.total} ({p.progress.pct}%)</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${p.progress.pct}%` }} />
                </div>
                {p.lastStatic && (
                  <div
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      p.lastStatic.passed
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : "bg-red-500/10 text-red-700 dark:text-red-400"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${p.lastStatic.passed ? "bg-green-500" : "bg-red-500"}`} />
                    {p.lastStatic.passed
                      ? `Tests pass${p.lastStatic.issueCount > 0 ? ` (${p.lastStatic.issueCount} warnings)` : ""}`
                      : `${p.lastStatic.issueCount} issue${p.lastStatic.issueCount === 1 ? "" : "s"}`}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <Link to="/editor/$id" params={{ id: p.id }}>
                  <Button variant="outline" size="sm">Edit app</Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete "${p.title}"?`)) delMut.mutate(p.id);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
