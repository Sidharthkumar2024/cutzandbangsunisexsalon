import Link from "next/link";

export default function Home() {
  return (
    <main>
      <section className="hero container">
        <h1>Look sharp. Book in seconds.</h1>
        <p>
          Cuts, colour, grooming and memberships for everyone. Reserve your chair online — walk-ins
          welcome too.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/book" className="btn">Book an appointment</Link>
          <Link href="/services" className="btn secondary">View services</Link>
        </div>
      </section>

      <section className="container grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", paddingBottom: 64 }}>
        <div className="card">
          <h3>One history, everywhere</h3>
          <p className="muted">Online or walk-in, your visits, invoices and membership balance stay in one place.</p>
        </div>
        <div className="card">
          <h3>Memberships that pay back</h3>
          <p className="muted">Pay ₹3,000, get ₹5,000 in service credit. Balance never expires unless a plan says so.</p>
        </div>
        <div className="card">
          <h3>Reminders that show up</h3>
          <p className="muted">We nudge you the day before and a couple of hours ahead — no more missed slots.</p>
        </div>
      </section>
    </main>
  );
}
