const services = [
  { name: 'Signature haircut', detail: 'Consultation, cut & finish', price: '₹799', time: '60 min', accent: 'Cut' },
  { name: 'Colour ritual', detail: 'Bespoke colour & bond care', price: '₹2,499', time: '120 min', accent: 'Colour' },
  { name: 'Skin reset facial', detail: 'Deep cleanse & hydration', price: '₹1,499', time: '75 min', accent: 'Skin' },
];

const team = [
  { initials: 'RS', name: 'Riya Sen', role: 'Creative colourist', tone: 'coral' },
  { initials: 'AK', name: 'Arjun Khanna', role: 'Cut & style director', tone: 'wine' },
  { initials: 'MM', name: 'Meher Malik', role: 'Skin therapist', tone: 'sage' },
];

export default function Home() {
  return (
    <main className="site-shell">
      <nav className="topbar" aria-label="Main navigation">
        <a className="wordmark" href="#top" aria-label="Cutz and Bangs home"><span>CUTZ</span><i>&</i><span>BANGS</span></a>
        <div className="nav-links">
          <a href="#services">Services</a><a href="#studio">Our studio</a><a href="#membership">Membership</a>
        </div>
        <div className="nav-actions"><a className="staff-login" href="/admin">Team login</a><a className="button button-dark nav-book" href="/book">Book a visit</a></div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Unisex salon · Gurugram</p>
          <h1>Good hair.<br/><em>Great energy.</em></h1>
          <p className="hero-intro">Thoughtful cuts, colour and care—shaped around you by artists who listen first.</p>
          <div className="hero-actions"><a className="button button-coral" href="/book">Book an appointment</a><a className="text-link" href="#services">Explore our menu <span>↗</span></a></div>
          <div className="hero-proof"><div className="avatar-stack" aria-hidden="true"><span>SK</span><span>RN</span><span>AM</span></div><p><strong>4.9</strong> from 320+ happy clients</p></div>
        </div>
        <div className="hero-art" aria-label="A calm, welcoming salon experience">
          <div className="arch arch-one"><div className="arch-glow" /></div><div className="arch arch-two"><div className="salon-chair"><span /></div></div>
          <div className="floating-note"><span className="note-kicker">Next available</span><strong>Today, 4:30 PM</strong><span>with Riya · Senior stylist</span></div>
          <span className="spark spark-one">✦</span><span className="spark spark-two">✦</span>
        </div>
      </section>

      <section className="service-strip" id="services">
        <div className="section-heading"><div><p className="eyebrow">Made for your mood</p><h2>Popular right now</h2></div><a className="text-link" href="/book">View all services <span>↗</span></a></div>
        <div className="service-grid">
          {services.map((service, index) => <article className="service-card" key={service.name}><span className="service-number">0{index + 1}</span><div><span className="mini-label">{service.accent}</span><h3>{service.name}</h3><p>{service.detail}</p></div><div className="service-meta"><strong>{service.price}</strong><span>{service.time}</span></div></article>)}
        </div>
      </section>

      <section className="studio-section" id="studio">
        <div className="studio-art"><div className="mirror"><span /></div><p>Open daily<br/><strong>10 AM — 8 PM</strong></p></div>
        <div className="studio-copy"><p className="eyebrow">The Cutz & Bangs way</p><h2>Come as you are.<br/>Leave more yourself.</h2><p>Our studio pairs an unhurried consultation with confident craft. We remember your preferences, keep your history in one place and make every next visit easier.</p><div className="principles"><span><strong>01</strong> We listen</span><span><strong>02</strong> We personalise</span><span><strong>03</strong> We care</span></div></div>
      </section>

      <section className="team-section">
        <div className="section-heading"><div><p className="eyebrow">People who care</p><h2>Meet your artists</h2></div><p className="section-note">Skilled hands, honest advice and zero pressure.</p></div>
        <div className="team-grid">{team.map(member => <article className={`team-card ${member.tone}`} key={member.name}><div className="team-portrait"><span>{member.initials}</span></div><h3>{member.name}</h3><p>{member.role}</p></article>)}</div>
      </section>

      <section className="membership-section" id="membership">
        <div><p className="eyebrow">A little more for regulars</p><h2>₹5,000 of salon credit<br/>for just ₹3,000.</h2><p>Use it your way on eligible services. Your balance and every redemption stay clear in your account.</p><a className="button button-light" href="/customer">Explore membership</a></div>
        <div className="membership-card"><div className="member-mark"><span>C</span><i>&</i><span>B</span></div><p>THE REGULAR</p><strong>₹5,000</strong><small>SALON CREDIT · 6 MONTHS</small><div className="member-line"/><span className="member-name">Made for better hair days</span></div>
      </section>

      <section className="booking-peek" id="book"><div><p className="eyebrow">Your time, beautifully spent</p><h2>Ready for a refresh?</h2></div><a className="button button-light" href="/book">Start booking <span>→</span></a></section>
      <footer className="footer"><a className="wordmark" href="#top"><span>CUTZ</span><i>&</i><span>BANGS</span></a><p>Thoughtful cuts, colour and care.</p><div><a href="/book">Book</a><a href="/customer">My account</a><a href="/admin">Admin</a></div></footer>
    </main>
  );
}
