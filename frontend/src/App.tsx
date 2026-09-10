import { Route, Switch, Link, useRoute } from "wouter";
import { Dashboard } from "./pages/Dashboard";
import { ProgrammeDetail } from "./pages/ProgrammeDetail";
import { CourseBuilder } from "./pages/CourseBuilder";
import { EnrolmentFlow } from "./pages/EnrolmentFlow";
import { Messaging } from "./pages/Messaging";
import { Booking } from "./pages/Booking";
import { ReviewCreditAdmin } from "./pages/ReviewCreditAdmin";

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

export function App() {
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
