import { getResolvedSiteContent } from '../lib/content-store';

export const dynamic = 'force-dynamic';

const team = [
  { initials: 'RS', name: 'Riya Sen', role: 'Creative colourist', tone: 'coral' },
  { initials: 'AK', name: 'Arjun Khanna', role: 'Cut & style director', tone: 'wine' },
  { initials: 'MM', name: 'Meher Malik', role: 'Skin therapist', tone: 'sage' },
];

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export default async function Home() {
  const content = await getResolvedSiteContent();
  const services = content.services.slice(0, 3);
  const testimonials = content.testimonials.slice(0, 3);
  const membershipPlans = content.membershipPlans.slice(0, 3);

  return (
    <main className="site-shell">
      <nav className="topbar" aria-label="Main navigation">
        <a className="wordmark" href="#top" aria-label="Cutz and Bangs home"><span>CUTZ</span><i>&</i><span>BANGS</span></a>
        <div className="nav-links"><a href="#services">Services</a><a href="#studio">Our studio</a><a href="#membership">Membership</a></div>
        <div className="nav-actions"><a className="staff-login" href="/admin">Team login</a><a className="button button-dark nav-book" href="/book">Book a visit</a></div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Unisex salon · Gurugram</p><h1>Good hair.<br/><em>Great energy.</em></h1>
          <p className="hero-intro">Thoughtful cuts, colour and care—shaped around you by artists who listen first.</p>
          <div className="hero-actions"><a className="button button-coral" href="/book">Book an appointment</a><a className="text-link" href="#services">Explore our menu <span>↗</span></a></div>
          <div className="hero-proof"><div className="avatar-stack" aria-hidden="true"><span>SK</span><span>RN</span><span>AM</span></div><p><strong>4.9</strong> from 320+ happy clients</p></div>
        </div>
        <div className="hero-art" aria-label="A calm, welcoming salon experience"><div className="arch arch-one"><div className="arch-glow" /></div><div className="arch arch-two"><div className="salon-chair"><span /></div></div><div className="floating-note"><span className="note-kicker">Next available</span><strong>Today, 4:30 PM</strong><span>with Riya · Senior stylist</span></div><span className="spark spark-one">✦</span><span className="spark spark-two">✦</span></div>
      </section>

      <section className="service-strip" id="services">
        <div className="section-heading"><div><p className="eyebrow">Made for your mood</p><h2>Popular right now</h2></div><a className="text-link" href="/book">View all services <span>↗</span></a></div>
        <div className="service-grid">{services.map((service, index) => <article className="service-card" key={service.id}><span className="service-number">0{index + 1}</span><div><span className="mini-label">{service.category}</span><h3>{service.name}</h3><p>{service.description}</p></div><div className="service-meta"><strong>{money(service.priceInr)}</strong><span>{service.durationMinutes} min</span></div></article>)}</div>
      </section>

      <section className="studio-section" id="studio"><div className="studio-art"><div className="mirror"><span /></div><p>Open daily<br/><strong>10 AM — 8 PM</strong></p></div><div className="studio-copy"><p className="eyebrow">The Cutz & Bangs way</p><h2>Come as you are.<br/>Leave more yourself.</h2><p>Our studio pairs an unhurried consultation with confident craft. We remember your preferences, keep your history in one place and make every next visit easier.</p><div className="principles"><span><strong>01</strong> We listen</span><span><strong>02</strong> We personalise</span><span><strong>03</strong> We care</span></div></div></section>

      <section className="team-section"><div className="section-heading"><div><p className="eyebrow">People who care</p><h2>Meet your artists</h2></div><p className="section-note">Skilled hands, honest advice and zero pressure.</p></div><div className="team-grid">{team.map(member => <article className={`team-card ${member.tone}`} key={member.name}><div className="team-portrait"><span>{member.initials}</span></div><h3>{member.name}</h3><p>{member.role}</p></article>)}</div></section>

      {testimonials.length > 0 && <section className="testimonial-section" id="reviews">
        <div className="testimonial-heading"><p className="eyebrow">Notes from the chair</p><h2>They came for a service.<br/><em>They stayed for the feeling.</em></h2></div>
        <div className="testimonial-grid">{testimonials.map((item, index) => <article key={item.id} className={index === 1 ? 'featured' : ''}><div className="review-stars" aria-label={`${item.rating} out of 5 stars`}>{'★'.repeat(item.rating)}</div><blockquote>“{item.quote}”</blockquote><footer><span>{item.customerName.split(' ').map(part => part[0]).join('').slice(0,2)}</span><div><strong>{item.customerName}</strong><small>{item.customerDetail}</small></div></footer></article>)}</div>
      </section>}

      <section className="membership-plans-section" id="membership">
        <div className="membership-intro"><p className="eyebrow">A little more for regulars</p><h2>Choose your<br/><em>better hair days.</em></h2><p>Pay once, enjoy extra salon credit and track every redemption clearly in your account.</p></div>
        <div className="public-plan-grid">{membershipPlans.map(plan => <article key={plan.id} className={`public-plan-card ${plan.theme} ${plan.isFeatured ? 'featured' : ''}`}>
          {plan.isFeatured && <span className="popular-plan">Most popular</span>}
          <div className="plan-top"><p>{plan.name}</p><small>{plan.tagline}</small></div>
          <div className="plan-value"><span>Pay <strong>{money(plan.payAmount)}</strong></span><i>→</i><span>Get <strong>{money(plan.creditAmount)}</strong></span></div>
          <p className="plan-description">{plan.description}</p>
          <ul>{plan.perks.map(perk => <li key={perk}><span>✓</span>{perk}</li>)}</ul>
          <div className="plan-bottom"><span>{plan.validityMonths ? `${plan.validityMonths} months validity` : 'No expiry'}</span><a href="/customer">Choose plan →</a></div>
        </article>)}</div>
      </section>

      <section className="booking-peek" id="book"><div><p className="eyebrow">Your time, beautifully spent</p><h2>Ready for a refresh?</h2></div><a className="button button-light" href="/book">Start booking <span>→</span></a></section>
      <footer className="footer"><a className="wordmark" href="#top"><span>CUTZ</span><i>&</i><span>BANGS</span></a><p>Thoughtful cuts, colour and care.</p><div><a href="/book">Book</a><a href="/customer">My account</a><a href="/admin">Admin</a></div></footer>
    </main>
  );
}
