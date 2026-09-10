import { useState } from "react";
import { Route, Switch, Link, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { ProgrammeDetail } from "./pages/ProgrammeDetail";
import { CourseBuilder } from "./pages/CourseBuilder";
import { EnrolmentFlow } from "./pages/EnrolmentFlow";
import { Messaging } from "./pages/Messaging";
import { Booking } from "./pages/Booking";
import { ReviewCreditAdmin } from "./pages/ReviewCreditAdmin";
import { Login } from "./pages/Login";
import { getToken, clearSession } from "./api/client";

const qc = new QueryClient();

const links: [string, string][] = [
  ["/", "Dashboard"],
  ["/programme/p1", "Programme"],
  ["/builder", "Course builder"],
  ["/enrol", "Enrol"],
  ["/messages", "Messaging"],
  ["/booking", "Booking"],
  ["/review-credit", "Review credit"],
];

function NavLink({ href, label }: { href: string; label: string }) {
  const [active] = useRoute(href === "/" ? "/" : href + "/:rest?");
  const exact = href === "/" ? window.location.pathname === "/" : window.location.pathname.startsWith(href);
  return (
    <Link href={href} className={"nav-link" + (active || exact ? " active" : "")}>
      {label}
    </Link>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="layout">
      <nav className="sidebar">
        <p className="brand">
          TrainHub<span>360</span>
        </p>
        <p className="brand-sub">Corporate training platform</p>
        {links.map(([href, label]) => (
          <NavLink key={href} href={href} label={label} />
        ))}
        <button className="btn" onClick={onLogout} style={{ marginTop: 16, background: "transparent", border: "1px solid var(--border)" }}>
          Sign out
        </button>
      </nav>
      <main className="main">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/programme/:id" component={ProgrammeDetail} />
          <Route path="/builder" component={CourseBuilder} />
          <Route path="/enrol" component={EnrolmentFlow} />
          <Route path="/messages" component={Messaging} />
          <Route path="/booking" component={Booking} />
          <Route path="/review-credit" component={ReviewCreditAdmin} />
        </Switch>
      </main>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  return (
    <QueryClientProvider client={qc}>
      {authed ? (
        <Shell
          onLogout={() => {
            clearSession();
            setAuthed(false);
          }}
        />
      ) : (
        <Login onDone={() => setAuthed(true)} />
      )}
    </QueryClientProvider>
  );
}
