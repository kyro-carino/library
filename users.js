(() => {
  const authEndpoint = 'api/user_auth.php';
  const readerEndpoint = 'api/reader.php';
  const authScreen = document.getElementById('reader-auth-screen');
  const app = document.getElementById('reader-app');
  const feedback = document.getElementById('reader-feedback');
  const signinTab = document.getElementById('signin-tab');
  const signupTab = document.getElementById('signup-tab');
  const signinPanel = document.getElementById('signin-panel');
  const signupPanel = document.getElementById('signup-panel');
  const menu = document.querySelector('.reader-menubar');
  let readerName = '';
  let readerUsername = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function dateLabel(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function showMessage(message, isError = true) {
    feedback.textContent = message || '';
    feedback.classList.toggle('is-success', !isError);
    feedback.hidden = !message;
  }

  async function request(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: payload ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errors = result.errors ? Object.values(result.errors).join(' ') : '';
      const failure = new Error(errors || result.error || 'Something went wrong. Please try again.');
      failure.fields = result.errors || {};
      throw failure;
    }
    return result;
  }

  const readerRequest = (query = '', payload = null) => request(`${readerEndpoint}${query}`, payload);

  function showAuthError(id, message) {
    const error = document.getElementById(id);
    error.textContent = message;
    error.hidden = !message;
  }

  // Name and @username shown in the header menu. Called at sign-in and again after the reader edits their profile.
  function paintIdentity(user) {
    readerName = user.displayName || user.username;
    readerUsername = user.username;
    document.getElementById('reader-menu-name').textContent = readerName;
    document.getElementById('reader-menu-user').textContent = `@${user.username}`;
    const initials = readerName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'R';
    document.getElementById('reader-avatar').textContent = initials;
    document.getElementById('reader-menu-avatar').textContent = initials;
  }

  function showDashboard(user) {
    paintIdentity(user);
    authScreen.hidden = true;
    app.hidden = false;
    showMessage('');
    notifData = null;
    paintNotifSwitches();
    renderNotifications();
    loadNotifications();
    loadSection('overview');
  }

  function showForms() {
    app.hidden = true;
    authScreen.hidden = false;
    document.getElementById('reader-profile-menu').hidden = true;
    document.getElementById('reader-avatar-btn').setAttribute('aria-expanded', 'false');
    showAuthError('reader-login-error', '');
    showAuthError('reader-signup-error', '');
  }

  function switchTab(tab) {
    const signup = tab === 'signup';
    signinTab.classList.toggle('is-active', !signup);
    signupTab.classList.toggle('is-active', signup);
    signinTab.setAttribute('aria-selected', String(!signup));
    signupTab.setAttribute('aria-selected', String(signup));
    signinPanel.hidden = signup;
    signupPanel.hidden = !signup;
    showAuthError('reader-login-error', '');
    showAuthError('reader-signup-error', '');
  }

  function bookCard(book, index, reserve = true, plain = false) {
    const available = book.status === 'Available';
    const tone = index % 5;
    const cover = /^https:\/\//i.test(book.cover || '') ? `<img class="book-card-cover" src="${escapeHtml(book.cover)}" alt="" loading="lazy">` : '';
    const availability = available ? 'Available' : 'On loan';
    const badge = available ? 'badge-available' : 'badge-borrowed';
    return `<article class="book-card reader-book-card">
      <div class="book-card-face reader-book-tone-${tone}">${cover}<span class="book-card-availability-pill ${badge}">${availability}</span><span class="book-card-initial" aria-hidden="true">${escapeHtml((book.title || 'Book').slice(0, 1))}</span></div>
      <div class="book-card-body"><div class="book-card-top-row"><span class="book-card-cat">${escapeHtml(book.category)}</span><span class="book-card-dot ${badge}" aria-label="${availability}"></span></div>
        <h3 class="book-card-title">${escapeHtml(book.title)}</h3><p class="book-card-author">${escapeHtml(book.author)}${!plain && book.year ? ` · ${escapeHtml(book.year)}` : ''}</p>
        ${plain ? '' : book.requested ? '<p class="reader-book-note">Your request is pending with library staff.</p>' : reserve ? `<button class="btn btn-secondary btn-sm reader-reserve-button" type="button" data-reserve="${escapeHtml(book.id)}">Request to borrow</button>` : available ? '<p class="reader-book-note">Request this title and library staff will help with checkout.</p>' : ''}
      </div></article>`;
  }

  function rowMarkup(title, detail, side = '', badge = '') {
    return `<article class="reader-row"><div class="row-main"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div><div class="row-side">${badge ? `<span class="status-badge ${badge === 'Overdue' ? 'is-overdue' : ''}">${escapeHtml(badge)}</span>` : ''}${side ? `<span>${escapeHtml(side)}</span>` : ''}</div></article>`;
  }

  const emptyMarkup = message => `<div class="reader-empty">${escapeHtml(message)}</div>`;

  // Same rule as the staff Discover page: one title from each of the first five categories.
  function renderOverview(books) {
    const seen = new Set();
    const featured = [];
    for (const book of books) {
      const category = book.category || 'Uncategorized';
      if (!seen.has(category)) { seen.add(category); featured.push(book); }
      if (featured.length >= 5) break;
    }
    document.getElementById('featured-grid').innerHTML = featured.map((book, index) => bookCard(book, index, false, true)).join('') || emptyMarkup('The catalog is empty right now.');
  }

  let libraryInfoLoaded = false;

  // Same library details the staff Discover page shows (rules, address, phone, email), read from the saved settings.
  async function loadLibraryInfo() {
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; };
    setText('footer-year', String(new Date().getFullYear()));
    if (libraryInfoLoaded) return;
    try {
      const { settings } = await request('api/settings.php');
      const max = Number(settings.maxBooksPerUser), days = Number(settings.loanDays);
      if (max && days) setText('svc-borrowing-text', `Take home up to ${max} ${max === 1 ? 'title' : 'titles'} at a time, with a ${days}-day loan period.`);
      const contact = [settings.libraryAddress, settings.libraryPhone, settings.libraryEmail].filter(Boolean);
      if (contact.length) setText('svc-contact-text', contact.join(' \u00b7 '));
      setText('footer-address', settings.libraryAddress);
      setText('footer-phone', settings.libraryPhone);
      setText('footer-email', settings.libraryEmail);
      libraryInfoLoaded = true;
    } catch (error) {
      // The default text in the page stays if the settings cannot be read.
    }
  }

  async function loadOverview() {
    loadLibraryInfo();
    const books = await readerRequest('?view=books&limit=100');
    renderOverview(books.books);
  }

  let bookStatus = 'all';

  function renderBooks(books, total) {
    const noun = total === 1 ? 'book' : 'books';
    document.getElementById('catalog-count').textContent = bookStatus === 'available' ? `${total} ${noun} available`
      : bookStatus === 'loan' ? `${total} ${noun} on loan`
      : `${total} ${noun} in the collection`;
    document.getElementById('catalog-grid').innerHTML = books.length
      ? books.map(bookCard).join('')
      : `<div class="collection-empty"><div class="t">No books found</div><div class="s">${bookStatus === 'all' ? 'Try another title, author, or category.' : 'Try another title, author, category, or availability filter.'}</div></div>`;
  }

  async function loadBooks() {
    const query = document.getElementById('book-search').value.trim();
    const sort = document.getElementById('book-sort')?.value || 'title';
    const data = await readerRequest(`?view=books&limit=100&search=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&status=${encodeURIComponent(bookStatus)}`);
    renderBooks(data.books, data.total);
  }

  function renderLoans(loans) {
    const open = loans.filter(loan => !loan.returnDate && ['Borrowed', 'Overdue'].includes(loan.status));
    const history = loans.filter(loan => !open.includes(loan));
    document.getElementById('active-loans').innerHTML = open.length ? open.map(loan => {
      const fine = Number(loan.fine || 0) > 0 ? `Fine assessed: ₱${Number(loan.fine).toFixed(2)}` : `Due ${dateLabel(loan.dueDate)}`;
      return rowMarkup(loan.bookTitle, `Issued ${dateLabel(loan.issueDate)} · ${fine}`, `Due ${dateLabel(loan.dueDate)}`, loan.status);
    }).join('') : emptyMarkup('You have no active loans.');
    document.getElementById('loan-history').innerHTML = history.length ? history.map(loan => {
      const fine = Number(loan.fine || 0) > 0 ? `Fine ₱${Number(loan.fine).toFixed(2)}${loan.finePaid ? ' · paid' : ' · unpaid'}` : `Returned ${dateLabel(loan.returnDate)}`;
      return rowMarkup(loan.bookTitle, `Issued ${dateLabel(loan.issueDate)} · ${fine}`, dateLabel(loan.returnDate), loan.status);
    }).join('') : emptyMarkup('Your loan history will appear here.');
  }

  async function loadLoans() {
    const data = await readerRequest('?view=loans');
    renderLoans(data.loans);
  }

  let requestRows = [];
  let requestQuery = '';

  function requestStatusBadge(item) {
    if (item.status === 'fulfilled') return '<span class="badge badge-available">Fulfilled</span>';
    if (item.status === 'cancelled') return '<span class="badge badge-inactive">Cancelled</span>';
    if (item.bookStatus === null) return '<span class="badge badge-inactive">Title removed</span>';
    return item.bookStatus === 'Available'
      ? '<span class="badge badge-available">Available</span>'
      : '<span class="badge badge-borrowed">On loan</span>';
  }
  function requestPlace(item) {
    if (item.status !== 'active') return '—';
    return item.queuePosition === 1 ? 'Next in line' : `#${item.queuePosition}`;
  }

  function renderRequests() {
    const query = requestQuery.trim().toLowerCase();
    const all = requestRows;
    const rows = query ? all.filter(item => [item.title, item.author].some(value => String(value || '').toLowerCase().includes(query))) : all;
    const active = all.filter(item => item.status === 'active');
    const ready = active.filter(item => item.bookStatus === 'Available').length;
    const past = all.length - active.length;
    document.getElementById('requests-count-sub').textContent = all.length
      ? `${active.length} active request${active.length === 1 ? '' : 's'} · ${ready} available now${past ? ` · ${past} past` : ''}${query ? ` · ${rows.length} matching` : ''}`
      : 'Track borrowing requests and cancel a request while it is pending.';
    const tbody = document.getElementById('requests-tbody');
    const cards = document.getElementById('requests-card-list');
    const empty = document.getElementById('requests-empty');
    if (!rows.length) {
      tbody.innerHTML = '';
      cards.innerHTML = '';
      empty.innerHTML = all.length
        ? '<div class="empty-state"><div class="t">No matching requests</div><div class="s">No request matches that search.</div></div>'
        : '<div class="empty-state"><div class="t">No borrow requests yet</div><div class="s">Choose a title in Collection to request it.</div></div>';
      return;
    }
    empty.innerHTML = '';
    const created = item => dateLabel(item.createdAt?.slice(0, 10));
    const cancelButton = item => item.status === 'active'
      ? `<button class="btn btn-secondary btn-sm" type="button" data-cancel="${escapeHtml(item.id)}">Cancel request</button>` : '';
    tbody.innerHTML = rows.map(item => `
      <tr data-id="${escapeHtml(item.id)}">
        <td><div class="cell-primary">${escapeHtml(item.title)}</div><div class="cell-sub">${escapeHtml(item.author || '')}</div></td>
        <td>${escapeHtml(created(item))}</td>
        <td>${requestStatusBadge(item)}</td>
        <td>${escapeHtml(requestPlace(item))}</td>
        <td><div class="row-actions">${cancelButton(item)}</div></td>
      </tr>`).join('');
    cards.innerHTML = rows.map(item => `
      <div class="record-card" data-id="${escapeHtml(item.id)}">
        <div class="rc-top">
          <div><div class="rc-title">${escapeHtml(item.title)}</div><div class="rc-sub">${escapeHtml(item.author || '')}</div></div>
          ${requestStatusBadge(item)}
        </div>
        <div class="rc-meta"><span>Requested ${escapeHtml(created(item))}</span><span>${escapeHtml(requestPlace(item))}</span></div>
        ${item.status === 'active' ? `<div class="rc-actions">${cancelButton(item)}</div>` : ''}
      </div>`).join('');
  }

  async function loadReservations() {
    const data = await readerRequest('?view=reservations');
    requestRows = data.reservations || [];
    renderRequests();
  }

  const initialsOf = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'R';

  const PROFILE_FIELDS = {
    firstName: 'reader-account-first', lastName: 'reader-account-last', username: 'reader-account-username',
    email: 'reader-account-email', program: 'reader-account-program', yearLevel: 'reader-account-year',
  };
  let accountSnapshot = null;

  // View mode (fields locked, "Edit Profile" shown) or edit mode (fields open, "Cancel" / "Save profile" shown).
  function setProfileEditing(editing) {
    Object.values(PROFILE_FIELDS).forEach(id => { document.getElementById(id).disabled = !editing; });
    document.getElementById('reader-profile-form').classList.toggle('is-viewing', !editing);
    document.getElementById('reader-profile-actions').hidden = !editing;
    document.getElementById('reader-profile-edit').hidden = editing;
    if (editing) document.getElementById(PROFILE_FIELDS.firstName).focus();
  }

  function paintAccount(account) {
    accountSnapshot = account;
    setProfileEditing(false);
    const values = {
      firstName: account.firstName, lastName: account.lastName, username: account.username, email: account.email,
      program: account.program || '', yearLevel: account.yearLevel ? String(account.yearLevel) : '',
    };
    Object.entries(PROFILE_FIELDS).forEach(([key, id]) => {
      const input = document.getElementById(id);
      // A program chosen by library staff may not be one of the sign-up options: keep it selectable.
      if (key === 'program' && values.program && ![...input.options].some(option => option.value === values.program)) {
        input.add(new Option(values.program, values.program));
      }
      input.value = values[key] || '';
      clearFieldError(input);
    });
    document.getElementById('reader-account-id').value = account.patronId || '';
    const name = account.displayName || account.username;
    document.getElementById('reader-profile-name').textContent = name;
    document.getElementById('reader-profile-handle').textContent = `@${account.username}`;
    document.getElementById('reader-profile-avatar').textContent = initialsOf(name);
    document.getElementById('reader-security-user').textContent = `@${account.username}`;
  }

  async function loadAccount() {
    const data = await readerRequest('?view=account');
    paintAccount(data.account);
  }

  // ---- Account settings: same layout as the staff Settings page (Profile, Appearance, Notifications, Security) ----
  const on = (id, type, handler) => document.getElementById(id)?.addEventListener(type, handler);

  function showSettingsPane(id) {
    const pane = id || 'profile';
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      const active = item.dataset.settings === pane;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'true'); else item.removeAttribute('aria-current');
    });
    document.querySelectorAll('.settings-pane').forEach(item => item.classList.toggle('active', item.id === `settings-pane-${pane}`));
    if (pane === 'notifications') loadNotifications();
  }
  document.querySelectorAll('.settings-nav-item').forEach(item => item.addEventListener('click', () => showSettingsPane(item.dataset.settings)));

  // ---- Profile: the reader edits their own name, username, email, program and year level ----
  on('reader-profile-edit', 'click', () => { showMessage(''); setProfileEditing(true); });
  on('reader-profile-reset', 'click', () => { if (accountSnapshot) paintAccount(accountSnapshot); showMessage(''); });
  on('reader-profile-save', 'click', async event => {
    const button = event.currentTarget;
    const el = Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key, id]) => [key, document.getElementById(id)]));
    Object.values(el).forEach(clearFieldError);
    const value = key => el[key].value.trim();
    let valid = true;
    if (!value('firstName')) valid = setFieldError(el.firstName, 'Enter your first name.');
    if (!value('lastName')) valid = setFieldError(el.lastName, 'Enter your last name.');
    if (!/^[a-zA-Z0-9._-]{3,24}$/.test(value('username').replace(/^@/, ''))) valid = setFieldError(el.username, 'Use 3–24 letters, numbers, dots or dashes.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) valid = setFieldError(el.email, 'Enter a valid email address.');
    if (!value('program')) valid = setFieldError(el.program, 'Choose your program.');
    if (!value('yearLevel')) valid = setFieldError(el.yearLevel, 'Choose your year level.');
    if (!valid) { showMessage('Please check the highlighted fields.'); return; }
    button.disabled = true;
    try {
      const payload = { action: 'update_profile' };
      Object.keys(PROFILE_FIELDS).forEach(key => { payload[key] = value(key); });
      const result = await readerRequest('', payload);
      const oldNotifKey = notifKey();
      paintAccount(result.account);
      paintIdentity(result.account);
      // Notification preferences are stored per username in this browser: carry them over to the new name.
      if (oldNotifKey !== notifKey()) {
        try {
          const saved = localStorage.getItem(oldNotifKey);
          if (saved !== null) { localStorage.setItem(notifKey(), saved); localStorage.removeItem(oldNotifKey); }
        } catch (error) { /* private mode: nothing to carry over */ }
      }
      showMessage(result.message || 'Profile updated.', false);
    } catch (error) {
      const fields = error.fields || {};
      Object.entries(fields).forEach(([key, message]) => { if (el[key]) setFieldError(el[key], message); });
      showMessage(Object.keys(fields).length ? 'Please check the highlighted fields.' : error.message);
    } finally {
      button.disabled = false;
    }
  });

  // ---- Notifications: built from the reader's own loans, fines and requests. Preferences are kept in this browser. ----
  const NOTIF_DEFAULTS = { due: true, overdue: true, fines: true, requests: true };
  const NOTIF_SWITCHES = { due: 'rnotif-due', overdue: 'rnotif-overdue', fines: 'rnotif-fines', requests: 'rnotif-requests' };
  const notifKey = () => `feu-reader-notifs:${readerUsername}`;
  let notifData = null;

  function readNotifPrefs() {
    try { return { ...NOTIF_DEFAULTS, ...JSON.parse(localStorage.getItem(notifKey()) || '{}') }; } catch (error) { return { ...NOTIF_DEFAULTS }; }
  }
  function syncSwitchLabels() {
    document.querySelectorAll('#settings-pane-notifications .switch-row').forEach(row => {
      const input = row.querySelector('input');
      const tag = row.querySelector('.onoff');
      if (input && tag) tag.textContent = input.checked ? 'ON' : 'OFF';
    });
  }
  function paintNotifSwitches() {
    const prefs = readNotifPrefs();
    Object.entries(NOTIF_SWITCHES).forEach(([key, id]) => { const input = document.getElementById(id); if (input) input.checked = prefs[key]; });
    syncSwitchLabels();
  }
  document.querySelectorAll('#settings-pane-notifications .switch-row input').forEach(input => input.addEventListener('change', syncSwitchLabels));

  const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  function buildNotifications() {
    if (!notifData) return [];
    const prefs = readNotifPrefs();
    const today = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    const todayIso = isoDay(today);
    const soonIso = isoDay(soon);
    const items = [];
    (notifData.loans || []).forEach(loan => {
      if (prefs.overdue && loan.status === 'Overdue') {
        items.push({ target: 'loans', title: `${loan.bookTitle} is overdue`, when: `Due ${dateLabel(loan.dueDate)}`, badge: 'Overdue' });
      } else if (prefs.due && loan.status === 'Borrowed' && loan.dueDate >= todayIso && loan.dueDate <= soonIso) {
        items.push({ target: 'loans', title: `${loan.bookTitle} is due ${loan.dueDate === todayIso ? 'today' : `on ${dateLabel(loan.dueDate)}`}`, when: `Due ${dateLabel(loan.dueDate)}`, badge: 'Due soon' });
      }
    });
    const fines = Number(notifData.summary?.unpaidFines || 0);
    if (prefs.fines && fines > 0) items.push({ target: 'loans', title: `You have unpaid fines of ₱${fines.toFixed(2)}`, when: 'Pay at the library desk', badge: 'Fines' });
    if (prefs.requests) {
      (notifData.reservations || []).filter(item => item.status === 'active').forEach(item => {
        items.push({ target: 'reservations', title: `Request pending: ${item.title}`, when: `Requested ${dateLabel(item.createdAt?.slice(0, 10))}`, badge: 'Request' });
      });
    }
    return items;
  }

  function renderNotifications() {
    const items = buildNotifications();
    const dot = document.getElementById('reader-notif-dot');
    const bell = document.getElementById('reader-notif-list');
    const page = document.getElementById('reader-notif-page-list');
    if (dot) dot.hidden = items.length === 0;
    if (bell) bell.innerHTML = items.length
      ? items.map(item => `<button class="drop-item" type="button" data-notif-target="${item.target}"><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.when)}</small></button>`).join('')
      : '<div class="drop-empty">You are all caught up.</div>';
    if (page) page.innerHTML = items.length
      ? items.map(item => rowMarkup(item.title, item.when, '', item.badge)).join('')
      : emptyMarkup('You are all caught up.');
  }

  async function loadNotifications() {
    try {
      notifData = await readerRequest('?view=overview');
    } catch (error) {
      notifData = null;
      const bell = document.getElementById('reader-notif-list');
      if (bell) bell.innerHTML = '<div class="drop-empty">Notifications are unavailable.</div>';
      const dot = document.getElementById('reader-notif-dot');
      if (dot) dot.hidden = true;
      return;
    }
    renderNotifications();
  }

  on('rnotif-save', 'click', () => {
    const prefs = {};
    Object.entries(NOTIF_SWITCHES).forEach(([key, id]) => { prefs[key] = Boolean(document.getElementById(id)?.checked); });
    try { localStorage.setItem(notifKey(), JSON.stringify(prefs)); } catch (error) { /* private mode: applies for this visit only */ }
    showMessage('Notification preferences saved.', false);
    renderNotifications();
  });

  function closeNotifPanel() {
    const panel = document.getElementById('reader-notif-panel');
    if (panel) panel.hidden = true;
    document.getElementById('reader-notif-btn')?.setAttribute('aria-expanded', 'false');
  }
  on('reader-notif-btn', 'click', event => {
    event.stopPropagation();
    const panel = document.getElementById('reader-notif-panel');
    document.getElementById('reader-profile-menu').hidden = true;
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) loadNotifications();
  });
  on('reader-notif-panel', 'click', event => {
    const item = event.target.closest('[data-notif-target]');
    if (item) { closeNotifPanel(); loadSection(item.dataset.notifTarget); }
  });
  on('reader-notif-settings', 'click', async () => { closeNotifPanel(); await loadSection('account'); showSettingsPane('notifications'); });
  document.addEventListener('click', event => {
    const host = document.querySelector('.reader-notif-menu');
    if (host && !host.contains(event.target)) closeNotifPanel();
  });

  // ---- Security: change password (same checks as the staff page, 12 characters like sign-up) ----
  const MIN_PASSWORD = 12;
  function passwordScore(value) {
    let score = 0;
    if (value.length >= MIN_PASSWORD) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return score;
  }
  function setFieldError(input, message) {
    const field = input.closest('.field');
    field.classList.add('invalid');
    const error = field.querySelector('.err');
    if (error) error.textContent = message || 'Please check this field.';
    input.setAttribute('aria-invalid', 'true');
    return false;
  }
  function clearFieldError(input) {
    const field = input.closest('.field');
    field.classList.remove('invalid');
    const error = field.querySelector('.err');
    if (error) error.textContent = '';
    input.removeAttribute('aria-invalid');
  }
  on('rsec-new-pass', 'input', event => {
    const value = event.currentTarget.value;
    const score = passwordScore(value);
    const bar = document.getElementById('rsec-meter-bar');
    const label = document.getElementById('rsec-meter-label');
    if (bar) bar.dataset.score = String(score);
    if (label) label.textContent = !value ? `Use ${MIN_PASSWORD} or more characters.` : ['Weak', 'Fair', 'Good', 'Strong'][Math.max(0, score - 1)];
  });
  document.querySelectorAll('#settings-pane-security .pw-toggle').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.pw);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
  }));
  on('rsec-change-pass', 'click', async event => {
    const button = event.currentTarget;
    const current = document.getElementById('rsec-current-pass');
    const next = document.getElementById('rsec-new-pass');
    const confirm = document.getElementById('rsec-confirm-pass');
    [current, next, confirm].forEach(clearFieldError);
    let valid = true;
    if (!current.value) valid = setFieldError(current, 'Enter the current password.');
    if (next.value.length < MIN_PASSWORD) valid = setFieldError(next, `Use at least ${MIN_PASSWORD} characters.`);
    if (next.value !== confirm.value) valid = setFieldError(confirm, 'Passwords do not match.');
    if (!valid) { showMessage('Please check the highlighted fields.'); return; }
    button.disabled = true;
    try {
      await request('api/auth.php', { action: 'password', currentPassword: current.value, newPassword: next.value, confirmPassword: confirm.value });
      current.value = next.value = confirm.value = '';
      const bar = document.getElementById('rsec-meter-bar');
      if (bar) bar.dataset.score = '0';
      document.getElementById('rsec-meter-label').textContent = `Use ${MIN_PASSWORD} or more characters.`;
      showMessage('Password updated successfully.', false);
    } catch (error) {
      const fields = error.fields || {};
      if (fields.currentPassword) setFieldError(current, fields.currentPassword);
      if (fields.newPassword) setFieldError(next, fields.newPassword);
      if (fields.confirmPassword) setFieldError(confirm, fields.confirmPassword);
      if (!Object.keys(fields).length && /current password/i.test(error.message)) setFieldError(current, error.message);
      showMessage(Object.keys(fields).length ? 'Please check the highlighted fields.' : error.message);
    } finally {
      button.disabled = false;
    }
  });
  on('rsec-logout-one', 'click', () => signOut());

  // Dropdown groups in the menu bar (Transactions), same behaviour as the staff menu.
  function closeNavDrops() {
    document.querySelectorAll('.reader-menubar .menu-drop').forEach(drop => {
      drop.classList.remove('open');
      drop.querySelector(':scope > .menu-link').setAttribute('aria-expanded', 'false');
    });
  }

  async function loadSection(view) {
    document.querySelectorAll('.reader-menubar [data-view]').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-section]').forEach(section => {
      const active = section.dataset.section === view;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });
    document.querySelectorAll('.reader-menubar .menu-drop').forEach(drop => {
      drop.querySelector(':scope > .menu-link').classList.toggle('active', Boolean(drop.querySelector(`[data-view="${view}"]`)));
    });
    closeNavDrops();
    menu.classList.remove('open');
    document.getElementById('reader-hamburger').setAttribute('aria-expanded', 'false');
    document.getElementById('reader-profile-menu').hidden = true;
    document.getElementById('reader-avatar-btn').setAttribute('aria-expanded', 'false');
    closeNotifPanel();
    showMessage('');
    try {
      if (view === 'overview') await loadOverview();
      if (view === 'books') await loadBooks();
      if (view === 'loans') await loadLoans();
      if (view === 'reservations') await loadReservations();
      if (view === 'account') await loadAccount();
    } catch (error) {
      showMessage(error.message);
    }
  }

  async function submitAuth(form, action, errorId) {
    showAuthError(errorId, '');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const result = await request(authEndpoint, { action, ...values });
      form.reset();
      showDashboard(result.user);
    } catch (error) {
      showAuthError(errorId, error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function signOut() {
    try {
      await request(authEndpoint, { action: 'logout' });
      showForms();
      switchTab('signin');
    } catch (error) {
      showMessage(error.message);
    }
  }

  function searchCatalog(value) {
    document.getElementById('book-search').value = value.trim();
    loadSection('books');
  }

  signinTab.addEventListener('click', () => switchTab('signin'));
  signupTab.addEventListener('click', () => switchTab('signup'));
  document.getElementById('signin-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'login', 'reader-login-error'); });
  document.getElementById('signup-form').addEventListener('submit', event => { event.preventDefault(); submitAuth(event.currentTarget, 'signup', 'reader-signup-error'); });
  document.querySelectorAll('.reader-menubar .menu-drop > .menu-link').forEach(link => {
    const drop = link.parentElement;
    link.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = !drop.classList.contains('open');
      closeNavDrops();
      if (willOpen) { drop.classList.add('open'); link.setAttribute('aria-expanded', 'true'); }
    });
    drop.addEventListener('focusout', event => {
      if (event.relatedTarget && drop.contains(event.relatedTarget)) return;
      drop.classList.remove('open');
      link.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', closeNavDrops);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNavDrops(); });

  document.querySelectorAll('button[data-view]').forEach(button => button.addEventListener('click', () => loadSection(button.dataset.view)));
  // In-page anchors (Services / About / Learn more) live on Discover; go there first when needed.
  document.querySelectorAll('[data-anchor]').forEach(button => button.addEventListener('click', async () => {
    const jump = () => document.getElementById(button.dataset.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (document.querySelector('[data-section="overview"]').classList.contains('active')) { jump(); return; }
    await loadSection('overview');
    requestAnimationFrame(jump);
  }));
  document.getElementById('hero-search-form').addEventListener('submit', event => { event.preventDefault(); searchCatalog(document.getElementById('hero-search-input').value); });
  document.querySelectorAll('#book-status-filters .chip').forEach(chip => chip.addEventListener('click', () => {
    bookStatus = chip.dataset.status;
    document.querySelectorAll('#book-status-filters .chip').forEach(item => {
      const active = item === chip;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    loadBooks().catch(error => showMessage(error.message));
  }));
  document.getElementById('book-sort')?.addEventListener('change', () => loadBooks().catch(error => showMessage(error.message)));
  document.getElementById('book-search-form').addEventListener('submit', event => { event.preventDefault(); loadBooks().catch(error => showMessage(error.message)); });
  document.getElementById('global-search-form').addEventListener('submit', event => { event.preventDefault(); searchCatalog(document.getElementById('global-search-input').value); });
  document.getElementById('clear-book-search').addEventListener('click', () => { document.getElementById('book-search').value = ''; loadBooks().catch(error => showMessage(error.message)); });
  document.getElementById('book-search').addEventListener('input', event => { document.getElementById('clear-book-search').hidden = !event.target.value; });
  document.querySelectorAll('#featured-grid, #catalog-grid').forEach(grid => grid.addEventListener('click', async event => {
    const button = event.target.closest('[data-reserve]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await readerRequest('', { action: 'reserve', bookId: button.dataset.reserve });
      showMessage(result.message, false);
      if (grid.id === 'featured-grid') await loadOverview(); else await loadBooks();
    } catch (error) {
      showMessage(error.message);
    } finally {
      button.disabled = false;
    }
  }));
  document.getElementById('requests-search')?.addEventListener('input', event => { requestQuery = event.target.value; renderRequests(); });
  document.getElementById('requests-refresh')?.addEventListener('click', () => loadReservations().catch(error => showMessage(error.message)));
  document.querySelector('[data-section="reservations"]').addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel]');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await readerRequest('', { action: 'cancel_reservation', reservationId: button.dataset.cancel });
      showMessage(result.message, false);
      await loadReservations();
    } catch (error) {
      showMessage(error.message);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('reader-avatar-btn').addEventListener('click', event => {
    const popup = document.getElementById('reader-profile-menu');
    closeNotifPanel();
    popup.hidden = !popup.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!popup.hidden));
  });
  document.getElementById('reader-hamburger').addEventListener('click', event => {
    const open = menu.classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('reader-logout').addEventListener('click', signOut);
  document.getElementById('account-logout').addEventListener('click', signOut);
  document.addEventListener('click', event => {
    const pop = document.getElementById('reader-profile-menu');
    const host = document.querySelector('.reader-account-menu');
    if (!host.contains(event.target) && !pop.hidden) {
      pop.hidden = true;
      document.getElementById('reader-avatar-btn').setAttribute('aria-expanded', 'false');
    }
  });

  // ---- Colour theme (light / dark / system): same storage key and behaviour as the staff portal ----
  const THEME_KEY = 'feu-theme';
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (error) { return 'light'; }
  }
  function applyTheme(pref, persist = true) {
    if (!['light', 'dark', 'system'].includes(pref)) pref = 'light';
    const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-pref', pref);
    if (persist) { try { localStorage.setItem(THEME_KEY, pref); } catch (error) { /* private mode: theme applies for this visit only */ } }
    document.querySelectorAll('.theme-card').forEach(card => {
      const active = card.dataset.themePref === pref;
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', String(active));
    });
    const toggle = document.getElementById('reader-theme-toggle');
    if (toggle) toggle.textContent = dark ? 'Light Mode' : 'Dark Mode';
  }
  applyTheme(storedTheme(), false);
  document.querySelectorAll('.theme-card').forEach(card => card.addEventListener('click', () => applyTheme(card.dataset.themePref)));
  document.getElementById('reader-theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    document.getElementById('reader-profile-menu').hidden = true;
    document.getElementById('reader-avatar-btn').setAttribute('aria-expanded', 'false');
  });
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', () => { if (storedTheme() === 'system') applyTheme('system', false); });
  window.addEventListener('storage', event => { if (event.key === THEME_KEY) applyTheme(event.newValue || 'light', false); });

  request(authEndpoint).then(result => {
    if (result.authenticated && result.user) showDashboard(result.user);
  }).catch(() => {});
})();