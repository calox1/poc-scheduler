/* CalOx POC Scheduler — static front end on Supabase.
   The key below is Supabase's publishable key: it is meant to be public.
   All data access is enforced by row-level security on the database. */
const SUPABASE_URL = 'https://ifbyxisptgovlovmzasy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zhsXeZeE-xoS7MmFr0S3nw_iot7HQCy';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');

const S = { session: null, profile: null, turnaround: 3, fleetFilter: 'all', fleetQ: '', calStart: null, svcSel: null, booking: null };
let renderToken = 0;

/* ---------- helpers ---------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const toD = s => new Date(s + 'T00:00:00Z');
const toS = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
const dow = s => toD(s).getUTCDay();
const isWknd = s => [0, 6].includes(dow(s));
const addBiz = (s, n) => { let d = s, k = 0; while (k < n) { d = addDays(d, 1); if (!isWknd(d)) k++; } return d; };
const lastWeekdayBefore = s => { let d = addDays(s, -1); while (isWknd(d)) d = addDays(d, -1); return d; };
const firstWeekdayAfter = s => { let d = addDays(s, 1); while (isWknd(d)) d = addDays(d, 1); return d; };
const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
const fmt = s => s ? toD(s).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '—';
const fmtShort = s => s ? toD(s).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '—';
const fmtTs = t => t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const can = (...roles) => S.profile && roles.includes(S.profile.role);

const STATUS = {
  available: 'Available', reserved: 'Reserved', deliver_today: 'Deliver today', delivery_overdue: 'Delivery overdue',
  out: 'Out with patient', pickup_due: 'Pickup due', pickup_overdue: 'Pickup overdue',
  in_service: 'In service', repair: 'Out of service: repair', retired: 'Retired'
};
const STAGE = { incoming: 'Received', cleaning: 'Cleaning', service: 'Service or repair', testing: 'Testing', ready: 'Ready for release' };
const pill = st => `<span class="pill s-${esc(st)}">${esc(STATUS[st] || st)}</span>`;

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, err ? 7000 : 3500);
}
function dbError(e, fallback = 'Something went wrong. Please try again.') {
  console.error(e);
  if (!e) return toast(fallback, true);
  if (e.code === '23P01') return toast('That unit is already booked for overlapping dates. Pick another unit or change the dates.', true);
  if (e.code === '23514') return toast('The dates are out of order: deliver by ≤ departs ≤ returns ≤ pick up.', true);
  if (e.code === '23505') return toast('That entry already exists.', true);
  if (e.code === '42501') return toast('Your role does not allow that change.', true);
  toast(e.message || fallback, true);
}

/* ---------- auth ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (!session) return renderSignIn();
  const { data: prof, error } = await sb.from('profiles').select('full_name, role').eq('user_id', session.user.id).maybeSingle();
  if (error) { dbError(error); }
  S.profile = prof || null;
  $('#who').hidden = false;
  $('#whoName').textContent = prof ? `${prof.full_name} · ${roleName(prof.role)}` : session.user.email;
  if (!prof) return renderNoAccess();
  const { data: st } = await sb.from('settings').select('value').eq('key', 'turnaround_business_days').maybeSingle();
  if (st) S.turnaround = parseInt(st.value, 10) || 3;
  $('#nav').hidden = false;
  $$('#nav a').forEach(a => { const r = a.dataset.roles; a.hidden = r ? !r.split(' ').includes(prof.role) : false; });
  route();
}
const roleName = r => ({ csr: 'CSR', servicing: 'Servicing', admin: 'Admin' }[r] || r);

function renderSignIn() {
  $('#nav').hidden = true; $('#who').hidden = true;
  app.innerHTML = `<div class="signin"><div class="card">
    <h1 style="font-size:26px">Sign in</h1>
    <p class="muted">Use your caloxinc.com Google account.</p>
    <button id="gsign" class="btn" type="button" style="width:100%;justify-content:center">Sign in with Google</button>
  </div></div>`;
  $('#gsign').onclick = () => sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { hd: 'caloxinc.com', prompt: 'select_account' } }
  });
}
function renderNoAccess() {
  $('#nav').hidden = true;
  app.innerHTML = `<div class="signin"><div class="card">
    <h1 style="font-size:26px">No access yet</h1>
    <p class="muted">${esc(S.session.user.email)} is not on the POC scheduler staff list. Ask an admin to add you, then sign in again.</p>
  </div></div>`;
}
$('#signOut').onclick = async () => { await sb.auth.signOut(); location.hash = ''; boot(); };
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_IN' && !S.profile) boot(); });

/* ---------- routing ---------- */
window.addEventListener('hashchange', () => S.profile && route());
function route() {
  const [tab, arg] = (location.hash.slice(1) || 'fleet').split('/');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab || (tab === 'unit' && a.dataset.tab === 'fleet')));
  const tok = ++renderToken;
  const pages = { fleet, calendar, book, unit: t => unit(t, arg), service, admin };
  (pages[tab] || fleet)(tok).catch(e => dbError(e));
}
const stale = tok => tok !== renderToken;

/* ---------- fleet ---------- */
const GROUPS = {
  available: ['available'],
  out: ['reserved', 'deliver_today', 'delivery_overdue', 'out', 'pickup_due', 'pickup_overdue'],
  action: ['deliver_today', 'delivery_overdue', 'pickup_due', 'pickup_overdue'],
  service: ['in_service', 'repair']
};
async function fleet(tok) {
  const { data, error } = await sb.from('unit_board').select('*').order('model').order('serial_number');
  if (stale(tok)) return; if (error) return dbError(error);
  const units = data.filter(u => u.board_status !== 'retired');
  const n = list => units.filter(u => list.includes(u.board_status)).length;
  const today = todayPT();

  let rows = S.fleetFilter === 'all' ? units : units.filter(u => GROUPS[S.fleetFilter].includes(u.board_status));
  const q = S.fleetQ.trim().toLowerCase();
  if (q) rows = rows.filter(u => [u.serial_number, u.account_code, u.model, u.destination].some(v => (v || '').toLowerCase().includes(q)));

  const tasks = units.filter(u => GROUPS.action.includes(u.board_status)).map(u => {
    const red = u.board_status.endsWith('overdue'), pick = u.board_status.startsWith('pickup');
    return `<div class="task ${red ? 'red' : pick ? 'amber' : ''}"><div class="tag">${esc(STATUS[u.board_status])}</div>
      <div><a href="#unit/${u.id}"><b class="mono">${esc(u.serial_number)}</b></a> ${pick ? 'from' : 'to'} <span class="mono">${esc(u.account_code)}</span></div>
      <div class="muted" style="font-size:14px">${esc(u.destination)} — ${pick ? 'pickup ' + fmt(u.pickup_date) : 'deliver by ' + fmt(u.deliver_by)}</div></div>`;
  }).join('') || '<p class="muted">Nothing due today.</p>';

  const chip = (id, label) => `<button class="chip" type="button" data-f="${id}" aria-pressed="${S.fleetFilter === id}">${label}</button>`;
  app.innerHTML = `
  <div class="pagehead"><div><h1>POC fleet status</h1><p class="muted">${fmt(today)} — every portable concentrator by serial number</p></div>
    ${can('csr', 'admin') ? '<a class="btn" href="#book">Book a trip</a>' : ''}</div>
  <div class="grid-kpi">
    ${kpi('Available now', n(GROUPS.available), 'var(--green-fg)')}
    ${kpi('Scheduled or out', n(GROUPS.out), 'var(--blue-700)')}
    ${kpi('Needs action', n(GROUPS.action), 'var(--red-fg)')}
    ${kpi('In service', n(GROUPS.service), 'var(--gray-700)')}
    ${kpi('Total fleet', units.length, 'var(--gray-900)')}
  </div>
  <div class="split"><section class="main card" style="padding:0">
    <div class="toolbar"><div class="chips">${chip('all', 'All units')}${chip('available', 'Available')}${chip('out', 'Scheduled or out')}${chip('action', 'Needs action')}${chip('service', 'In service')}</div>
      <label class="f">Search<input id="fq" class="mono" placeholder="Serial or account code" value="${esc(S.fleetQ)}" style="width:220px"></label></div>
    <div class="tablebox"><table><thead><tr><th>Serial</th><th>Model</th><th>Status</th><th>Account</th><th>Destination</th><th>Trip</th><th>Deliver by</th><th>Pick up</th><th>Ready again</th></tr></thead><tbody>
    ${rows.map(u => `<tr>
      <td><a class="mono" href="#unit/${u.id}">${esc(u.serial_number)}</a>${u.airline_approved ? '' : ' <span class="muted" title="Not airline approved">(ground)</span>'}</td>
      <td>${esc(u.model)}</td><td>${pill(u.board_status)}</td>
      <td class="mono">${esc(u.account_code || '—')}</td><td>${esc(u.destination || '—')}</td>
      <td class="nowrap">${u.depart_date ? fmtShort(u.depart_date) + ' – ' + fmtShort(u.return_date) : '—'}</td>
      <td>${fmtShort(u.deliver_by)}</td><td>${fmtShort(u.pickup_date)}</td>
      <td><b>${u.board_status === 'available' ? 'Now' : u.board_status === 'repair' ? 'Not set' : fmtShort(u.expected_ready_date || u.ready_date)}</b></td></tr>`).join('')
      || '<tr><td colspan="9" class="muted" style="text-align:center;padding:28px">No units match.</td></tr>'}
    </tbody></table></div></section>
    <aside class="side"><section class="card"><h2>Needs action today</h2>${tasks}</section>
      <section class="note"><b style="color:var(--blue-700)">Turnaround rule.</b> After each pickup a unit is held ${S.turnaround} business days for cleaning, service, testing and prep before it can go out again.</section></aside>
  </div>`;
  $$('.chip').forEach(b => b.onclick = () => { S.fleetFilter = b.dataset.f; route(); });
  const fq = $('#fq'); fq.oninput = () => { S.fleetQ = fq.value; clearTimeout(fq._t); fq._t = setTimeout(() => { route(); setTimeout(() => { const e = $('#fq'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 0); }, 250); };
}
const kpi = (l, v, c) => `<div class="card kpi"><div class="lab">${l}</div><div class="val" style="color:${c}">${v}</div></div>`;

/* ---------- calendar ---------- */
async function calendar(tok) {
  const today = todayPT();
  if (!S.calStart) S.calStart = addDays(today, -((dow(today) + 6) % 7));
  const start = S.calStart, DAYS = 21, end = addDays(start, DAYS - 1);
  const [u, b, s] = await Promise.all([
    sb.from('poc_units').select('id, serial_number, model, state').neq('state', 'retired').order('model').order('serial_number'),
    sb.from('bookings').select('*').neq('status', 'cancelled').lte('deliver_by', end).gte('ready_date', start),
    sb.from('service_records').select('*').is('released_at', null)
  ]);
  if (stale(tok)) return; for (const r of [u, b, s]) if (r.error) return dbError(r.error);

  const days = [...Array(DAYS)].map((_, i) => addDays(start, i));
  const seg = (from, to, cls, label, title) => {
    if (!from || !to || to < start || from > end || to < from) return '';
    const a = from < start ? start : from, z = to > end ? end : to;
    return `<div class="bar ${cls}" style="grid-column:${daysBetween(start, a) + 2} / ${daysBetween(start, z) + 3}" title="${esc(title)}">${esc(label)}</div>`;
  };
  const rows = u.data.map(unit => {
    let bars = '';
    const manual = s.data.find(r => r.unit_id === unit.id && !r.booking_id);
    if (unit.state === 'repair' && !manual) bars += seg(start, end, 'b-repair', 'Out of service: repair', 'Unit is in repair');
    b.data.filter(x => x.unit_id === unit.id).forEach(x => {
      bars += seg(x.deliver_by, x.deliver_by, 'b-deliver', 'D', `Deliver to ${x.account_code} by ${fmt(x.deliver_by)}`);
      bars += seg(addDays(x.deliver_by, 1), addDays(x.pickup_date, -1), 'b-trip', 'Trip: ' + x.destination, `${x.account_code}: ${x.destination}, ${fmt(x.depart_date)} – ${fmt(x.return_date)}`);
      const late = x.status === 'delivered' && x.pickup_date < today;
      bars += seg(x.pickup_date, x.pickup_date, late ? 'b-late' : 'b-pickup', 'P', `Pick up ${fmt(x.pickup_date)}${late ? ' (overdue)' : ''}`);
      bars += seg(addDays(x.pickup_date, 1), x.ready_date, 'b-hold', 'Turnaround', `Cleaning, service, testing, prep. Ready ${fmt(x.ready_date)}`);
    });
    s.data.filter(r => r.unit_id === unit.id && !r.booking_id).forEach(r => {
      bars += seg(today, r.expected_ready_date || end, 'b-hold', STAGE[r.stage], `In service. Ready ${fmt(r.expected_ready_date)}`);
    });
    return `<div class="cal-row"><div class="cal-name"><a class="mono" href="#unit/${unit.id}">${esc(unit.serial_number)}</a><div class="muted" style="font-size:12px">${esc(unit.model)}</div></div>${bars}</div>`;
  }).join('');

  const head = days.map(d => `<div class="cal-day ${d === today ? 'today' : isWknd(d) ? 'wknd' : ''}" style="grid-row:1">${toD(d).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })}<b>${toD(d).getUTCDate()}</b></div>`).join('');
  const sw = (cls, l) => `<span><span class="sw bar ${cls}" style="display:inline-block"></span>${l}</span>`;
  app.innerHTML = `
  <div class="pagehead"><div><h1>Scheduling calendar</h1><p class="muted">${fmt(start)} – ${fmt(end)}. Blank days are open to book.</p></div>
    <div class="btnrow" style="margin:0"><button class="btn btn-ghost" id="cp" type="button">Previous week</button><button class="btn btn-ghost" id="ct" type="button">Today</button><button class="btn btn-ghost" id="cn" type="button">Next week</button>
    ${can('csr', 'admin') ? '<a class="btn" href="#book">Book a trip</a>' : ''}</div></div>
  <div class="legend">${sw('b-deliver', 'Delivery')}${sw('b-trip', 'With patient')}${sw('b-pickup', 'Pickup')}${sw('b-hold', 'Turnaround or service')}${sw('b-repair', 'Out of service')}</div>
  <section class="card tablebox" style="padding:0"><div class="cal">
    <div class="cal-row cal-head"><div class="cal-name" style="grid-row:1;font-size:12px;font-weight:600;text-transform:uppercase;color:var(--gray-600)">Serial</div>${head}</div>
    ${rows}</div></section>`;
  $('#cp').onclick = () => { S.calStart = addDays(S.calStart, -7); route(); };
  $('#cn').onclick = () => { S.calStart = addDays(S.calStart, 7); route(); };
  $('#ct').onclick = () => { S.calStart = null; route(); };
}

/* ---------- book a trip ---------- */
async function book(tok) {
  if (!can('csr', 'admin')) { app.innerHTML = '<p class="muted">Only CSRs and admins can book trips.</p>'; return; }
  const B = S.booking = S.booking || { flying: true, units: null, pick: null, touchedDeliver: false, touchedPickup: false };
  app.innerHTML = `
  <div class="pagehead"><div><h1>Book a trip</h1><p class="muted">Enter the travel dates, then find a unit that is free for the whole window, turnaround included.</p></div></div>
  <div class="split"><form id="bf" class="main" style="display:flex;flex-direction:column;gap:20px" autocomplete="off">
    <section class="card"><h2>Account and destination</h2><div class="formgrid">
      <label class="f">Account code<input name="account_code" class="mono" required placeholder="CALXXXXX00"></label>
      <label class="f">Destination<input name="destination" required placeholder="City, state or country"></label>
    </div>
    <label class="check"><input type="checkbox" name="flying" ${B.flying ? 'checked' : ''}> Patient is flying — only offer airline-approved units</label>
    <label class="f">Notes <small>Optional. Do not enter patient names or medical details.</small><textarea name="notes"></textarea></label></section>
    <section class="card"><h2>Travel dates</h2><div class="formgrid">
      <label class="f">Departs<input type="date" name="depart_date" required></label>
      <label class="f">Arrives at destination <small>Optional</small><input type="date" name="arrive_date"></label>
      <label class="f">Returns home<input type="date" name="return_date" required></label>
    </div><div class="formgrid" style="margin-top:16px">
      <label class="f">Deliver to patient by<input type="date" name="deliver_by" required><small>Suggested: last weekday before departure</small></label>
      <label class="f">Pick up on<input type="date" name="pickup_date" required><small>Suggested: first weekday after return</small></label>
    </div><div class="btnrow"><button class="btn btn-ghost" type="button" id="find">Find available units</button></div></section>
    <section class="card" id="unitsBox" hidden><h2>Choose a unit</h2><div id="unitList"></div></section>
    <div class="btnrow" style="margin:0"><button class="btn" type="submit" id="save" disabled>Save booking</button><a class="btn btn-ghost" href="#fleet">Cancel</a></div>
  </form>
  <aside class="side"><section class="card"><h2>Schedule preview</h2><div id="preview" class="muted">Enter the dates to see the schedule.</div></section>
    <section class="note">The unit is held from delivery until ${S.turnaround} business days after pickup, for cleaning, service, testing and prep.</section></aside></div>`;
  const f = $('#bf'), v = n => f.elements[n].value;
  const preview = () => {
    const d = v('deliver_by'), p = v('pickup_date');
    if (!d || !p) return;
    const ready = addBiz(p, S.turnaround), steps = [
      ['Deliver to patient', d], ['Patient departs', v('depart_date')], ['Arrives', v('arrive_date')], ['Returns home', v('return_date')],
      ['Pick up', p], ['Cleaning, service, testing, prep', null, `${fmtShort(addDays(p, 1))} – ${fmtShort(ready)}`], ['Ready for next trip', ready]];
    $('#preview').innerHTML = steps.filter(s => s[1] || s[2]).map(s => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--gray-100)"><span>${s[0]}</span><b>${s[2] || fmt(s[1])}</b></div>`).join('');
  };
  const resetUnits = () => { B.units = null; B.pick = null; $('#unitsBox').hidden = true; $('#save').disabled = true; };
  f.addEventListener('input', e => {
    const n = e.target.name;
    if (n === 'deliver_by') B.touchedDeliver = true;
    if (n === 'pickup_date') B.touchedPickup = true;
    if (n === 'depart_date' && v('depart_date') && !B.touchedDeliver) f.elements.deliver_by.value = lastWeekdayBefore(v('depart_date'));
    if (n === 'return_date' && v('return_date') && !B.touchedPickup) f.elements.pickup_date.value = firstWeekdayAfter(v('return_date'));
    if (n === 'account_code') e.target.value = e.target.value.toUpperCase();
    if (n === 'flying') B.flying = e.target.checked;
    if (['depart_date', 'return_date', 'deliver_by', 'pickup_date', 'flying'].includes(n)) resetUnits();
    preview();
  });
  const datesOk = () => {
    const d = v('deliver_by'), dep = v('depart_date'), r = v('return_date'), p = v('pickup_date');
    if (!d || !dep || !r || !p) { toast('Fill in departs, returns, deliver by and pick up first.', true); return false; }
    if (!(d <= dep && dep <= r && r <= p)) { toast('Dates must run in order: deliver by ≤ departs ≤ returns ≤ pick up.', true); return false; }
    if (d < todayPT()) { toast('Deliver-by date is in the past.', true); return false; }
    return true;
  };
  $('#find').onclick = async () => {
    if (!datesOk()) return;
    const { data, error } = await sb.rpc('available_units', { p_deliver: v('deliver_by'), p_pickup: v('pickup_date') });
    if (error) return dbError(error);
    B.units = B.flying ? data.filter(x => x.airline_approved) : data;
    B.pick = null; $('#save').disabled = true; $('#unitsBox').hidden = false;
    $('#unitList').innerHTML = B.units.length ? `<p class="muted" style="margin-top:0">${B.units.length} unit(s) free for the whole window.</p>` + B.units.map(x => `
      <label class="check" style="border:1px solid var(--gray-200);border-radius:6px;padding:8px 12px;margin-bottom:8px">
      <input type="radio" name="unit" value="${x.id}"><span class="mono" style="min-width:110px">${esc(x.serial_number)}</span><span style="flex:1">${esc(x.model)}</span><span class="muted" style="font-size:13px">${esc(x.notes || '')}</span></label>`).join('')
      : '<p class="muted">No units are free for those dates. Try different dates.</p>';
    $$('input[name=unit]').forEach(r => r.onchange = () => { B.pick = r.value; $('#save').disabled = false; });
  };
  f.onsubmit = async e => {
    e.preventDefault();
    if (!B.pick || !datesOk()) return;
    if (!v('account_code').trim() || !v('destination').trim()) return toast('Account code and destination are required.', true);
    $('#save').disabled = true;
    const row = {
      unit_id: B.pick, account_code: v('account_code').trim(), destination: v('destination').trim(),
      depart_date: v('depart_date'), arrive_date: v('arrive_date') || null, return_date: v('return_date'),
      deliver_by: v('deliver_by'), pickup_date: v('pickup_date'), notes: v('notes').trim() || null, created_by: S.session.user.id
    };
    const { error } = await sb.from('bookings').insert(row);
    if (error) { $('#save').disabled = false; return dbError(error); }
    S.booking = null; toast('Booking saved.'); location.hash = '#unit/' + B.pick;
  };
}

/* ---------- unit detail ---------- */
async function unit(tok, id) {
  const [u, b, s] = await Promise.all([
    sb.from('unit_board').select('*').eq('id', id).maybeSingle(),
    sb.from('bookings').select('*').eq('unit_id', id).order('deliver_by', { ascending: false }),
    sb.from('service_records').select('*').eq('unit_id', id).order('updated_at', { ascending: false }).limit(10)
  ]);
  if (stale(tok)) return; for (const r of [u, b, s]) if (r.error) return dbError(r.error);
  const x = u.data; if (!x) { app.innerHTML = '<p class="muted">Unit not found.</p>'; return; }
  const live = b.data.filter(k => ['reserved', 'delivered'].includes(k.status));
  const past = b.data.filter(k => !['reserved', 'delivered'].includes(k.status));
  const act = k => !can('csr', 'admin') ? '' : k.status === 'reserved'
    ? `<button class="btn" data-act="delivered" data-id="${k.id}" type="button">Mark delivered</button><button class="btn btn-danger" data-act="cancelled" data-id="${k.id}" type="button">Cancel booking</button>`
    : `<button class="btn" data-act="picked_up" data-id="${k.id}" type="button">Mark picked up</button>`;
  const bookingCard = k => `<section class="card"><h2>${k.status === 'reserved' ? 'Upcoming booking' : 'Out with patient'}</h2>
    <div class="formgrid">${[['Account', `<span class="mono">${esc(k.account_code)}</span>`], ['Destination', esc(k.destination)], ['Deliver by', fmt(k.deliver_by)], ['Departs', fmt(k.depart_date)], ['Arrives', fmt(k.arrive_date)], ['Returns', fmt(k.return_date)], ['Pick up', fmt(k.pickup_date)], ['Ready again', fmt(k.ready_date)]]
      .map(([l, val]) => `<div><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${l}</div><b>${val}</b></div>`).join('')}</div>
    ${k.notes ? `<p class="muted">${esc(k.notes)}</p>` : ''}<div class="btnrow">${act(k)}</div></section>`;
  app.innerHTML = `
  <a href="#fleet" style="font-weight:600;font-size:14px">Back to fleet</a>
  <div class="pagehead" style="margin-top:8px"><div><div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center"><h1 class="mono" style="font-weight:500">${esc(x.serial_number)}</h1>${pill(x.board_status)}</div>
    <p class="muted">${esc(x.model)} · ${x.airline_approved ? 'Airline approved' : 'Not airline approved'}</p></div></div>
  <div class="split"><div class="main" style="display:flex;flex-direction:column;gap:20px">
    ${live.map(bookingCard).join('') || '<section class="card"><h2>No current booking</h2><p class="muted">This unit has no upcoming or active trip.</p></section>'}
    <section class="card" style="padding:0"><h2 style="padding:18px 20px 6px">Trip history</h2><div class="tablebox"><table><thead><tr><th>Trip</th><th>Account</th><th>Destination</th><th>Status</th></tr></thead><tbody>
      ${past.map(k => `<tr><td>${fmtShort(k.depart_date)} – ${fmtShort(k.return_date)}</td><td class="mono">${esc(k.account_code)}</td><td>${esc(k.destination)}</td><td>${k.status === 'cancelled' ? 'Cancelled' : 'Completed'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No past trips yet.</td></tr>'}
    </tbody></table></div></section></div>
  <aside class="side">
    <section class="card"><h2>Service log</h2>${s.data.map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--gray-100)"><b>${r.released_at ? 'Released' : esc(STAGE[r.stage])}</b>
      <div class="muted" style="font-size:14px">${r.released_at ? fmtTs(r.released_at) : 'Updated ' + fmtTs(r.updated_at)}${r.notes ? ' — ' + esc(r.notes) : ''}</div></div>`).join('') || '<p class="muted">No service records yet.</p>'}</section>
    ${can('servicing', 'admin') ? `<section class="card"><h2>Unit settings</h2>
      <label class="f">Unit state<select id="ust">${['active', 'repair', 'retired'].map(o => `<option value="${o}" ${x.state === o ? 'selected' : ''}>${{ active: 'Active', repair: 'Out of service: repair', retired: 'Retired' }[o]}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="uair" ${x.airline_approved ? 'checked' : ''}> Airline approved</label>
      <label class="f">Notes<textarea id="unotes">${esc(x.notes || '')}</textarea></label>
      <div class="btnrow"><button class="btn" id="usave" type="button">Save</button></div></section>` : (x.notes ? `<section class="card"><h2>Notes</h2><p class="muted" style="margin:0">${esc(x.notes)}</p></section>` : '')}
  </aside></div>`;
  $$('[data-act]').forEach(btn => btn.onclick = async () => {
    const msg = { delivered: 'Mark this unit as delivered to the patient?', picked_up: 'Mark this unit as picked up? It goes to the servicing team for turnaround.', cancelled: 'Cancel this booking? The unit becomes free for these dates.' }[btn.dataset.act];
    if (!confirm(msg)) return;
    const { error } = await sb.from('bookings').update({ status: btn.dataset.act }).eq('id', btn.dataset.id);
    if (error) return dbError(error);
    toast('Updated.'); route();
  });
  const us = $('#usave'); if (us) us.onclick = async () => {
    const { error } = await sb.from('poc_units').update({ state: $('#ust').value, airline_approved: $('#uair').checked, notes: $('#unotes').value.trim() || null }).eq('id', id);
    if (error) return dbError(error); toast('Unit saved.'); route();
  };
}

/* ---------- service portal ---------- */
async function service(tok) {
  const [board, recs] = await Promise.all([
    sb.from('unit_board').select('*').order('pickup_date'),
    sb.from('service_records').select('*, poc_units(serial_number, model)').is('released_at', null).order('updated_at')
  ]);
  if (stale(tok)) return; for (const r of [board, recs]) if (r.error) return dbError(r.error);
  const edit = can('servicing', 'admin');
  const back = board.data.filter(u => ['out', 'pickup_due', 'pickup_overdue'].includes(u.board_status));
  const cols = [['cleaning', 'Cleaning', ['incoming', 'cleaning']], ['service', 'Service or repair', ['service']], ['testing', 'Testing', ['testing']], ['ready', 'Ready for release', ['ready']]];
  const card = r => `<button class="svc" type="button" data-r="${r.id}" aria-pressed="${S.svcSel === r.id}">
    <span class="mono"><b>${esc(r.poc_units?.serial_number)}</b></span><span class="muted">${esc(r.poc_units?.model)}</span>
    <span style="font-size:12px;font-weight:600">Ready ${r.expected_ready_date ? fmtShort(r.expected_ready_date) : 'not set'}</span></button>`;
  const sel = recs.data.find(r => r.id === S.svcSel);
  const startable = board.data.filter(u => ['available', 'repair'].includes(u.board_status));
  app.innerHTML = `
  <div class="pagehead"><div><h1>Servicing portal</h1><p class="muted">Units coming back, and units being cleaned, serviced and tested. ${edit ? 'Select a unit to update it.' : 'View only for your role.'}</p></div></div>
  <section class="board">
    <div class="col"><h3><span>Expected back</span><span>${back.length}</span></h3>${back.map(u => `<div class="svc static"><span class="mono"><b>${esc(u.serial_number)}</b></span><span class="muted">${esc(u.model)}</span><span style="font-size:12px;font-weight:600;color:${u.board_status === 'pickup_overdue' ? 'var(--red-fg)' : 'inherit'}">Pickup ${fmtShort(u.pickup_date)}</span></div>`).join('') || '<span class="muted" style="font-size:14px;padding:4px">None</span>'}</div>
    ${cols.map(([, label, stages]) => { const list = recs.data.filter(r => stages.includes(r.stage)); return `<div class="col"><h3><span>${label}</span><span>${list.length}</span></h3>${list.map(card).join('') || '<span class="muted" style="font-size:14px;padding:4px">None</span>'}</div>`; }).join('')}
  </section>
  ${sel ? `<section class="card" id="svcForm"><h2>Update <span class="mono">${esc(sel.poc_units?.serial_number)}</span> <span class="muted" style="font-weight:400;font-size:15px">${esc(sel.poc_units?.model)}</span></h2>
    <div class="split"><div class="main" style="display:flex;flex-direction:column;gap:14px;flex-basis:320px">
      <label class="f">Stage<select id="sStage" ${edit ? '' : 'disabled'}>${Object.entries(STAGE).map(([k, l]) => `<option value="${k}" ${sel.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Expected ready date<input type="date" id="sReady" value="${esc(sel.expected_ready_date || '')}" ${edit ? '' : 'disabled'}></label>
      <label class="f">Notes, parts or issues<textarea id="sNotes" ${edit ? '' : 'disabled'}>${esc(sel.notes || '')}</textarea></label></div>
    <fieldset class="side" style="border:0;margin:0;padding:0"><legend style="font-weight:600;font-size:14px;margin-bottom:6px">Release checklist</legend>
      ${[['cleaned', 'Cleaned and disinfected'], ['filter_checked', 'Filter checked or replaced'], ['battery_checked', 'Battery checked'], ['output_passed', 'Output check passed']].map(([k, l]) => `<label class="check" style="border:1px solid var(--gray-200);border-radius:6px;padding:0 12px"><input type="checkbox" data-ck="${k}" ${sel[k] ? 'checked' : ''} ${edit ? '' : 'disabled'}> ${l}</label>`).join('')}
      <p class="muted" id="relNote" style="font-size:14px"></p></fieldset></div>
    ${edit ? '<div class="btnrow"><button class="btn" id="sSave" type="button">Save update</button><button class="btn btn-green" id="sRel" type="button">Release to available</button></div>' : ''}</section>`
    : (edit ? `<section class="card"><h2>Start service on a unit</h2><p class="muted" style="margin-top:0">For a unit that needs work outside a trip return, such as a repair.</p>
      <div class="formgrid"><label class="f">Unit<select id="newU">${startable.map(u => `<option value="${u.id}">${esc(u.serial_number)} — ${esc(u.model)}</option>`).join('')}</select></label>
      <label class="f">Expected ready date<input type="date" id="newReady"></label></div>
      <label class="f" style="margin-top:12px">Notes<textarea id="newNotes"></textarea></label>
      <div class="btnrow"><button class="btn" id="newGo" type="button" ${startable.length ? '' : 'disabled'}>Start service</button></div></section>` : '')}`;
  $$('.svc[data-r]').forEach(b => b.onclick = () => { S.svcSel = S.svcSel === b.dataset.r ? null : b.dataset.r; route(); });
  if (sel && edit) {
    const checks = () => Object.fromEntries($$('[data-ck]').map(c => [c.dataset.ck, c.checked]));
    const allDone = () => Object.values(checks()).every(Boolean);
    const sync = () => { $('#sRel').disabled = !allDone(); $('#relNote').textContent = allDone() ? 'All four steps done. The unit can be released.' : 'Release unlocks when all four steps are checked.'; };
    $$('[data-ck]').forEach(c => c.onchange = sync); sync();
    const payload = () => ({ stage: $('#sStage').value, expected_ready_date: $('#sReady').value || null, notes: $('#sNotes').value.trim() || null, ...checks() });
    $('#sSave').onclick = async () => { const { error } = await sb.from('service_records').update(payload()).eq('id', sel.id); if (error) return dbError(error); toast('Saved.'); route(); };
    $('#sRel').onclick = async () => {
      if (!confirm('Release this unit? It will show as available for booking.')) return;
      const { error } = await sb.from('service_records').update({ ...payload(), stage: 'ready', released_at: new Date().toISOString() }).eq('id', sel.id);
      if (error) return dbError(error);
      await sb.from('poc_units').update({ state: 'active' }).eq('id', sel.unit_id).eq('state', 'repair');
      S.svcSel = null; toast('Released. The unit is available again.'); route();
    };
  }
  const ng = $('#newGo'); if (ng) ng.onclick = async () => {
    const { error } = await sb.from('service_records').insert({ unit_id: $('#newU').value, stage: 'service', expected_ready_date: $('#newReady').value || null, notes: $('#newNotes').value.trim() || null, updated_by: S.session.user.id });
    if (error) return dbError(error); toast('Service started.'); route();
  };
}

/* ---------- admin ---------- */
async function admin(tok) {
  if (!can('admin')) { app.innerHTML = '<p class="muted">Admins only.</p>'; return; }
  const { data: staff, error } = await sb.from('staff_allowlist').select('*').order('role').order('full_name');
  if (stale(tok)) return; if (error) return dbError(error);
  const roleSel = (cur, attr) => `<select ${attr}>${['csr', 'servicing', 'admin'].map(r => `<option value="${r}" ${cur === r ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select>`;
  app.innerHTML = `
  <div class="pagehead"><div><h1>Admin</h1><p class="muted">Staff access, scheduling rules and the fleet list.</p></div></div>
  <div class="split"><div class="main" style="display:flex;flex-direction:column;gap:20px">
    <section class="card" style="padding:0"><h2 style="padding:18px 20px 6px">Staff list</h2><p class="muted" style="padding:0 20px;margin:0 0 8px;font-size:14px">People on this list get their role when they sign in with Google. Role changes apply on their next page load.</p>
      <div class="tablebox"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
      ${staff.map(p => `<tr><td>${esc(p.full_name)}</td><td>${esc(p.email)}</td><td>${roleSel(p.role, `data-email="${esc(p.email)}"`)}</td></tr>`).join('')}</tbody></table></div>
      <form id="addStaff" style="padding:16px 20px" autocomplete="off"><div class="formgrid">
        <label class="f">Full name<input name="full_name" required></label><label class="f">Email<input name="email" type="email" required placeholder="name@caloxinc.com"></label>
        <label class="f">Role${roleSel('csr', 'name="role"')}</label></div><div class="btnrow"><button class="btn" type="submit">Add person</button></div></form></section>
    <section class="card"><h2>Add a unit to the fleet</h2><form id="addUnit" autocomplete="off"><div class="formgrid">
      <label class="f">Serial number<input name="serial_number" class="mono" required></label><label class="f">Make / model<input name="model" required list="models"></label></div>
      <datalist id="models"><option>OxyGo NEXT</option><option>O2 Concepts OxLife Independence</option><option>O2 Concepts OxLife Liberty 2</option><option>GCE Zen-O lite</option></datalist>
      <label class="check"><input type="checkbox" name="airline_approved" checked> Airline approved</label>
      <label class="f">Notes<input name="notes"></label><div class="btnrow"><button class="btn" type="submit">Add unit</button></div></form></section></div>
  <aside class="side"><section class="card"><h2>Turnaround</h2><label class="f">Business days after pickup<input type="number" id="ta" min="1" max="15" value="${S.turnaround}"></label>
    <p class="muted" style="font-size:14px">Applies to new bookings and to pickup-date changes.</p><div class="btnrow"><button class="btn" id="taSave" type="button">Save</button></div></section></aside></div>`;
  $$('select[data-email]').forEach(s => s.onchange = async () => {
    const { error } = await sb.from('staff_allowlist').update({ role: s.value }).eq('email', s.dataset.email);
    if (error) return dbError(error); toast('Role updated.');
  });
  $('#addStaff').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const email = f.email.value.trim().toLowerCase();
    if (!email.endsWith('@caloxinc.com') && !confirm(`${email} is not a caloxinc.com address. Add anyway?`)) return;
    const { error } = await sb.from('staff_allowlist').insert({ email, full_name: f.full_name.value.trim(), role: f.role.value });
    if (error) return dbError(error); toast('Added.'); route();
  };
  $('#addUnit').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.from('poc_units').insert({ serial_number: f.serial_number.value.trim(), model: f.model.value.trim(), airline_approved: f.airline_approved.checked, notes: f.notes.value.trim() || null });
    if (error) return dbError(error); toast('Unit added.'); f.reset();
  };
  $('#taSave').onclick = async () => {
    const n = parseInt($('#ta').value, 10); if (!(n >= 1 && n <= 15)) return toast('Enter 1 to 15 days.', true);
    const { error } = await sb.from('settings').update({ value: String(n) }).eq('key', 'turnaround_business_days');
    if (error) return dbError(error); S.turnaround = n; toast('Turnaround saved.');
  };
}

boot();
