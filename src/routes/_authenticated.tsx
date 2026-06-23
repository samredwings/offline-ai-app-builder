import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { canEnter, lock } from "@/lib/local-auth";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (!(await canEnter())) {
      throw redirect({ to: "/auth" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  function signOut() {
    lock();
    navigate({ to: "/auth" });
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/dashboard" className="font-semibold">
            App Forge
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/settings">
              <Button size="sm" variant="ghost">Settings</Button>
            </Link>
            <Link to="/new">
              <Button size="sm">New app</Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Lock
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
