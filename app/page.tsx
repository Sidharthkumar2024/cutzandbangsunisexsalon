import { getResolvedSiteContent } from '../lib/content-store';

export const dynamic = 'force-dynamic';

const team = [
  { initials: 'HC', name: 'Hair & cut experts', role: 'Consultation-led cuts and styling', tone: 'coral' },
  { initials: 'CC', name: 'Colour specialists', role: 'Colour, care and transformation', tone: 'wine' },
  { initials: 'GB', name: 'Grooming & beauty', role: 'Skin, nails and grooming rituals', tone: 'sage' },
];

const business = {
  name: 'Cutz & Bangs Unisex Salon',
  address: 'First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059',
  latitude: 28.6166967,
  longitude: 77.0283703,
  instagram: 'https://www.instagram.com/cutzandbangs/',
  facebook: 'https://www.facebook.com/profile.php?id=61582192802691',
  directions: 'https://www.google.com/maps/search/?api=1&query=28.6166967%2C77.0283703',
};

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export default async function Home() {
  const content = await getResolvedSiteContent();
  const services = content.services.slice(0, 3);
  const testimonials = content.testimonials.slice(0, 3);
  const membershipPlans = content.membershipPlans.slice(0, 3);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'BeautySalon',
    '@id': 'https://cutz-bangs.sidharthkumar2028.chatgpt.site/#salon',
    name: business.name,
    url: 'https://cutz-bangs.sidharthkumar2028.chatgpt.site/',
    image: 'https://cutz-bangs.sidharthkumar2028.chatgpt.site/og.png',
    priceRange: '₹₹',
    address: { '@type': 'PostalAddress', streetAddress: 'First Floor, Plot No. 118, Main Kakrola Road, Patel Garden', addressLocality: 'Dwarka', addressRegion: 'Delhi', postalCode: '110059', addressCountry: 'IN' },
    geo: { '@type': 'GeoCoordinates', latitude: business.latitude, longitude: business.longitude },
    areaServed: ['Sector 15 Dwarka', 'Dwarka', 'New Delhi'],
    sameAs: [business.instagram, business.facebook],
    openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '10:00', closes: '20:00' }],
  };

  return (
    <main className="site-shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <nav className="topbar" aria-label="Main navigation">
        <a className="wordmark" href="#top" aria-label="Cutz and Bangs home"><span>CUTZ</span><i>&</i><span>BANGS</span></a>
        <div className="nav-links"><a href="#services">Services</a><a href="#studio">Our studio</a><a href="#membership">Membership</a><a href="#visit">Visit</a></div>
        <div className="nav-actions"><a className="staff-login" href="/customer">Sign in</a><a className="staff-login" href="/admin">Team login</a><a className="button button-dark nav-book" href="/book">Book a visit</a></div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Unisex salon · Sector 15 Dwarka</p><h1>Good hair.<br/><em>Great energy.</em></h1>
          <p className="hero-intro">Thoughtful cuts, colour and care—shaped around you by artists who listen first.</p>
          <div className="hero-actions"><a className="button button-coral" href="/book">Book an appointment</a><a className="text-link" href="#services">Explore our menu <span>↗</span></a></div>
          <div className="hero-proof"><div className="avatar-stack" aria-hidden="true"><span>CU</span><span>&</span><span>BA</span></div><p><strong>Dwarka</strong> appointments and walk-ins welcome</p></div>
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

      <section className="visit-section" id="visit">
        <div className="visit-copy"><p className="eyebrow">Find us in Dwarka</p><h2>Your next visit,<br/><em>easy to find.</em></h2><address>{business.address}</address><p>First-floor salon on Main Kakrola Road, serving Sector 15 Dwarka and nearby neighbourhoods.</p><div className="visit-actions"><a className="button button-coral" href={business.directions} target="_blank" rel="noreferrer">Get directions</a><a href={business.instagram} target="_blank" rel="noreferrer">Instagram ↗</a><a href={business.facebook} target="_blank" rel="noreferrer">Facebook ↗</a></div></div>
        <iframe title="Cutz & Bangs Unisex Salon location in Sector 15 Dwarka" src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3502.4358449397055!2d77.02837029999999!3d28.6166967!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390d05f93ff5bc51%3A0xdc23c9b9f0a73dea!2sCutz%20%26%20Bangs%20Unisex%20Salon!5e0!3m2!1sen!2sin!4v1787408457453!5m2!1sen!2sin" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
      </section>

      <section className="booking-peek" id="book"><div><p className="eyebrow">Your time, beautifully spent</p><h2>Ready for a refresh?</h2></div><a className="button button-light" href="/book">Start booking <span>→</span></a></section>
      <footer className="footer"><a className="wordmark" href="#top"><span>CUTZ</span><i>&</i><span>BANGS</span></a><p>Sector 15 Dwarka · New Delhi 110059</p><div><a href="/book">Book</a><a href="/customer">My account</a><a href="/staff">Staff</a><a href="/admin">Admin</a></div></footer>
    </main>
  );
}
