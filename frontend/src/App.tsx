import React from "react";
import { Route, Switch, Link } from "wouter";
import { Dashboard } from "./pages/Dashboard";
import { ProgrammeDetail } from "./pages/ProgrammeDetail";
import { CourseBuilder } from "./pages/CourseBuilder";
import { EnrolmentFlow } from "./pages/EnrolmentFlow";
import { Messaging } from "./pages/Messaging";
import { Booking } from "./pages/Booking";
import { ReviewCreditAdmin } from "./pages/ReviewCreditAdmin";

export function App() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{ width: 200, padding: 16, borderRight: "1px solid #333" }}>
        {[["/", "Dashboard"], ["/programme/p1", "Programme"], ["/builder", "Course builder"], ["/enrol", "Enrol"], ["/messages", "Messaging"], ["/booking", "Booking"], ["/review-credit", "Review credit"]].map(([href, label]) => (
          <div key={href} style={{ marginBottom: 8 }}><Link href={href}>{label}</Link></div>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24 }}>
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

