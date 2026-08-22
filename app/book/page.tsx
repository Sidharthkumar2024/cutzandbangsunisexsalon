'use client';

import { useMemo, useState } from 'react';
import { submitBooking } from '../../lib/client-api';

const serviceOptions = [
  { id: 'cut-style', category: 'Hair', name: 'Signature cut & style', duration: 60, price: 799, staff: ['riya', 'arjun'] },
  { id: 'global-colour', category: 'Colour', name: 'Global colour ritual', duration: 120, price: 2499, staff: ['riya'] },
  { id: 'hair-spa', category: 'Hair', name: 'Restorative hair spa', duration: 75, price: 1299, staff: ['riya', 'arjun'] },
  { id: 'skin-reset', category: 'Skin', name: 'Skin reset facial', duration: 75, price: 1499, staff: ['meher'] },
  { id: 'beard-sculpt', category: 'Grooming', name: 'Beard sculpt & care', duration: 35, price: 499, staff: ['arjun'] },
  { id: 'manicure', category: 'Nails', name: 'Essential manicure', duration: 45, price: 699, staff: ['meher'] },
];

const staff = {
  riya: { name: 'Riya Sen', role: 'Colour specialist', initials: 'RS' },
  arjun: { name: 'Arjun Khanna', role: 'Style director', initials: 'AK' },
  meher: { name: 'Meher Malik', role: 'Skin therapist', initials: 'MM' },
};

const dates = ['Sat, 22 Aug', 'Sun, 23 Aug', 'Mon, 24 Aug', 'Tue, 25 Aug'];
const slots = ['10:00 AM', '11:30 AM', '1:00 PM', '3:30 PM', '4:30 PM', '6:00 PM'];
const stepLabels = ['Services', 'Artists', 'Time', 'Details'];

export default function BookingPage() {
  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState('All services');
  const [selected, setSelected] = useState<string[]>(['cut-style']);
  const [assignments, setAssignments] = useState<Record<string, string>>({ 'cut-style': 'arjun' });
  const [date, setDate] = useState(dates[0]);
  const [time, setTime] = useState('4:30 PM');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const chosen = serviceOptions.filter(service => selected.includes(service.id));
  const total = chosen.reduce((sum, service) => sum + service.price, 0);
  const duration = chosen.reduce((sum, service) => sum + service.duration, 0);
  const canContinue = step === 0 ? selected.length > 0 : step === 1 ? chosen.every(service => assignments[service.id]) : step === 2 ? !!date && !!time : name.trim().length > 1 && phone.trim().length >= 8;

  const toggleService = (id: string) => {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    const service = serviceOptions.find(item => item.id === id);
    if (service && !assignments[id]) setAssignments(current => ({ ...current, [id]: service.staff[0] }));
  };

  const firstAvailable = useMemo(() => chosen[0]?.id ?? '', [chosen]);

  const continueFlow = async () => {
    setError('');
    if (!canContinue) return;
    if (step < 3) { setStep(current => current + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setLoading(true);
    try {
      const result = await submitBooking({ audience, services: chosen.map(service => ({ id: service.id, staffId: assignments[service.id] })), date, time, customer: { name, phone, email } });
      setReference(result.reference); setStep(4);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong.'); }
    finally { setLoading(false); }
  };

  if (step === 4) return (
    <main className="booking-shell confirmation-shell">
      <a className="booking-brand" href="/"><span>CUTZ</span><i>&</i><span>BANGS</span></a>
      <section className="confirmation-card"><div className="success-orbit"><span>✓</span></div><p className="eyebrow">You’re all set</p><h1>See you in the chair, {name.split(' ')[0]}.</h1><p>Your appointment is confirmed for <strong>{date} at {time}</strong>. We’ll send the details to {phone}.</p><div className="confirmation-reference"><span>Booking reference</span><strong>{reference}</strong></div><div className="confirmation-actions"><a className="button button-dark" href="/customer">View my appointments</a><a className="text-link" href="/">Back to home <span>↗</span></a></div></section>
    </main>
  );

  return (
    <main className="booking-shell">
      <header className="booking-header"><a className="booking-brand" href="/"><span>CUTZ</span><i>&</i><span>BANGS</span></a><a className="booking-close" href="/" aria-label="Close booking">×</a></header>
      <div className="booking-layout">
        <section className="booking-main">
          <div className="booking-progress" aria-label={`Step ${step + 1} of 4`}>
            {stepLabels.map((label, index) => <button key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} onClick={() => index < step && setStep(index)}><span>{index < step ? '✓' : index + 1}</span>{label}</button>)}
          </div>

          {step === 0 && <div className="booking-panel"><p className="eyebrow">Step 1 of 4</p><h1>What can we do for you?</h1><div className="audience-switch" role="group" aria-label="Service audience">{['For her', 'For him', 'All services'].map(option => <button key={option} className={audience === option ? 'active' : ''} onClick={() => setAudience(option)}>{option}</button>)}</div><div className="option-list">{serviceOptions.map(service => { const isSelected = selected.includes(service.id); return <button className={`service-option ${isSelected ? 'selected' : ''}`} key={service.id} onClick={() => toggleService(service.id)} aria-pressed={isSelected}><span className="option-check">{isSelected ? '✓' : '+'}</span><span className="option-copy"><small>{service.category}</small><strong>{service.name}</strong><span>{service.duration} min</span></span><strong>₹{service.price.toLocaleString('en-IN')}</strong></button> })}</div></div>}

          {step === 1 && <div className="booking-panel"><p className="eyebrow">Step 2 of 4</p><h1>Choose an artist for each service.</h1><p className="booking-lead">Only team members qualified and available for the selected service are shown.</p><div className="artist-assignments">{chosen.map(service => <article key={service.id}><div className="assignment-head"><span className="option-check">✓</span><div><small>{service.category}</small><h3>{service.name}</h3></div></div><div className="artist-grid">{service.staff.map(staffId => { const artist = staff[staffId as keyof typeof staff]; return <button key={staffId} className={assignments[service.id] === staffId ? 'selected' : ''} onClick={() => setAssignments(current => ({ ...current, [service.id]: staffId }))}><span className="artist-avatar">{artist.initials}</span><span><strong>{artist.name}</strong><small>{artist.role}</small></span><i>{assignments[service.id] === staffId ? '✓' : ''}</i></button> })}</div></article>)}</div></div>}

          {step === 2 && <div className="booking-panel"><p className="eyebrow">Step 3 of 4</p><h1>Pick a time that feels good.</h1><p className="booking-lead">Showing conflict-free slots for all {chosen.length} {chosen.length === 1 ? 'service' : 'services'} and assigned artists.</p><div className="date-row">{dates.map(item => <button key={item} className={date === item ? 'selected' : ''} onClick={() => setDate(item)}><small>{item.split(', ')[0]}</small><strong>{item.split(' ')[1]}</strong><span>{item.split(' ')[2]}</span></button>)}</div><div className="slot-heading"><h3>Available times</h3><span>{Math.floor(duration / 60)}h {duration % 60 || ''}{duration % 60 ? 'm' : ''} total</span></div><div className="time-grid">{slots.map(slot => <button key={slot} className={time === slot ? 'selected' : ''} onClick={() => setTime(slot)}>{slot}</button>)}</div><div className="availability-note"><span>i</span><p><strong>Need another time?</strong><br/>Call us at +91 98765 43210 and we’ll see what we can do.</p></div></div>}

          {step === 3 && <div className="booking-panel"><p className="eyebrow">Step 4 of 4</p><h1>Where should we send the details?</h1><p className="booking-lead">No account needed. We’ll use these details only for this booking and its reminders.</p><div className="booking-form"><label>Full name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoComplete="name" /></label><label>Mobile number<input value={phone} onChange={event => setPhone(event.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoComplete="tel" /></label><label>Email <span>Optional</span><input value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email" /></label><label className="consent-row"><input type="checkbox" defaultChecked/><span>Send appointment updates and reminders on WhatsApp/SMS.</span></label></div>{error && <p className="form-error" role="alert">{error}</p>}</div>}

          <div className="booking-footer"><button className="back-button" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0}>← Back</button><button className="button button-coral" disabled={!canContinue || loading} onClick={continueFlow}>{loading ? 'Confirming…' : step === 3 ? 'Confirm appointment' : 'Continue'} <span>→</span></button></div>
        </section>

        <aside className="booking-summary"><p className="eyebrow">Your visit</p><h2>{chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'service' : 'services'}` : 'Choose a service'}</h2><div className="summary-items">{chosen.map(service => <div key={service.id}><span><strong>{service.name}</strong><small>{service.duration} min {assignments[service.id] ? `· ${staff[assignments[service.id] as keyof typeof staff].name}` : ''}</small></span><strong>₹{service.price.toLocaleString('en-IN')}</strong></div>)}</div>{step >= 2 && <div className="summary-time"><span>◷</span><p><strong>{date}</strong><br/>{time}</p></div>}<div className="summary-total"><span><small>Estimated total</small><strong>₹{total.toLocaleString('en-IN')}</strong></span><small>{duration} min</small></div><p className="summary-promise">Free reschedule up to 3 hours before your visit.</p></aside>
      </div>
    </main>
  );
}
