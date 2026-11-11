/* ==================================================================
   DATA LAYER — in-memory cache filled from the PHP/MySQL API
   Theme + recently-viewed remain in localStorage (client UI state only).
   ================================================================== */
const API_BASE = "api";

async function api(path, options = {}) {
  const opts = Object.assign({
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
  }, options);
  const res = await fetch(`${API_BASE}/${path}`, opts);
  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }
  if (res.status === 401 && !path.startsWith("auth.php")) {
    handleSessionExpired();
    const e = new Error(body.error || "Your session has ended. Sign in again.");
    e.sessionExpired = true;
    throw e;
  }
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = body.errors || null;
    throw err;
  }
  return body;
}

/* One handler for expired sessions: return to the sign-in screen once. */
let sessionExpiredHandled = false;
/* Keydown handlers of currently open dialogs, so an expired session can detach them too. */
const dialogKeyHandlers = new Set();
function handleSessionExpired(){
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  const modalRoot = document.getElementById("modal-root");
  const confirmRoot = document.getElementById("confirm-root");
  if (modalRoot) modalRoot.innerHTML = "";
  if (confirmRoot) confirmRoot.innerHTML = "";
  dialogKeyHandlers.forEach(h=> document.removeEventListener("keydown", h));
  dialogKeyHandlers.clear();
  activeModalCloseFn = null;
  /* Release the scroll lock and the inert flag on #app, or the UI stays unclickable after re-login. */
  while (scrollLockCount > 0) unlockScroll();
  document.getElementById("app")?.removeAttribute("inert");
  document.body.style.overflow = "";
  showLoginScreen("Your session has ended. Sign in again.");
}

/* Load every page of a paginated list endpoint (server caps each page at 200). */
async function fetchAllPages(path, key) {
  const PAGE = 200;
  let offset = 0, all = [];
  for (;;) {
    const data = await api(`${path}?limit=${PAGE}&offset=${offset}`);
    const rows = data[key] || [];
    all = all.concat(rows);
    offset += rows.length;
    if (!rows.length || offset >= (data.total ?? offset)) break;
  }
  return all;
}

function mapBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    category: row.category,
    year: row.year == null || row.year === "" ? null : Number(row.year),
    location: row.location,
    status: row.status,
    borrowedBy: row.borrowedBy ?? row.borrowed_by ?? null,
    issueDate: row.issueDate ?? row.issue_date ?? null,
    dueDate: row.dueDate ?? row.due_date ?? null,
    description: row.description,
    format: row.format,
    cover: row.cover ?? row.cover_url ?? null,
    borrowCount: Number(row.borrowCount ?? row.borrow_count ?? 0),
    renewalCount: Number(row.renewalCount ?? row.renewal_count ?? 0),
  };
}
function mapUser(row) {
  const lastName = row.lastName ?? row.last_name ?? "";
  const firstName = row.firstName ?? row.first_name ?? "";
  const middleInitial = row.middleInitial ?? row.middle_initial ?? "";
  return {
    id: row.id,
    lastName, firstName, middleInitial,
    name: row.name || formatUserName(lastName, firstName, middleInitial),
    program: row.program,
    yearLevel: row.yearLevel ?? row.year_level,
    studentNumber: row.studentNumber ?? row.student_number ?? null,
    contact: row.contact,
    status: row.status,
    borrowedBookIds: Array.isArray(row.borrowedBookIds) ? row.borrowedBookIds : (row.borrowed_book_ids || []),
    requestedBooks: Array.isArray(row.requestedBooks) ? row.requestedBooks : [],
    unpaidFines: Number(row.unpaidFines ?? 0),
    overdueLoans: Number(row.overdueLoans ?? 0),
  };
}

async function refreshBooks() {
  BOOKS = (await fetchAllPages("books.php", "books")).map(mapBook);
}
async function refreshUsers() {
  USERS = (await fetchAllPages("users.php", "users")).map(mapUser);
}
/* After a change, re-read only the records it touched instead of every page of the catalog.
   If a reply is not what we expect, fall back to a full reload so the lists never go stale silently. */
function upsertById(list, item){
  const i = list.findIndex(x=>x.id===item.id);
  if(i>=0) list[i] = item; else list.push(item);
}
async function refreshBook(id) {
  try {
    const r = await api("books.php?id=" + encodeURIComponent(id));
    if (r.book) { upsertById(BOOKS, mapBook(r.book)); return; }
  } catch (e) {
    if (e.status === 404) { BOOKS = BOOKS.filter(b=>b.id!==id); return; }
  }
  await refreshBooks();
}
async function refreshUser(id) {
  try {
    const r = await api("users.php?id=" + encodeURIComponent(id));
    if (r.user) { upsertById(USERS, mapUser(r.user)); return; }
  } catch (e) {
    if (e.status === 404) { USERS = USERS.filter(u=>u.id!==id); return; }
  }
  await refreshUsers();
}
/* Circulation changes one book and one patron's borrowed list; nothing else needs refetching. */
async function refreshAffected(bookId, userId) {
  await Promise.all([refreshBook(bookId), userId ? refreshUser(userId) : Promise.resolve()]);
}
async function bootstrapFromApi() {
  const [books, users, settings, account, notifs] = await Promise.all([
    fetchAllPages("books.php", "books"),
    fetchAllPages("users.php", "users"),
    api("settings.php"),
    api("account.php"),
    api("notifs.php"),
  ]);
  BOOKS = books.map(mapBook);
  USERS = users.map(mapUser);
  if (settings.settings) Object.assign(CONFIG, settings.settings);
  if (account.account) Object.assign(ACCOUNT, account.account);
  const prefs = notifs.notifPrefs || notifs.prefs;
  if (prefs) Object.assign(NOTIF_PREFS, prefs);
}
const DEFAULT_CONFIG = {
  finePerDay: 10,
  loanDays: 7,
  maxBooksPerUser: 5,
  maxRenewals: 2,
  gracePeriodDays: 1,
  overdueFinesEnabled: true,
  dateFormat: "short",
  timeFormat: "12h",
  pageSize: 25,
  language: "en",
  confirmDeletes: true,
  landingPage: "dashboard",
  density: "comfortable",
  libraryName: "FEU Roosevelt Library",
  libraryEmail: "library@feuroosevelt.edu.ph",
  libraryPhone: "(02) 8373-0701",
  libraryAddress: "Circumferential Road, Cainta, Rizal",
};

const CONFIG = Object.assign({}, DEFAULT_CONFIG);

const DEFAULT_ACCOUNT = {
  displayName: "Library Administrator",
  username: "admin",
  email: "admin@library.local",
  role: "admin",
  status: "Active",
  avatarDataUrl: null,
  avatarPreset: null,
  lastLogin: null,
};

const ACCOUNT = Object.assign({}, DEFAULT_ACCOUNT);

const DEFAULT_NOTIFS = {
  due: true,
  overdue: true,
  newUser: false,
  returns: true,
  system: true,
};

const NOTIF_PREFS = Object.assign({}, DEFAULT_NOTIFS);

const STORAGE = {
  theme: "feu-theme",
};

async function persistConfig(){
  const saved = await api("settings.php", { method: "PUT", body: JSON.stringify(CONFIG) });
  if (saved.settings) Object.assign(CONFIG, saved.settings);
}
async function persistAccount(){
  const payload = {
    displayName: ACCOUNT.displayName,
    username: ACCOUNT.username,
    email: ACCOUNT.email,
    role: ACCOUNT.role,
    status: ACCOUNT.status,
    avatarDataUrl: ACCOUNT.avatarDataUrl,
    avatarPreset: ACCOUNT.avatarPreset,
    lastLogin: ACCOUNT.lastLogin,
  };
  try {
    const saved = await api("account.php", { method: "PUT", body: JSON.stringify(payload) });
    if (saved.account) Object.assign(ACCOUNT, saved.account);
  } catch (e) {
    showToast(e.message || "Could not save the account. Try a smaller photo.", {kind:"error"});
    throw e;
  }
}
async function persistNotifs(){
  const saved = await api("notifs.php", { method: "PUT", body: JSON.stringify(NOTIF_PREFS) });
  const prefs = saved.notifPrefs || saved.prefs;
  if (prefs) Object.assign(NOTIF_PREFS, prefs);
}

const CATEGORIES = ["Literature","Science","History","Philosophy","Technology","Psychology","Arts","Business","Mathematics","Computer Science","Education","Social Sciences"]; // must match BOOK_CATEGORIES in includes/validation.php


const APP_TZ = "Asia/Manila";
/* Today's calendar date in Philippine time (YYYY-MM-DD), independent of the browser's timezone. */
function manilaToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:APP_TZ, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
}
function addDaysISO(iso, n){
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d+n)).toISOString().slice(0,10);
}
function isoDaysAgo(n){ return addDaysISO(manilaToday(), -n); }
function isoDaysFromNow(n){ return addDaysISO(manilaToday(), n); }
/* Calendar dates (YYYY-MM-DD) are parsed and formatted as UTC calendar days so the browser's timezone never shifts them. */
function parseISODate(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2]-1, +m[3])) : null;
}
function fmtDate(iso){
  const d = parseISODate(iso);
  if(!d) return "—";
  if(CONFIG.dateFormat==="iso") return d.toISOString().slice(0,10);
  if(CONFIG.dateFormat==="long") return d.toLocaleDateString("en-US",{timeZone:"UTC", weekday:"long", month:"long", day:"numeric", year:"numeric"});
  return d.toLocaleDateString("en-US",{timeZone:"UTC", month:"short", day:"numeric", year:"numeric"});
}
function fmtDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return "—";
  const date = d.toLocaleDateString("en-US",{timeZone:APP_TZ, month:"short", day:"numeric", year:"numeric"});
  const time = d.toLocaleTimeString("en-US",{timeZone:APP_TZ, hour:"numeric", minute:"2-digit", hour12: CONFIG.timeFormat!=="24h"});
  return date + " · " + time;
}
function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function daysBetween(a,b){
  const A = parseISODate(a), B = parseISODate(b);
  if(!A || !B) return 0;
  return Math.round((B-A) / 86400000);
}

const FORMATS = ["Hardcover","Paperback","E-book","Audiobook"];

/* ---- Patron names are stored as three fields (last, first, middle initial)
   and shown as "Last, First M." — e.g. "Dela Cruz, Juan D." ---- */
function formatUserName(lastName, firstName, middleInitial){
  const mi = middleInitial ? " " + middleInitial + "." : "";
  return `${lastName}, ${firstName}${mi}`;
}

let BOOKS = [];
let USERS = [];

/* ==================================================================
   ANIMATIONS.JS — reusable GSAP helpers
   ================================================================== */
/* If GSAP fails to load (offline, blocked), this stand-in jumps straight to each animation's end
   state so the sign-in screen and the app still appear instead of a blank page. */
function createGsapFallback(){
  const targets = t => {
    if (typeof t === "string") return Array.from(document.querySelectorAll(t));
    if (!t) return [];
    if (t instanceof Element) return [t];
    if (Array.isArray(t) || t instanceof NodeList) return Array.from(t).flatMap(targets);
    return [t];
  };
  const applyVars = (el, v) => {
    if (el instanceof Element) {
      const st = el.style;
      ["opacity","visibility","display","clipPath","borderColor","strokeDasharray","strokeDashoffset"].forEach(k => { if (k in v) st[k] = v[k]; });
      ["width","height"].forEach(k => { if (k in v) st[k] = typeof v[k] === "number" ? v[k] + "px" : v[k]; });
      if ("scaleX" in v) st.transform = "scaleX(" + v.scaleX + ")";
      else if (["x","y","scale","rotate"].some(k => k in v)) {
        const x = parseFloat(v.x) || 0, y = parseFloat(v.y) || 0, sc = "scale" in v ? v.scale : 1, r = parseFloat(v.rotate) || 0;
        st.transform = (x === 0 && y === 0 && sc === 1 && r === 0) ? "" : "translate(" + x + "px," + y + "px) scale(" + sc + ") rotate(" + r + "deg)";
      }
      if (v.clearProps) String(v.clearProps).split(",").forEach(p => st.removeProperty(p.trim() === "transform" ? "transform" : p.trim()));
    } else if (el && typeof el === "object") {
      Object.keys(v).forEach(k => { if (typeof v[k] === "number") el[k] = v[k]; });
    }
  };
  const tweenTo = (t, v) => {
    const run = () => {
      targets(t).forEach(el => applyVars(el, v));
      if (v.onUpdate) v.onUpdate();
      if (v.onComplete) v.onComplete();
    };
    if (v.delay > 0) setTimeout(run, v.delay * 1000); else run();
  };
  const timeline = (opts = {}) => {
    const tl = {
      to(t, v){ tweenTo(t, v || {}); return tl; },
      from(){ return tl; },
      fromTo(t, f, v){ tweenTo(t, v || {}); return tl; },
      set(t, v){ tweenTo(t, v || {}); return tl; },
      call(fn){ fn(); return tl; },
    };
    if (opts.onComplete) queueMicrotask(opts.onComplete);
    return tl;
  };
  return {
    defaults(){}, timeline,
    to(t, v){ tweenTo(t, v || {}); },
    from(){},
    fromTo(t, f, v){ tweenTo(t, v || {}); },
    set(t, v){ tweenTo(t, v || {}); },
  };
}
if (typeof window.gsap === "undefined") window.gsap = createGsapFallback();
gsap.defaults({ease:"power2.out"});

/* Reduced motion: GSAP ignores the CSS media query, so speed its global clock up instead. */
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
function applyMotionPreference(){
  if (gsap.globalTimeline && gsap.globalTimeline.timeScale) gsap.globalTimeline.timeScale(reducedMotionQuery.matches ? 100 : 1);
}
applyMotionPreference();
if (reducedMotionQuery.addEventListener) reducedMotionQuery.addEventListener("change", applyMotionPreference);


/* Stagger a set of elements up-and-in */
function revealStagger(els, opts={}){
  return gsap.from(els,{
    opacity:0, y:opts.y ?? 16, duration:opts.duration ?? 0.5,
    stagger:opts.stagger ?? 0.05, ease:"power2.out", delay:opts.delay ?? 0,
    clearProps:"opacity,transform", // GSAP otherwise leaves an inline transform that overrides CSS :hover lifts
  });
}

/* View / page transition: exit old, enter new */
function transitionView(oldEl, newEl, onSwapped){
  const tl = gsap.timeline();
  if(oldEl){
    tl.to(oldEl,{opacity:0, y:-8, duration:0.22, ease:"power1.in", onComplete:()=>{
      oldEl.classList.remove("active");
      gsap.set(oldEl,{clearProps:"opacity,transform"});
    }});
  }
  tl.call(()=>{
    newEl.classList.add("active");
    if(onSwapped) onSwapped();
  });
  tl.fromTo(newEl,
    {opacity:0, y:14, clipPath:"inset(6% 0% 0% 0% round 8px)"},
    {opacity:1, y:0, clipPath:"inset(0% 0% 0% 0% round 0px)", duration:0.5, ease:"power2.out"}
  );
  const staggerTargets = newEl.querySelectorAll(".panel, .card, .table-card, .card-list, .wizard");
  if(staggerTargets.length){
    tl.from(staggerTargets,{opacity:0, y:16, duration:0.45, stagger:0.045, ease:"power2.out", clearProps:"opacity,transform"},"-=0.32");
  }
  return tl;
}

/* Modal open/close timelines */
function openModalEl(backdropEl, modalEl, onOpened){
  gsap.set(backdropEl,{display:"flex"});
  const tl = gsap.timeline({onComplete:onOpened});
  tl.to(backdropEl,{opacity:1, visibility:"visible", duration:0.25, ease:"power1.out"});
  tl.to(modalEl,{opacity:1, scale:1, y:0, duration:0.38, ease:"back.out(1.6)"},"-=0.1");
  const fields = modalEl.querySelectorAll(".field, .catalog-card, .pick-row, .wizard-rail .wizard-step");
  if(fields.length){
    tl.from(fields,{opacity:0, y:10, duration:0.32, stagger:0.03, ease:"power2.out"},"-=0.22");
  }
  return tl;
}
function closeModalEl(backdropEl, modalEl, onDone){
  const tl = gsap.timeline({onComplete:()=>{
    gsap.set(backdropEl,{display:"none"});
    if(onDone) onDone();
  }});
  tl.to(modalEl,{opacity:0, scale:0.95, y:8, duration:0.22, ease:"power1.in"});
  tl.to(backdropEl,{opacity:0, duration:0.18, ease:"power1.in"},"-=0.1");
  tl.set(backdropEl,{visibility:"hidden"});
  return tl;
}

/* Toast notification */
function showToast(message, opts={}){
  const region = document.getElementById("toast-region");
  const el = document.createElement("div");
  const kind = opts.kind || (opts.warn ? "warn" : "success");
  el.className = "toast toast-" + kind;
  el.setAttribute("role", kind==="error" ? "alert" : "status");
  el.style.setProperty("--toast-hold", (opts.hold ?? 2.6) + "s");
  const iconSvg = kind==="error" || kind==="warn"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18.3A1.6 1.6 0 0 0 3.3 20.7h17.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-3.4 0z"/></svg>'
    : kind==="info"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
  const icon = document.createElement("span");
  icon.className = "t-ic";
  icon.innerHTML = iconSvg; // static markup only
  const text = document.createElement("span");
  text.textContent = message;
  el.append(icon, text);
  region.appendChild(el);
  const tl = gsap.timeline({onComplete:()=>{
    gsap.to(el,{opacity:0, x:30, duration:0.3, delay:opts.hold ?? 2.6, ease:"power1.in",
      onComplete:()=> el.remove()});
  }});
  tl.to(el,{opacity:1, x:0, duration:0.4, ease:"back.out(1.7)"});
}

/* Stamp animation (issue / return confirmation) */
function playStamp(stampEl){
  gsap.set(stampEl,{scale:0, opacity:0, rotate:-8});
  const tl = gsap.timeline();
  tl.to(stampEl,{scale:1.15, opacity:1, duration:0.16, ease:"power1.in"});
  tl.to(stampEl,{scale:1, duration:0.28, ease:"elastic.out(1,0.5)"});
  return tl;
}

/* Animate a numeric field (fine amount) from-to */
function animateNumber(el, from, to, opts={}){
  const obj={v:from};
  gsap.to(obj,{
    v:to, duration:opts.duration ?? 0.8, ease:opts.ease ?? "power2.out",
    onUpdate:()=>{ el.textContent = "₱" + obj.v.toFixed(2).replace(/\.00$/,""); },
  });
}

/* Focus micro-interaction for inputs: animated underline */
function wireFieldFocus(root){
  root.querySelectorAll(".field input, .field select, .field textarea").forEach(input=>{
    input.addEventListener("focus",()=>{
      gsap.to(input,{borderColor:"var(--green)", duration:0.2});
    });
    input.addEventListener("blur",()=>{
      gsap.to(input,{borderColor:"var(--line-strong)", duration:0.2});
    });
  });
}

/* Magnetic hover for primary buttons (subtle) */
function wireMagnetic(root){
  root.querySelectorAll(".btn-primary").forEach(btn=>{
    btn.addEventListener("mousemove", e=>{
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width/2) * 0.18;
      const y = (e.clientY - r.top - r.height/2) * 0.35;
      gsap.to(btn,{x,y,duration:0.3,ease:"power2.out"});
    });
    btn.addEventListener("mouseleave",()=>{
      gsap.to(btn,{x:0,y:0,duration:0.4,ease:"elastic.out(1,0.4)"});
    });
  });
}

/* Draw-in for SVG paths (line charts) */
function drawPath(pathEl, opts={}){
  const len = pathEl.getTotalLength();
  gsap.set(pathEl,{strokeDasharray:len, strokeDashoffset:len});
  gsap.to(pathEl,{strokeDashoffset:0, duration:opts.duration ?? 1.2, ease:"power2.inOut", delay:opts.delay ?? 0});
}



/* ==================================================================
   APP.JS — state, rendering, navigation, wiring
   ================================================================== */
const state = {
  currentView:"dashboard",
  books:{
    search:"", category:"all", sort:"featured",
    filters:{ subjects:[], authors:[], availability:[], years:[], formats:[] },
  },
  users:{ search:"", filter:"all", sort:"name-asc" },
  issue:{ studentId:null, bookId:null, sq:"", bq:"", availOnly:true, requestedOnly:false, keep:true },
  ret:{ bookId:null, q:"", returnDate:null, fine:0, overdueDays:0 },
  selectedBookId:null,
  booksLimit:48, booksSig:"", usersLimit:0, usersSig:"",
  reportType:"borrowing",
  audit:{ filter:"all", from:"", to:"", page:1 },
  overdue:{ q:"", band:"all", sort:"days", page:1 },
  borrowing:{ q:"", sort:"newest", page:1 },
};

/* ---- Browser-local UI state only: recently viewed titles and recent searches. ---- */
const DISCOVERY_STORAGE = { recent:"feu-recently-viewed", searches:"feu-recent-searches" };
function loadIdList(key){ try{ return JSON.parse(localStorage.getItem(key) || "[]"); }catch(e){ return []; } }
function saveIdList(key, list){ try{ localStorage.setItem(key, JSON.stringify(list)); }catch(e){} }

let recentlyViewedIds = loadIdList(DISCOVERY_STORAGE.recent);
let recentSearches = loadIdList(DISCOVERY_STORAGE.searches);

function pushRecentlyViewed(id){
  recentlyViewedIds = [id, ...recentlyViewedIds.filter(x=>x!==id)].slice(0,8);
  saveIdList(DISCOVERY_STORAGE.recent, recentlyViewedIds);
}
function pushRecentSearch(q){
  q = q.trim();
  if(!q) return;
  recentSearches = [q, ...recentSearches.filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,5);
  saveIdList(DISCOVERY_STORAGE.searches, recentSearches);
}

const VIEW_META = {
  dashboard:{title:"Discover"},
  books:{title:"Collection"},
  users:{title:"Users"},
  issue:{title:"Issue Book"},
  return:{title:"Return Book"},
  reports:{title:"Reports"},
  audit:{title:"Audit Trail"},
  settings:{title:"Settings"},
  "book-details":{title:"Book"},
};

function debounce(fn, ms){
  let t;
  return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
}
function $(sel,root=document){ return root.querySelector(sel); }
function $all(sel,root=document){ return Array.from(root.querySelectorAll(sel)); }
function esc(str){
  return String(str ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initialsOf(name){
  name = String(name || "");
  // "Last, First M." -> first initial + last initial (e.g. "Dela Cruz, Juan D." -> "JD")
  if(name.includes(",")){
    const [last, rest] = name.split(",");
    const first = rest.trim().split(" ")[0] || "";
    return ((first[0] || "") + (last.trim()[0] || "")).toUpperCase();
  }
  return name.split(" ").map(p=>p[0]).slice(0,2).join("").toUpperCase();
}
// Matches a patron by "Last, First M." or by the natural order "First Last"
function userNameMatches(u, q){
  if(!u) return false;
  const natural = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return u.name.toLowerCase().includes(q) || natural.toLowerCase().includes(q);
}
function badgeClassFor(status){
  return {Available:"badge-available", Borrowed:"badge-borrowed", Overdue:"badge-overdue",
          Active:"badge-active", Inactive:"badge-inactive", Returned:"badge-available"}[status] || "badge-inactive";
}
function findBook(id){ return BOOKS.find(b=>b.id===id); }
function findUser(id){ return USERS.find(u=>u.id===id); }
/* Why a patron cannot borrow right now ("" when they can). The server enforces the same rule. */
function holdReason(u){
  if(!u) return "";
  if(u.overdueLoans > 0) return `${u.overdueLoans} overdue book${u.overdueLoans===1?"":"s"}`;
  if(u.unpaidFines > 0) return `Unpaid fines ${peso(u.unpaidFines)}`;
  return "";
}

/* ---------------- Focus helpers ---------------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focusableIn(root){
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(el=> !el.closest("[hidden]") && el.getClientRects().length > 0);
}
/* Keep Tab / Shift+Tab inside `root` (modals, the open mobile menu). */
function trapTab(e, root){
  if(e.key !== "Tab") return;
  const items = focusableIn(root);
  if(!items.length){ e.preventDefault(); return; }
  const first = items[0], last = items[items.length-1], active = document.activeElement;
  if(e.shiftKey && (active === first || !root.contains(active))){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && (active === last || !root.contains(active))){ e.preventDefault(); first.focus(); }
}
function focusViewHeading(viewEl){
  const h = viewEl.querySelector("h1");
  if(!h) return;
  h.setAttribute("tabindex","-1");
  h.focus({preventScroll:true});
}

/* ---------------- Navigation ---------------- */
function goToView(viewName, opts={}){
  if(viewName === state.currentView && !opts.force) {
    if(opts.settingsPane) showSettingsPane(opts.settingsPane);
    if(opts.booksTab==="add") openBookModal(null);
    if(opts.usersTab==="add") openUserModal(null);
    if(opts.report) renderReports(opts.report);
    if(typeof opts.after === "function") opts.after();
    return;
  }
  const oldEl = document.getElementById("view-" + state.currentView);
  const newEl = document.getElementById("view-" + viewName);
  if(!newEl) return;

  const navHighlight = viewName === "book-details" ? "books" : viewName;
  $all(".menu-link[data-view]").forEach(n=>{
    const matches = n.dataset.view === navHighlight;
    n.classList.toggle("active", matches);
    if(matches) n.setAttribute("aria-current","page"); else n.removeAttribute("aria-current");
  });
  const groupFor = {books:"books", users:"users", issue:"transactions", return:"transactions", reports:"reports", audit:"reports"};
  $all(".menu-drop").forEach(drop=>{
    drop.querySelector(".menu-link")?.classList.toggle("active", groupFor[viewName]===drop.dataset.navGroup);
  });

  const meta = VIEW_META[viewName];
  transitionView(oldEl, newEl, ()=>{
    state.currentView = viewName;
    if(viewName === "books") renderBooks();
    if(viewName === "book-details") renderBookDetails(state.selectedBookId);
    if(viewName === "users") renderUsers();
    if(viewName === "issue") {
      resetIssueWizard(opts.bookId);
      refreshIssueStudentData();
    }
    if(viewName === "return") resetReturnWizard();
    if(viewName === "reports") renderReports(opts.report || "borrowing");
    if(viewName === "audit") renderAudit();
    if(viewName === "dashboard") { renderDashboard(); }
    if(viewName === "settings") {
      showSettingsPane(opts.settingsPane || "profile");
      hydrateSettings();
    }
    if(meta) document.title = meta.title + " · FEU Roosevelt Library";
    if(!opts.silent) focusViewHeading(newEl);
    if(opts.booksTab==="add") openBookModal(null);
    if(opts.usersTab==="add") openUserModal(null);
    if(typeof opts.after === "function") opts.after();
  });
  closeMobileNav();
  closeAllPopovers();
}

$all("[data-view]").forEach(btn=>{
  if(btn.closest(".settings-nav")) return;
  btn.addEventListener("click", ()=>{
    const view = btn.dataset.view;
    if(!view) return;
    goToView(view, {
      booksTab:btn.dataset.booksTab, usersTab:btn.dataset.usersTab, report:btn.dataset.report,
    });
  });
});

/* In-page anchors (Services / About) live on the homepage. From any other
   view, navigate home first, then smooth-scroll once the transition settles. */
$all("[data-anchor]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const id = btn.dataset.anchor;
    const jump = ()=> document.getElementById(id)?.scrollIntoView({behavior:"smooth", block:"start"});
    if(state.currentView !== "dashboard"){
      goToView("dashboard", {after:()=> requestAnimationFrame(jump)});
    } else {
      jump();
    }
    closeMobileNav();
  });
});

/* Hero search routes into the Collection view with that query applied. */
$("#hero-search-form")?.addEventListener("submit", e=>{
  e.preventDefault();
  const q = $("#hero-search-input")?.value || "";
  state.books.search = q;
  state.books.category = "all";
  state.books.filters = emptyFilters();
  if(q.trim()) pushRecentSearch(q);
  goToView("books", {force:true, after:()=>{ const f = $("#books-search"); if(f) f.value = q; toggleSearchClear(); }});
});

/* ---------------- Header menus + mobile nav ---------------- */
const menubarEl = document.getElementById("menubar");
const overlayEl = document.getElementById("nav-overlay");
function openMobileNav(){
  menubarEl.classList.add("open");
  overlayEl.classList.add("show");
  gsap.fromTo(menubarEl,{x:-24},{x:0,duration:0.28,ease:"power3.out"});
  gsap.to(overlayEl,{opacity:1,duration:0.22});
  $("#hamburger-btn").setAttribute("aria-expanded","true");
  $(".menubar-close", menubarEl)?.focus();
}
function closeMobileNav(opts={}){
  if(!menubarEl.classList.contains("open")) return;
  gsap.to(overlayEl,{opacity:0,duration:0.18, onComplete:()=>overlayEl.classList.remove("show")});
  menubarEl.classList.remove("open");
  $("#hamburger-btn").setAttribute("aria-expanded","false");
  if(opts.restore) $("#hamburger-btn").focus();
}
$("#hamburger-btn").addEventListener("click", ()=>{
  menubarEl.classList.contains("open") ? closeMobileNav({restore:true}) : openMobileNav();
});
menubarEl.addEventListener("keydown", e=>{
  if(menubarEl.classList.contains("open")) trapTab(e, menubarEl);
});
overlayEl.addEventListener("click", ()=>{ closeMobileNav({restore:true}); closeAllPopovers(); });
$("#menubar-close-btn")?.addEventListener("click", ()=> closeMobileNav({restore:true}));

/* Mobile search toggle: reveals the header search field inline since the
   full-width field is hidden on small screens (see .search-global rules). */
$("#search-toggle-btn")?.addEventListener("click", ()=>{
  const field = $("#global-search")?.closest(".search-global");
  if(!field) return;
  const open = field.classList.toggle("mobile-open");
  $("#search-toggle-btn").setAttribute("aria-expanded", String(open));
  if(open) $("#global-search")?.focus();
});

$all(".menu-drop > .menu-link").forEach(btn=>{
  btn.addEventListener("click", e=>{
    e.stopPropagation();
    const drop = btn.parentElement;
    const willOpen = !drop.classList.contains("open");
    closeAllPopovers();
    if(willOpen){ drop.classList.add("open"); btn.setAttribute("aria-expanded","true"); }
  });
  btn.parentElement.addEventListener("focusout", e=>{
    const drop = btn.parentElement;
    if(e.relatedTarget && drop.contains(e.relatedTarget)) return;
    drop.classList.remove("open");
    btn.setAttribute("aria-expanded","false");
  });
});

function closeAllPopovers(){
  $all(".header-pop .dropdown-panel").forEach(p=> p.hidden = true);
  $("#notif-btn")?.setAttribute("aria-expanded","false");
  $("#avatar-btn")?.setAttribute("aria-expanded","false");
  $all(".menu-drop").forEach(d=>{
    d.classList.remove("open");
    d.querySelector(".menu-link")?.setAttribute("aria-expanded","false");
  });
}
function togglePopover(btn, panel){
  const open = panel.hidden;
  closeAllPopovers();
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}
$("#notif-btn").addEventListener("click", e=>{
  e.stopPropagation();
  togglePopover($("#notif-btn"), $("#notif-menu"));
});
$("#avatar-btn").addEventListener("click", e=>{
  e.stopPropagation();
  togglePopover($("#avatar-btn"), $("#profile-menu"));
});
document.addEventListener("click", closeAllPopovers);
document.addEventListener("keydown", e=>{
  if(e.key !== "Escape" || scrollLockCount > 0) return;
  if(menubarEl.classList.contains("open")){ closeMobileNav({restore:true}); return; }
  const pop = [["#notif-menu","#notif-btn"],["#profile-menu","#avatar-btn"]].find(([p])=> !$(p).hidden);
  if(pop){ closeAllPopovers(); $(pop[1]).focus(); return; }
  const drop = $(".menu-drop.open");
  if(drop){ closeAllPopovers(); drop.querySelector(".menu-link").focus(); return; }
  const search = $(".search-global.mobile-open");
  if(search){
    search.classList.remove("mobile-open");
    $("#search-toggle-btn").setAttribute("aria-expanded","false");
    $("#search-toggle-btn").focus();
  }
});
$("#profile-menu").addEventListener("click", e=> e.stopPropagation());
$("#notif-menu").addEventListener("click", e=> e.stopPropagation());

async function signOutCurrentSession(){
  try {
    await api("auth.php", {method:"POST", body:JSON.stringify({action:"logout"})});
    window.location.reload();
  } catch (err) {
    showToast(err.message, {kind:"error"});
  }
}

$all("[data-go]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    goToView("settings", {force:true, settingsPane:"profile"});
    closeAllPopovers();
  });
});
$("#menu-logout").addEventListener("click", ()=>{
  closeAllPopovers();
  renderConfirm({
    title:"Sign out?",
    body:"Your current staff session will be ended.",
    confirmLabel:"Sign out",
    onConfirm:signOutCurrentSession,
  });
});
$("#menu-theme-toggle").addEventListener("click", ()=>{
  const next = document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark";
  applyTheme(next);
  closeAllPopovers();
});

function applyTheme(pref, persist=true){
  const resolved = pref==="dark" || (pref==="system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-pref", pref);
  if(persist) localStorage.setItem(STORAGE.theme, pref);
  $all(".theme-card").forEach(c=>{ c.classList.toggle("active", c.dataset.themePref===pref); c.setAttribute("aria-pressed", String(c.dataset.themePref===pref)); });
  const toggle = $("#menu-theme-toggle");
  if(toggle) toggle.textContent = resolved==="dark" ? "Light Mode" : "Dark Mode";
  if(state.currentView==="dashboard") renderDashboard({cached:true});
  if(state.currentView==="reports") renderReports(state.reportType, {cached:true});
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{
  if((localStorage.getItem(STORAGE.theme)||"light")==="system") applyTheme("system", false);
});
/* Paints the saved theme without touching any view. Used on the sign-in screen (which has no theme control of its own),
   so it always matches the dashboard even if js/theme-init.js did not run. */
function syncThemeFromStorage(){
  let pref = "light";
  try{ pref = localStorage.getItem(STORAGE.theme) || "light"; }catch(e){}
  const dark = pref==="dark" || (pref==="system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme-pref", pref);
}
/* Another tab changed the theme: follow it (sign-in screen or dashboard). */
window.addEventListener("storage", e=>{
  if(e.key !== STORAGE.theme) return;
  if($("#login-screen") && !$("#login-screen").hidden) syncThemeFromStorage();
  else applyTheme(e.newValue || "light", false);
});

/* ==================================================================
   BOOK CARDS (shared by collection, related and recently viewed)
   ================================================================== */
const BOOK_CARD_COLORS = ["var(--green)","var(--green-deep)","var(--oxblood)","var(--brass)","var(--navy-badge)"];
function colorForBook(book){
  const key = String(book.id || book.title || "");
  let h = 0;
  for(let k=0;k<key.length;k++) h = (h*31 + key.charCodeAt(k)) >>> 0;
  return BOOK_CARD_COLORS[h % BOOK_CARD_COLORS.length];
}
function bookInitial(book){
  const t = String(book.title || "").replace(/^(the|a|an)\s+/i,"").trim();
  return (t[0] || "?").toUpperCase();
}
function availabilityBucket(book){
  if(book.status==="Available") return "Available";
  return book.status==="Overdue" ? "Overdue" : "Borrowed";
}
function availabilityBadgeClass(bucket){
  return {Available:"badge-available", Borrowed:"badge-borrowed", Overdue:"badge-overdue"}[bucket] || "badge-inactive";
}
function bookCardHTML(book, i, opts={}){
  const bucket = availabilityBucket(book);
  return `
    <div class="book-card${opts.featured ? " book-card-featured" : ""}" data-book-id="${esc(book.id)}" tabindex="0" role="button" aria-label="View ${esc(book.title)} by ${esc(book.author)}">
      <div class="book-card-face" style="--book-color:${colorForBook(book,i)}">
        <div class="book-card-initial">${esc(bookInitial(book))}</div>
        ${book.cover ? `<img class="book-card-cover" src="${esc(book.cover)}" alt="" loading="lazy" data-hide-on-error>` : ""}
        <span class="book-card-availability-pill ${availabilityBadgeClass(bucket)}">${esc(bucket)}</span>
        <span class="book-card-hover-cta">View book
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </span>
      </div>
      <div class="book-card-body">
        <div class="book-card-top-row">
          <span class="book-card-cat">${esc(book.category)}</span>
          <span class="book-card-dot ${availabilityBadgeClass(bucket)}" title="${esc(bucket)}"></span>
        </div>
        <div class="book-card-title">${esc(book.title)}</div>
        <div class="book-card-author">${esc(book.author)}</div>
      </div>
    </div>`;
}
/* A cover image that fails to load is removed so the coloured card face shows instead.
   (Replaces an inline error-handler attribute, which a strict Content-Security-Policy forbids. Image errors do not
   bubble, so listen in the capture phase.) */
document.addEventListener("error", e=>{
  const t = e.target;
  if(t && t.tagName === "IMG" && t.hasAttribute("data-hide-on-error")) t.remove();
}, true);

function wireBookCards(root){
  $all(".book-card", root).forEach(card=>{
    const go = ()=> openBookDetails(card.dataset.bookId);
    card.addEventListener("click", go);
    card.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } });
  });
}
function renderBookRow(containerId, books){
  const row = document.getElementById(containerId);
  if(!row) return;
  row.innerHTML = books.map((b,i)=> bookCardHTML(b,i)).join("");
  const cards = $all(".book-card", row);
  if(cards.length) revealStagger(cards,{y:10, stagger:0.04});
  wireBookCards(row);
}

/* ==================================================================
   REPORTS — all figures come from api/reports.php
   ================================================================== */
let REPORT = null;
async function loadReport(){ REPORT = await api("reports.php"); return REPORT; }
function peso(n){ return "₱" + Number(n || 0).toFixed(2); }
/* Placeholder shapes shown while a report loads (the real chart and rows replace them). */
function reportSkeletonHTML(){
  const kpi = `<div class="bar-kpi"><span class="skel skel-kpi-k"></span><span class="skel skel-kpi-v"></span></div>`;
  return `<div class="skel-report" role="status"><span class="sr-only">Loading report…</span>
    <div class="bar-kpis">${kpi}${kpi}${kpi}</div>
    <div class="skel-bars" aria-hidden="true">${'<span class="skel"></span>'.repeat(7)}</div></div>`;
}
function skeletonRowsHTML(n){
  return Array.from({length:n}, ()=>`<tr class="skel-row" aria-hidden="true"><td colspan="7"><span class="skel skel-line"></span></td></tr>`).join("");
}
function errorWithRetry(el, msg, onRetry){
  el.innerHTML = `<div class="dash-status" role="alert" style="margin:0;"><span>${esc(msg)}</span><button class="btn btn-secondary btn-sm" type="button" data-retry>Retry</button></div>`;
  el.querySelector("[data-retry]").addEventListener("click", onRetry);
}

function renderHomepage(){
  // Featured: one real title from each of the first five categories found in the catalog.
  const seenCats = new Set();
  const featured = [];
  for(const b of BOOKS){
    const cat = b.category || "Uncategorized";
    if(!seenCats.has(cat)){ seenCats.add(cat); featured.push(b); }
    if(featured.length>=5) break;
  }
  const grid = $("#featured-collection-grid");
  if(featured.length){
    renderBookRow("featured-collection-grid", featured);
  } else if(grid){
    grid.innerHTML = `<p class="site-section-sub">No books in the catalog yet. Add one from Collection.</p>`;
  }
  // Text that states library rules or contact details comes from the saved settings.
  const days = CONFIG.loanDays, max = CONFIG.maxBooksPerUser;
  const borrow = $("#svc-borrowing-text");
  if(borrow) borrow.textContent = `Take home up to ${max} ${max===1?"title":"titles"} at a time, with a ${days}-day loan period.`;
  const contact = [CONFIG.libraryAddress, CONFIG.libraryPhone, CONFIG.libraryEmail].filter(Boolean);
  const svc = $("#svc-contact-text");
  if(svc && contact.length) svc.textContent = contact.join(" · ");
  const setText = (id, v)=>{ const el = $(id); if(el) el.textContent = v || ""; };
  setText("#footer-address", CONFIG.libraryAddress);
  setText("#footer-phone", CONFIG.libraryPhone);
  setText("#footer-email", CONFIG.libraryEmail);
  setText("#footer-year", String(new Date().getFullYear()));
}
function renderDashboard(opts={}){
  renderHomepage();
  if(!opts.cached) refreshNotifications();
}

/* Round an axis step up to a tidy whole number (1, 2, 3, 4, 5, 6, 8, 10, 20, 30...). */
function niceAxisStep(raw){
  raw = Math.max(1, raw);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n<=1 ? 1 : n<=2 ? 2 : n<=3 ? 3 : n<=4 ? 4 : n<=5 ? 5 : n<=6 ? 6 : n<=8 ? 8 : 10) * pow;
}

/* Borrowing report chart: summary tiles + grouped bars (issued vs returned) with a legend, y-axis,
   a value above every bar, and a tooltip on hover, tap or keyboard focus. Plain HTML/CSS (no SVG scaling),
   so the chart keeps a fixed height and readable type at any panel width. */
function renderActivityChart(targetId, activity){
  const wrap = document.getElementById(targetId);
  const rows = (activity || []).map(a=>({
    label: String(a.label || ""), date: a.date,
    issued: Number(a.issued) || 0, returned: Number(a.returned) || 0,
  }));
  const sumIssued = rows.reduce((n,r)=>n+r.issued, 0);
  const sumReturned = rows.reduce((n,r)=>n+r.returned, 0);
  const peakIssued = Math.max(0, ...rows.map(r=>r.issued));
  let peak = -1; // busiest day by books issued (the most recent day wins a tie)
  rows.forEach((r,i)=>{ if(r.issued>0 && r.issued>=peakIssued) peak = i; });
  const maxV = Math.max(1, ...rows.map(r=>Math.max(r.issued, r.returned)));
  const step = niceAxisStep(maxV * 1.1 / 3); // three intervals with ~10% headroom for the value labels
  const top = step * 3;
  const pct = v => (v / top * 100).toFixed(2);

  const grid = [3,2,1].map(k=>`<div class="bar-grid" style="top:${pct(top - k*step)}%"><span>${k*step}</span></div>`).join("")
    + `<div class="bar-grid base" style="top:100%"><span>0</span></div>`;
  const cols = rows.map((r,i)=>{
    const desc = `${r.label}, ${fmtDate(r.date)}: ${r.issued} issued, ${r.returned} returned`;
    return `<div class="bar-col" tabindex="0" role="img" aria-label="${esc(desc)}" data-i="${i}">
      <div class="bar bar-issued" style="height:${pct(r.issued)}%"><span class="bar-val">${r.issued}</span></div>
      <div class="bar bar-returned" style="height:${pct(r.returned)}%"><span class="bar-val">${r.returned}</span></div>
      <span class="bar-label">${esc(r.label)}</span>
    </div>`;
  }).join("");

  wrap.innerHTML = `<div class="bar-chart">
    <div class="bar-kpis">
      <div class="bar-kpi"><span class="bar-kpi-k">Issued &middot; 7 days</span><b>${sumIssued}</b></div>
      <div class="bar-kpi"><span class="bar-kpi-k">Returned &middot; 7 days</span><b>${sumReturned}</b></div>
      <div class="bar-kpi"><span class="bar-kpi-k">Busiest day</span><b>${peak>=0 ? esc(rows[peak].label) : "&mdash;"}</b><span class="bar-kpi-f">${peak>=0 ? rows[peak].issued + " issued" : "No activity"}</span></div>
    </div>
    <div class="bar-legend"><span><i class="bar-issued"></i>Issued</span><span><i class="bar-returned"></i>Returned</span></div>
    <div class="bar-plot" role="group" aria-label="Books issued and returned per day over the last 7 days">
      ${grid}<div class="bar-cols">${cols}</div><div class="bar-tip" hidden></div>
    </div>
  </div>` + (sumIssued + sumReturned === 0 ? `<div class="chart-empty">No borrowing activity in the last 7 days.</div>` : "");

  const plot = wrap.querySelector(".bar-plot"), tip = wrap.querySelector(".bar-tip");
  const colEls = $all(".bar-col", plot);
  const show = col=>{
    const r = rows[+col.dataset.i];
    colEls.forEach(c=> c.classList.toggle("is-active", c===col));
    tip.innerHTML = `<span class="bar-tip-h">${esc(r.label)}, ${esc(fmtDate(r.date))}</span><br>Issued ${r.issued} &middot; Returned ${r.returned}`;
    tip.hidden = false;
    const w = tip.offsetWidth, center = col.offsetLeft + col.offsetWidth/2;
    tip.style.left = Math.min(Math.max(center, w/2 - 30), plot.clientWidth + 6 - w/2) + "px";
    tip.style.top = Math.max(plot.clientHeight * (1 - Math.max(r.issued, r.returned)/top) - 20, 0) + "px";
  };
  const hide = ()=>{ tip.hidden = true; colEls.forEach(c=> c.classList.remove("is-active")); };
  colEls.forEach(col=>{
    col.addEventListener("mouseenter", ()=> show(col));
    col.addEventListener("focus", ()=> show(col));
    col.addEventListener("click", ()=> show(col));
  });
  plot.addEventListener("mouseleave", hide);
  plot.addEventListener("focusout", e=>{ if(!plot.contains(e.relatedTarget)) hide(); });
}

/* ---------- Notifications: real counts from api/notifs.php ---------- */
let lastNotifSig = "";
async function refreshNotifications(){
  const list = $("#notif-list"), dot = $("#notif-dot");
  if(!list) return;
  let items = [];
  try{ items = (await api("notifs.php")).items || []; }
  catch(e){ list.innerHTML = `<div class="drop-empty">Notifications are unavailable.</div>`; dot.hidden = true; return; }
  dot.hidden = items.length===0;
  const sig = items.map(n=>n.title).join("|");
  if(items.length && sig !== lastNotifSig) nudgeBell();
  lastNotifSig = sig;
  list.innerHTML = items.map(n=>`<button class="drop-item" type="button" data-kind="${esc(n.kind)}"><span>${esc(n.title)}</span><small>${esc(n.when)}</small></button>`).join("")
    || `<div class="drop-empty">You're all caught up.</div>`;
  $all("[data-kind]", list).forEach(btn=> btn.addEventListener("click", ()=>{
    closeAllPopovers();
    const k = btn.dataset.kind;
    if(k==="overdue") goToView("reports", {report:"overdue", force:true});
    else if(k==="returns" || k==="due") goToView("reports", {report:"borrowing", force:true});
    else goToView("dashboard", {force:true});
  }));
}


/* ==================================================================
   COLLECTION / DISCOVERY MODULE
   ================================================================== */
const YEAR_BUCKETS = [
  {id:"pre1950", label:"Before 1950", test:y=> y<1950},
  {id:"1950-1999", label:"1950–1999", test:y=> y>=1950 && y<2000},
  {id:"2000-2015", label:"2000–2015", test:y=> y>=2000 && y<=2015},
  {id:"2016-now", label:"2016–Present", test:y=> y>2015},
];
const SUGGESTED_SEARCHES = ["Books about Philippine history","Psychology","Computer Science","Literature"];

function emptyFilters(){ return { subjects:[], authors:[], availability:[], years:[], formats:[] }; }
function filtersActiveCount(){
  return Object.values(state.books.filters).reduce((n,a)=>n+a.length, 0);
}
function hasActiveDiscovery(){
  return state.books.search.trim().length>0 || state.books.category!=="all" || filtersActiveCount()>0;
}

function getFilteredBooks(){
  const {search, category, filters, sort} = state.books;
  const q = search.trim().toLowerCase();
  let list = BOOKS.filter(b=>{
    const matchesSearch = !q || [b.title,b.author,b.category].some(v=>String(v ?? "").toLowerCase().includes(q));
    const matchesCategory = category==="all" || b.category===category;
    const matchesSubject = !filters.subjects.length || filters.subjects.includes(b.category);
    const matchesAuthor = !filters.authors.length || filters.authors.includes(b.author);
    const matchesAvailability = !filters.availability.length || filters.availability.includes(availabilityBucket(b));
    const matchesFormat = !filters.formats.length || filters.formats.includes(b.format);
    const matchesYear = !filters.years.length || filters.years.some(yid=>{
      const bucket = YEAR_BUCKETS.find(yb=>yb.id===yid);
      return bucket && b.year!=null && bucket.test(b.year);
    });
    return matchesSearch && matchesCategory && matchesSubject && matchesAuthor && matchesAvailability && matchesFormat && matchesYear;
  });
  list.sort((a,b)=>{
    if(sort==="newest") return (b.year||0) - (a.year||0);
    if(sort==="title") return a.title.localeCompare(b.title);
    if(sort==="author") return a.author.localeCompare(b.author);
    if(sort==="popular") return (b.borrowCount||0) - (a.borrowCount||0);
    return 0; /* featured: curated catalog order */
  });
  return list;
}

function renderBooks(){
  const filtered = getFilteredBooks();
  const hasQuery = state.books.search.trim().length>0;
  const active = hasActiveDiscovery();

  const heading = $("#books-hero-heading");
  const sub = $("#books-hero-sub");
  if(hasQuery){
    heading.innerHTML = `Search results for <span class="collection-hero-query">&ldquo;${esc(state.books.search.trim())}&rdquo;</span>`;
    sub.textContent = `${filtered.length} book${filtered.length===1?"":"s"} found.`;
  } else {
    heading.textContent = "Explore the collection";
    sub.textContent = "Find stories, ideas, and perspectives across the FEU Roosevelt Library.";
  }
  $("#books-count-sub").textContent = active
    ? `${filtered.length} of ${BOOKS.length} volumes`
    : `${BOOKS.length} volumes in the collection`;

  $all("#books-category-list [data-category]").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.category === state.books.category);
    btn.setAttribute("aria-pressed", String(btn.dataset.category === state.books.category));
  });
  syncFiltersPanel();

  const grid = $("#books-grid");
  const empty = $("#books-empty");
  const moreWrap = $("#books-more-wrap");
  const sig = JSON.stringify([state.books.search, state.books.category, state.books.sort, state.books.filters]);
  if(sig !== state.booksSig){ state.booksSig = sig; state.booksLimit = 48; }
  if(filtered.length===0){
    grid.innerHTML = ""; grid.hidden = true; empty.hidden = false; moreWrap.hidden = true;
    return;
  }
  grid.hidden = false; empty.hidden = true;
  const shownBooks = filtered.slice(0, state.booksLimit);
  moreWrap.hidden = shownBooks.length >= filtered.length;
  $("#books-more").textContent = `Show more (${filtered.length - shownBooks.length} remaining)`;

  const showFeatured = !active && state.books.sort==="featured";
  grid.innerHTML = shownBooks.map((b,i)=> bookCardHTML(b, i, {featured: showFeatured && i===0})).join("");
  revealStagger($all(".book-card", grid),{y:12, stagger:0.03});
  wireBookCards(grid);
}

/* ---------- Category quick list ---------- */
$all("#books-category-list [data-category]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.books.category = btn.dataset.category;
    renderBooks();
  });
});

/* ---------- Search field: expand-on-focus + suggestions ---------- */
const collectionSearchWrap = $("#collection-search-wrap");
const booksSearchInput = $("#books-search");
const booksSuggestions = $("#books-search-suggestions");

function toggleSearchClear(){
  const btn = $("#books-search-clear");
  if(btn) btn.hidden = !booksSearchInput.value;
}
function renderSearchSuggestions(){
  if(!booksSuggestions) return;
  booksSuggestions.innerHTML = `
    ${recentSearches.length ? `
    <div class="suggestions-group">
      <div class="suggestions-label">Recent searches</div>
      ${recentSearches.map(q=>`<button type="button" class="suggestion-item" data-q="${esc(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>
        ${esc(q)}</button>`).join("")}
    </div>` : ""}
    <div class="suggestions-group">
      <div class="suggestions-label">Suggested</div>
      ${SUGGESTED_SEARCHES.map(q=>`<button type="button" class="suggestion-item" data-q="${esc(q)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        ${esc(q)}</button>`).join("")}
    </div>
    <div class="suggestions-group">
      <div class="suggestions-label">Popular subjects</div>
      <div class="suggestion-chips">
        ${CATEGORIES.map(c=>`<button type="button" class="suggestion-chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
    </div>`;
  booksSuggestions.querySelectorAll(".suggestion-item").forEach(btn=>{
    btn.addEventListener("mousedown", e=>{ e.preventDefault(); commitSearch(btn.dataset.q); });
  });
  booksSuggestions.querySelectorAll(".suggestion-chip").forEach(btn=>{
    btn.addEventListener("mousedown", e=>{
      e.preventDefault();
      state.books.search = ""; booksSearchInput.value = ""; toggleSearchClear();
      state.books.category = btn.dataset.category;
      closeSuggestions();
      renderBooks();
    });
  });
}
function commitSearch(q){
  state.books.search = q;
  booksSearchInput.value = q;
  toggleSearchClear();
  pushRecentSearch(q);
  closeSuggestions();
  renderBooks();
}
function openSuggestions(){ renderSearchSuggestions(); booksSuggestions.hidden = false; collectionSearchWrap?.classList.add("is-focused"); }
function closeSuggestions(){ if(booksSuggestions) booksSuggestions.hidden = true; collectionSearchWrap?.classList.remove("is-focused"); }

booksSearchInput?.addEventListener("focus", openSuggestions);
const renderBooksSoon = debounce(()=>renderBooks(), 150);
booksSearchInput?.addEventListener("input", e=>{ state.books.search = e.target.value; toggleSearchClear(); renderBooksSoon(); });
booksSearchInput?.addEventListener("keydown", e=>{
  if(e.key==="Enter"){ e.preventDefault(); commitSearch(booksSearchInput.value); booksSearchInput.blur(); }
  if(e.key==="Escape"){ closeSuggestions(); booksSearchInput.blur(); }
});
document.addEventListener("click", e=>{
  if(collectionSearchWrap && !collectionSearchWrap.contains(e.target)) closeSuggestions();
});
$("#books-search-clear")?.addEventListener("click", ()=>{ commitSearch(""); booksSearchInput.focus(); });

/* ---------- Filters: subject / author / availability / year / format.
   One panel, reused as an inline dropdown on desktop and a bottom sheet
   on mobile — see .filters-panel responsive rules in style.css. ---------- */
function clearAllFilters(){
  state.books.search = ""; state.books.category = "all"; state.books.filters = emptyFilters();
  if(booksSearchInput){ booksSearchInput.value = ""; toggleSearchClear(); }
  $all("#books-filters-panel input[type=checkbox]").forEach(cb=> cb.checked=false);
  renderBooks();
}
function openFiltersSheet(){
  $("#books-filters-panel")?.classList.add("open");
  $("#books-filters-backdrop")?.classList.add("show");
}
function closeFiltersSheet(){
  $("#books-filters-panel")?.classList.remove("open");
  $("#books-filters-backdrop")?.classList.remove("show");
}
function buildFiltersPanel(){
  const panel = $("#books-filters-panel");
  if(!panel) return;
  const authors = Array.from(new Set(BOOKS.map(b=>b.author))).sort((a,b)=>a.localeCompare(b));
  const group = (title, key, options, labelFn=o=>o, valueFn=o=>o) => `
    <div class="filter-group">
      <div class="filter-group-title">${title}</div>
      <div class="filter-options${key==="authors" ? " filter-options-scroll" : ""}">
        ${options.map(o=>`
          <label class="filter-option">
            <input type="checkbox" data-filter-key="${key}" value="${esc(valueFn(o))}">
            <span>${esc(labelFn(o))}</span>
          </label>`).join("")}
      </div>
    </div>`;
  panel.innerHTML = `
    <div class="filters-panel-head">
      <span>Filters</span>
      <button type="button" class="filters-clear" id="filters-clear-btn">Clear all</button>
      <button type="button" class="modal-close filters-sheet-close" id="filters-sheet-close" aria-label="Close filters">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="filters-panel-body">
      ${group("Subject","subjects",CATEGORIES)}
      ${group("Availability","availability",["Available","Borrowed","Overdue"])}
      ${group("Format","formats",FORMATS)}
      ${group("Year","years",YEAR_BUCKETS,o=>o.label,o=>o.id)}
      ${group("Author","authors",authors)}
    </div>
    <div class="filters-panel-foot">
      <button type="button" class="btn btn-primary btn-block" id="filters-apply-btn">Show results</button>
    </div>`;
  panel.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const arr = state.books.filters[cb.dataset.filterKey];
      if(cb.checked){ if(!arr.includes(cb.value)) arr.push(cb.value); }
      else { state.books.filters[cb.dataset.filterKey] = arr.filter(v=>v!==cb.value); }
      renderBooks();
    });
  });
  $("#filters-clear-btn").addEventListener("click", clearAllFilters);
  $("#filters-apply-btn").addEventListener("click", closeFiltersSheet);
  $("#filters-sheet-close").addEventListener("click", closeFiltersSheet);
  panel.dataset.built = "1";
}
function syncFiltersPanel(){
  const panel = $("#books-filters-panel");
  if(!panel || !panel.dataset.built) return;
  panel.querySelectorAll("input[type=checkbox]").forEach(cb=>{
    cb.checked = (state.books.filters[cb.dataset.filterKey] || []).includes(cb.value);
  });
  const toggle = $("#books-filter-toggle");
  toggle?.querySelector(".filter-count")?.remove();
  const count = filtersActiveCount();
  if(toggle && count>0){
    const changed = toggle.dataset.count !== String(count);
    toggle.insertAdjacentHTML("beforeend", `<span class="filter-count${changed ? " is-new" : ""}">${count}</span>`);
  }
  if(toggle) toggle.dataset.count = String(count);
}
buildFiltersPanel();
$("#books-filter-toggle")?.addEventListener("click", ()=>{
  $("#books-filters-panel")?.classList.contains("open") ? closeFiltersSheet() : openFiltersSheet();
});
$("#books-filters-backdrop")?.addEventListener("click", closeFiltersSheet);
$("#books-empty-clear")?.addEventListener("click", clearAllFilters);

/* ---------- Sort ---------- */
$("#books-sort")?.addEventListener("change", e=>{ state.books.sort = e.target.value; renderBooks(); });

/* ---------- Staff / catalog admin: kept, but tucked away as a quiet
   secondary action so the page reads as a patron collection, not a
   database console. ---------- */
$("#collection-admin-add-book")?.addEventListener("click", ()=>openBookModal(null));


/* ==================================================================
   BOOK DETAILS PAGE
   ================================================================== */
function openBookDetails(id){
  state.selectedBookId = id;
  pushRecentlyViewed(id);
  goToView("book-details", {force:true});
}
function renderBookDetails(id){
  const root = $("#view-book-details");
  const book = findBook(id);
  if(!book){
    $("#bd-content", root).hidden = true;
    $("#bd-notfound", root).hidden = false;
    return;
  }
  $("#bd-content", root).hidden = false;
  $("#bd-notfound", root).hidden = true;

  const i = BOOKS.indexOf(book);
  const bucket = availabilityBucket(book);

  const bdCoverEl = $("#bd-cover");
  bdCoverEl.style.setProperty("--book-color", colorForBook(book, i));
  $("#bd-cover-initial").textContent = bookInitial(book);
  $(".bd-cover-img", bdCoverEl)?.remove();
  if(book.cover){
    const bdImg = document.createElement("img");
    bdImg.className = "bd-cover-img";
    bdImg.src = book.cover;
    bdImg.alt = "";
    bdImg.loading = "lazy";
    bdImg.onerror = ()=> bdImg.remove();
    bdCoverEl.prepend(bdImg);
  }
  $("#bd-category").textContent = book.category || "Uncategorized";
  $("#bd-title").textContent = book.title;
  $("#bd-author").textContent = "by " + book.author;
  $("#bd-description").textContent = book.description || "No description recorded for this title.";

  const borrower = book.borrowedBy ? (findUser(book.borrowedBy) || {name:book.borrowedBy}) : null;
  const who = borrower ? esc(borrower.name) : "a patron";
  const availEl = $("#bd-availability");
  if(bucket==="Available"){
    availEl.innerHTML = `<span class="badge badge-available">Available</span><span class="bd-avail-note">On the shelf and ready to issue.</span>`;
  } else if(bucket==="Overdue"){
    availEl.innerHTML = `<span class="badge badge-overdue">Overdue</span><span class="bd-avail-note">Borrowed by ${who}; was due ${fmtDate(book.dueDate)}.</span>`;
  } else {
    availEl.innerHTML = `<span class="badge badge-borrowed">On loan</span><span class="bd-avail-note">Borrowed by ${who}; due ${fmtDate(book.dueDate)}.</span>`;
  }

  const primaryBtn = $("#bd-primary-action");
  primaryBtn.hidden = bucket!=="Available";
  $("#bd-actions").hidden = primaryBtn.hidden;
  primaryBtn.onclick = ()=> goToView("issue", {bookId:book.id});

  $("#bd-meta").innerHTML = `
    <div class="bd-meta-item"><span class="bd-meta-k">Publication year</span><span class="bd-meta-v">${book.year==null ? "—" : (book.year<0 ? Math.abs(book.year)+" BC" : book.year)}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Category</span><span class="bd-meta-v">${esc(book.category || "—")}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Format</span><span class="bd-meta-v">${esc(book.format || "Not recorded")}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Shelf</span><span class="bd-meta-v">${esc(book.location || "—")}</span></div>
    <div class="bd-meta-item"><span class="bd-meta-k">Times borrowed</span><span class="bd-meta-v">${book.borrowCount || 0}</span></div>`;

  $("#bd-edit-link").onclick = ()=> openBookModal(book.id);
  $("#bd-remove-link").onclick = ()=> confirmDeleteBook(book.id);

  const related = BOOKS.filter(b=> b.id!==book.id && b.category && b.category===book.category).slice(0,6);
  $("#bd-related-section").hidden = related.length===0;
  renderBookRow("bd-related-grid", related);

  const rv = recentlyViewedIds.filter(x=>x!==book.id).map(findBook).filter(Boolean).slice(0,6);
  $("#bd-recent-section").hidden = rv.length===0;
  renderBookRow("bd-recent-grid", rv);

  revealStagger($all(".book-details-layout, .related-books-section, .recently-viewed-section", root),{y:14, stagger:0.06});
  window.scrollTo({top:0, behavior:"instant"});
}

function wireRowActions(root, kind){
  root.querySelectorAll("[data-act]").forEach(btn=>{
    btn.addEventListener("click", e=>{
      e.stopPropagation();
      const id = btn.closest("[data-id]").dataset.id;
      const act = btn.dataset.act;
      if(kind==="book"){
        if(act==="view") openBookModal(id, {readonly:true});
        if(act==="edit") openBookModal(id);
        if(act==="delete") confirmDeleteBook(id);
      } else {
        if(act==="view") openUserModal(id, {readonly:true});
        if(act==="edit") openUserModal(id);
        if(act==="delete") confirmDeleteUser(id);
      }
    });
  });
  root.querySelectorAll("[data-id]").forEach(row=>{
    const id = row.dataset.id;
    row.addEventListener("click", ()=>{
      kind==="book" ? openBookModal(id,{readonly:true}) : openUserModal(id,{readonly:true});
    });
    row.addEventListener("keypress", e=>{
      if(e.target !== row) return;
      if(e.key==="Enter"){ kind==="book" ? openBookModal(id,{readonly:true}) : openUserModal(id,{readonly:true}); }
    });
  });
}

/* ---------- Book modal (add / edit / view) ---------- */
function bookFormTemplate(book, readonly){
  const b = book || {title:"",author:"",category:CATEGORIES[0],year:"",location:"",description:"",format:"",cover:""};
  const dis = readonly ? "disabled" : "";
  const uncategorized = book && !CATEGORIES.includes(book.category) ? `<option value="" selected>Uncategorized</option>` : "";
  return `
    <div class="form-grid">
      <div class="field full"><label for="f-title">Title</label><input id="f-title" type="text" value="${esc(b.title)}" ${dis} required><div class="err"></div></div>
      <div class="field"><label for="f-author">Author</label><input id="f-author" type="text" value="${esc(b.author)}" ${dis} required><div class="err"></div></div>
      <div class="field"><label for="f-category">Category</label>
        <select id="f-category" ${dis}>${uncategorized}${CATEGORIES.map(c=>`<option ${c===b.category?"selected":""}>${c}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-year">Publication Year</label><input id="f-year" type="number" value="${b.year ?? ""}" ${dis}><div class="err"></div></div>
      <div class="field"><label for="f-location">Shelf / Location</label><input id="f-location" type="text" value="${esc(b.location)}" placeholder="e.g. A-12" ${dis} required><div class="err"></div></div>
      <div class="field full"><label for="f-format">Format</label>
        <select id="f-format" ${dis}><option value="">Not recorded</option>${FORMATS.map(f=>`<option ${f===b.format?"selected":""}>${f}</option>`).join("")}</select>
      </div>
      <div class="field full"><label for="f-description">Description</label><textarea id="f-description" rows="3" ${dis}>${esc(b.description)}</textarea><div class="hint">Optional. Leave blank if there is none.</div></div>
      <div class="field full"><label for="f-cover">Cover image URL</label><input id="f-cover" type="url" value="${esc(b.cover)}" placeholder="https://…" ${dis}><div class="hint">Optional. Must start with http:// or https://.</div><div class="err">Enter a full http(s) image address.</div></div>
      ${book ? `<div class="field"><label for="f-status-ro">Status</label><input id="f-status-ro" type="text" value="${esc(book.status)}" disabled></div>
      <div class="field"><label for="f-bookid">Book ID</label><input id="f-bookid" type="text" value="${esc(book.id)}" disabled></div>` : ""}
    </div>`;
}

function openBookModal(id, opts={}){
  const book = id ? findBook(id) : null;
  const readonly = !!opts.readonly;
  const title = readonly ? "Book Details" : (book ? "Edit Book" : "Add Book");
  const eyebrow = readonly ? "Catalog Record" : (book ? "Module 01 · Edit" : "Module 01 · New Entry");
  const bodyHtml = bookFormTemplate(book, readonly);
  const footHtml = readonly
    ? `<button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" id="modal-to-edit">Edit This Record</button>`
    : `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="modal-save-book">${book?"Save Changes":"Add Book"}</button>`;

  renderModal({title, eyebrow, bodyHtml, footHtml, size:"" , onMount:(modalEl)=>{
    wireFieldFocus(modalEl);
    if(readonly){
      $("#modal-to-edit", modalEl).addEventListener("click", ()=>{
        closeModal(()=> openBookModal(id));
      });
    } else {
      $("#modal-save-book", modalEl).addEventListener("click", ()=> saveBookForm(modalEl, book));
    }
  }});
}

async function saveBookForm(modalEl, existing){
  const vals = {
    title: $("#f-title",modalEl).value.trim(),
    author: $("#f-author",modalEl).value.trim(),
    category: $("#f-category",modalEl).value,
    year: parseInt($("#f-year",modalEl).value,10),
    location: $("#f-location",modalEl).value.trim(),
    format: $("#f-format",modalEl).value,
    description: $("#f-description",modalEl).value.trim(),
    cover: $("#f-cover",modalEl).value.trim(),
  };
  if (!Number.isFinite(vals.year)) vals.year = null;
  let firstBad = null;
  const flag = (id, msg)=>{ const el = $("#"+id, modalEl); setFieldError(el, msg); firstBad = firstBad || el; };
  ["f-title","f-author","f-location","f-cover","f-year"].forEach(id=> clearFieldError($("#"+id, modalEl)));
  if(!vals.title) flag("f-title","Enter the title.");
  if(!vals.author) flag("f-author","Enter the author.");
  if(!vals.location) flag("f-location","Enter the shelf location.");
  if(vals.cover && !/^https?:\/\//i.test(vals.cover)) flag("f-cover","Enter a full http(s) image address.");
  if(firstBad){ shakeModal(modalEl); firstBad.focus(); return; }

  try {
    let res;
    if(existing){
      res = await api("books.php?id=" + encodeURIComponent(existing.id), {
        method:"PUT",
        body: JSON.stringify(vals),
      });
      showToast(`“${vals.title}” updated successfully.`);
    } else {
      res = await api("books.php", {
        method:"POST",
        body: JSON.stringify({ ...vals, status:"Available" }),
      });
      showToast("Book added successfully.");
    }
    if (res && res.book) upsertById(BOOKS, mapBook(res.book)); else await refreshBooks();
    closeModal(()=>{ renderBooks(); renderDashboard(); });
  } catch (err) {
    if(!showServerFieldErrors(modalEl, err, BOOK_FIELD_IDS)) showToast(err.message, {kind:"error"});
  }
}

function confirmDeleteBook(id){
  const book = findBook(id);
  const run = async ()=>{
    try {
      await api("books.php?id=" + encodeURIComponent(id), { method:"DELETE" });
      BOOKS = BOOKS.filter(b=>b.id!==id);
      if(state.currentView==="book-details" && state.selectedBookId===id){
        goToView("books", {force:true});
      } else {
        renderBooks();
        renderDashboard();
      }
      showToast("Book removed from the catalog.", {warn:true});
    } catch (err) {
      showToast(err.message, {kind:"error"});
    }
  };
  if(!CONFIG.confirmDeletes){ run(); return; }
  renderConfirm({
    title:"Remove this book?",
    body:`Remove “${book.title}” from the catalog? This cannot be undone.`,
    confirmLabel:"Remove",
    onConfirm:run,
  });
}


/* ==================================================================
   USERS MODULE
   ================================================================== */
function getFilteredUsers(){
  const {search, filter, sort} = state.users;
  let list = USERS.filter(u=>{
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || userNameMatches(u, q) || [u.id,u.studentNumber,u.program,u.contact].some(v=>String(v ?? "").toLowerCase().includes(q));
    const matchesFilter = filter==="all" || u.status===filter;
    return matchesSearch && matchesFilter;
  });
  list.sort((a,b)=>{
    if(sort==="name-asc") return a.name.localeCompare(b.name);
    if(sort==="name-desc") return b.name.localeCompare(a.name);
    if(sort==="books-desc") return b.borrowedBookIds.length - a.borrowedBookIds.length;
    return 0;
  });
  return list;
}

function renderUsers(){
  const filtered = getFilteredUsers();
  const usersSig = JSON.stringify([state.users.search, state.users.filter, state.users.sort]);
  if(usersSig !== state.usersSig || !state.usersLimit){ state.usersSig = usersSig; state.usersLimit = CONFIG.pageSize || 25; }
  const list = filtered.slice(0, state.usersLimit);
  const usersMore = $("#users-more-wrap");
  usersMore.hidden = list.length >= filtered.length;
  $("#users-count-sub").textContent = `${USERS.length} registered user${USERS.length===1?"":"s"} · ${filtered.length} matching · showing ${list.length}`;
  const tbody = $("#users-tbody");
  const cardList = $("#users-card-list");
  const empty = $("#users-empty");

  if(list.length===0){
    tbody.innerHTML=""; cardList.innerHTML=""; empty.style.display="block";
    return;
  }
  empty.style.display="none";

  tbody.innerHTML = list.map(u=>`
    <tr data-id="${esc(u.id)}" tabindex="0">
      <td class="cell-mono">${esc(u.studentNumber || "—")}<div class="cell-sub">Library ID: ${esc(u.id)}</div></td>
      <td>
        <div class="cell-primary">${esc(u.name)}</div>
        <div class="cell-sub">${esc(u.contact)}</div>
      </td>
      <td>${esc(u.program)}</td>
      <td>${esc(u.yearLevel ?? "—")}</td>
      <td>${u.borrowedBookIds.length}</td>
      <td><span class="badge ${badgeClassFor(u.status)}">${esc(u.status)}</span></td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-act="view" title="View details" aria-label="View ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn" data-act="edit" title="Edit user" aria-label="Edit ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn" data-act="delete" title="Remove user" aria-label="Remove ${esc(u.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("");

  cardList.innerHTML = list.map(u=>`
    <div class="record-card" data-id="${esc(u.id)}" tabindex="0">
      <div class="rc-top">
        <div><div class="rc-title">${esc(u.name)}</div><div class="rc-sub">${esc(u.program || "—")} &middot; Yr ${esc(u.yearLevel ?? "—")}</div></div>
        <span class="badge ${badgeClassFor(u.status)}">${esc(u.status)}</span>
      </div>
      <div class="rc-meta"><span><b>${esc(u.id)}</b></span><span>${u.borrowedBookIds.length} book(s) out</span></div>
      <div class="rc-actions">
        <button class="btn btn-secondary btn-sm" data-act="view">View</button>
        <button class="btn btn-secondary btn-sm" data-act="edit">Edit</button>
        <button class="btn btn-danger btn-sm" data-act="delete">Delete</button>
      </div>
    </div>`).join("");

  gsap.from($all("tbody tr", tbody),{opacity:0, y:10, duration:0.35, stagger:0.03, ease:"power2.out", clearProps:"opacity,transform"});
  gsap.from($all(".record-card", cardList),{opacity:0, y:10, duration:0.35, stagger:0.03, ease:"power2.out", clearProps:"opacity,transform"});

  wireRowActions(tbody, "user");
  wireRowActions(cardList, "user");
}

$("#users-more").addEventListener("click", ()=>{ state.usersLimit += CONFIG.pageSize || 25; renderUsers(); });
$("#books-more").addEventListener("click", ()=>{ state.booksLimit += 48; renderBooks(); });
const renderUsersSoon = debounce(()=>renderUsers(), 150);
$("#users-search").addEventListener("input", e=>{ state.users.search = e.target.value; renderUsersSoon(); });
$("#users-sort").addEventListener("change", e=>{ state.users.sort = e.target.value; renderUsers(); });
$all("#users-filter-chips .chip").forEach(chip=>{
  chip.addEventListener("click", ()=>{
    $all("#users-filter-chips .chip").forEach(c=>{ c.classList.remove("active"); c.setAttribute("aria-pressed","false"); });
    chip.classList.add("active");
    chip.setAttribute("aria-pressed","true");
    state.users.filter = chip.dataset.filter;
    renderUsers();
  });
});
$("#open-add-user").addEventListener("click", ()=>openUserModal(null));

const PROGRAMS = ["BSIT","BS Architecture","BS Psychology","BS Civil Engineering","BS Nursing","BS Biology","BS Accountancy"];

function userFormTemplate(user, readonly){
  const u = user || {lastName:"",firstName:"",middleInitial:"",program:PROGRAMS[0],yearLevel:1,studentNumber:"",contact:""};
  const dis = readonly ? "disabled" : "";
  return `
    <div class="form-grid">
      <div class="name-row">
        <div class="field"><label for="f-lastname">Last Name</label><input id="f-lastname" type="text" value="${esc(u.lastName)}" ${dis} required><div class="err"></div></div>
        <div class="field"><label for="f-firstname">First Name</label><input id="f-firstname" type="text" value="${esc(u.firstName)}" ${dis} required><div class="err"></div></div>
        <div class="field"><label for="f-middleinitial">Middle Initial</label><input id="f-middleinitial" type="text" value="${esc(u.middleInitial)}" maxlength="1" autocomplete="off" ${readonly ? "" : 'placeholder="(Optional)"'} ${dis}></div>
      </div>
      <div class="field"><label for="f-program">Course / Program</label>
        <select id="f-program" ${dis}>${user && !u.program ? `<option value="" selected>Not specified</option>` : ""}${(user && u.program && !PROGRAMS.includes(u.program) ? [u.program, ...PROGRAMS] : PROGRAMS).map(p=>`<option ${p===u.program?"selected":""}>${esc(p)}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-yearlevel">Year Level</label>
        <select id="f-yearlevel" ${dis}>${user && u.yearLevel==null ? `<option value="" selected>Not specified</option>` : ""}${[1,2,3,4,5].map(y=>`<option value="${y}" ${y===u.yearLevel?"selected":""}>Year ${y}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-studentnumber">Student Number</label><input id="f-studentnumber" type="text" value="${esc(u.studentNumber || "")}" maxlength="50" placeholder="Enter official student number" ${dis} ${user ? "" : "required"}><div class="err"></div></div>
      <div class="field full"><label for="f-contact">Contact Information</label><input id="f-contact" type="email" value="${esc(u.contact)}" placeholder="name@feuroosevelt.edu" ${dis} required><div class="err"></div></div>
      ${user ? `
      <div class="field"><label for="f-status">Account Status</label>${readonly
        ? `<input id="f-status" type="text" value="${esc(user.status)}" disabled>`
        : `<select id="f-status">${["Active","Inactive"].map(st=>`<option ${st===user.status?"selected":""}>${st}</option>`).join("")}</select>`}</div>
      <div class="field"><label for="f-userid">Library ID</label><input id="f-userid" type="text" value="${esc(user.id)}" disabled></div>
      <div class="field full"><label for="f-hold">Borrowing Status</label>
        <input id="f-hold" type="text" value="${esc(holdReason(user) ? "Blocked: " + [user.overdueLoans>0 ? user.overdueLoans+" overdue book"+(user.overdueLoans===1?"":"s") : "", user.unpaidFines>0 ? "unpaid fines "+peso(user.unpaidFines) : ""].filter(Boolean).join(" · ") : "Can borrow")}" disabled>
        ${user.unpaidFines>0 ? `<button type="button" class="btn btn-secondary btn-sm" id="f-settle-fines" style="margin-top:8px;">Record payment of ${esc(peso(user.unpaidFines))}</button>` : ""}</div>
      <div class="field full"><label for="f-borrowed">Currently Borrowed</label>
        <input id="f-borrowed" type="text" value="${esc(user.borrowedBookIds.length ? user.borrowedBookIds.map(id=>(findBook(id)||{}).title).filter(Boolean).join(', ') : 'None')}" disabled></div>
      ` : ""}
    </div>`;
}

function openUserModal(id, opts={}){
  const user = id ? findUser(id) : null;
  const readonly = !!opts.readonly;
  const title = readonly ? "User Details" : (user ? "Edit User" : "Add User");
  const eyebrow = readonly ? "Patron Record" : (user ? "Module 02 · Edit" : "Module 02 · New Entry");
  const bodyHtml = userFormTemplate(user, readonly);
  const footHtml = readonly
    ? `<button class="btn btn-secondary" data-close>Close</button><button class="btn btn-primary" id="modal-to-edit">Edit This Record</button>`
    : `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="modal-save-user">${user?"Save Changes":"Register User"}</button>`;

  renderModal({title, eyebrow, bodyHtml, footHtml, onMount:(modalEl)=>{
    wireFieldFocus(modalEl);
    $("#f-settle-fines", modalEl)?.addEventListener("click", ()=> settleFines(user, readonly));
    if(readonly){
      $("#modal-to-edit", modalEl).addEventListener("click", ()=>{
        closeModal(()=> openUserModal(id));
      });
    } else {
      $("#modal-save-user", modalEl).addEventListener("click", ()=> saveUserForm(modalEl, user));
    }
  }});
}

/* Records that the patron paid every outstanding fine. The server works out the amount itself. */
function settleFines(user, readonly){
  renderConfirm({
    title:"Record payment?",
    body:`Mark ${peso(user.unpaidFines)} in fines as paid by ${user.name}? Only do this after the money has been received.`,
    confirmLabel:"Mark as paid",
    onConfirm: async ()=>{
      try {
        const res = await api("transactions.php", { method:"POST", body: JSON.stringify({ type:"pay_fine", userId:user.id }) });
        await refreshUser(user.id);
        showToast(`Recorded ${peso(res.amount)} as paid.`);
        closeModal(()=>{ renderUsers(); openUserModal(user.id, {readonly}); });
      } catch (err) {
        showToast(err.message, {kind:"error"});
      }
    },
  });
}

async function saveUserForm(modalEl, existing){
  const vals = {
    lastName: $("#f-lastname",modalEl).value.trim().replace(/\s+/g," "),
    firstName: $("#f-firstname",modalEl).value.trim().replace(/\s+/g," "),
    middleInitial: $("#f-middleinitial",modalEl).value.replace(/[^A-Za-z]/g,"").charAt(0).toUpperCase(),
    program: $("#f-program",modalEl).value,
    yearLevel: parseInt($("#f-yearlevel",modalEl).value,10),
    studentNumber: $("#f-studentnumber",modalEl).value.trim(),
    contact: $("#f-contact",modalEl).value.trim(),
  };
  vals.name = formatUserName(vals.lastName, vals.firstName, vals.middleInitial);
  const statusEl = $("#f-status",modalEl);
  if(statusEl) vals.status = statusEl.value;
  let firstBad = null;
  const flag = (id, msg)=>{ const el = $("#"+id, modalEl); setFieldError(el, msg); firstBad = firstBad || el; };
  ["f-lastname","f-firstname","f-studentnumber","f-contact"].forEach(id=> clearFieldError($("#"+id, modalEl)));
  if(!vals.lastName) flag("f-lastname","Enter the last name.");
  if(!vals.firstName) flag("f-firstname","Enter the first name.");
  if(!existing && !vals.studentNumber) flag("f-studentnumber","Enter the student number.");
  else if(vals.studentNumber && !/^[A-Za-z0-9][A-Za-z0-9.\/_-]{1,49}$/.test(vals.studentNumber)) flag("f-studentnumber","Use 2–50 letters, numbers, dots, slashes or dashes.");
  if(!vals.contact) flag("f-contact","Enter an email address.");
  else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.contact)) flag("f-contact","Enter a valid email address.");
  if(firstBad){ shakeModal(modalEl); firstBad.focus(); return; }

  try {
    let res;
    if(existing){
      res = await api("users.php?id=" + encodeURIComponent(existing.id), { method:"PUT", body: JSON.stringify(vals) });
      showToast(`${vals.name}’s record updated.`);
    } else {
      res = await api("users.php", { method:"POST", body: JSON.stringify({ ...vals, status:"Active" }) });
      showToast("User registered successfully.");
    }
    if (res && res.user) upsertById(USERS, mapUser(res.user)); else await refreshUsers();
    closeModal(()=>{ renderUsers(); renderDashboard(); });
  } catch (err) {
    if(!showServerFieldErrors(modalEl, err, USER_FIELD_IDS)) showToast(err.message, {kind:"error"});
  }
}

function confirmDeleteUser(id){
  const user = findUser(id);
  if(!user) return;
  if(user.borrowedBookIds.length){
    showToast("Can't remove a patron with active loans.", {warn:true});
    return;
  }
  const run = async ()=>{
    try {
      await api("users.php?id=" + encodeURIComponent(id), { method:"DELETE" });
      USERS = USERS.filter(u=>u.id!==id);
      renderUsers();
      renderDashboard();
      showToast("User removed from records.", {warn:true});
    } catch (err) {
      showToast(err.message, {kind:"error"});
    }
  };
  if(!CONFIG.confirmDeletes){ run(); return; }
  renderConfirm({
    title:"Remove this user?",
    body:`Remove “${user.name}” from the library records? This cannot be undone.`,
    confirmLabel:"Remove",
    onConfirm:run,
  });
}


/* ==================================================================
   GENERIC MODAL ENGINE
   ================================================================== */
let activeModalCloseFn = null;
let scrollLockCount = 0;
function lockScroll(){ scrollLockCount++; document.body.style.overflow = "hidden"; $("#app")?.setAttribute("inert",""); }
function unlockScroll(){
  scrollLockCount = Math.max(0, scrollLockCount-1);
  if(scrollLockCount===0){ document.body.style.overflow = ""; $("#app")?.removeAttribute("inert"); }
}
function restoreFocus(el){ if(el && el.isConnected && typeof el.focus === "function") el.focus(); }

function renderModal({title, eyebrow, bodyHtml, footHtml, size, onMount}){
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="active-modal-backdrop">
      <div class="modal ${size||''}" role="dialog" aria-modal="true" aria-labelledby="active-modal-title">
        <div class="modal-head">
          <div>
            ${eyebrow ? `<div class="mh-eyebrow">${esc(eyebrow)}</div>` : ""}
            <h3 id="active-modal-title">${esc(title)}</h3>
          </div>
          <button class="modal-close" data-close aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
      </div>
    </div>`;
  const backdrop = $("#active-modal-backdrop", root);
  const modalEl = $(".modal", backdrop);
  const opener = document.activeElement;

  function doClose(after){
    closeModalEl(backdrop, modalEl, ()=>{ root.innerHTML=""; document.removeEventListener("keydown", escHandler); dialogKeyHandlers.delete(escHandler); unlockScroll(); restoreFocus(opener); if(after) after(); });
  }
  activeModalCloseFn = doClose;

  backdrop.addEventListener("click", e=>{ if(e.target===backdrop) doClose(); });
  $all("[data-close]", backdrop).forEach(b=> b.addEventListener("click", ()=>doClose()));
  function escHandler(e){ if(e.key==="Escape") doClose(); else trapTab(e, modalEl); }
  document.addEventListener("keydown", escHandler);
  dialogKeyHandlers.add(escHandler);

  lockScroll();
  const firstInput = modalEl.querySelector(".modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])") || modalEl.querySelector("button");
  openModalEl(backdrop, modalEl, ()=> firstInput?.focus());
  if(onMount) onMount(modalEl);
}
function closeModal(after){ if(activeModalCloseFn) activeModalCloseFn(after); }
function shakeModal(modalEl){
  gsap.fromTo(modalEl,{x:-8},{x:0, duration:0.06, repeat:5, yoyo:true, ease:"power1.inOut"});
}

/* ---------- Confirmation dialog ---------- */
function renderConfirm({title, body, confirmLabel, onConfirm}){
  const root = $("#confirm-root");
  root.innerHTML = `
    <div class="modal-backdrop confirm-backdrop" id="active-confirm-backdrop">
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="modal-body" style="padding-top:24px;">
          <div class="cm-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18.3A1.6 1.6 0 0 0 3.3 20.7h17.4a1.6 1.6 0 0 0 1.4-2.4L13.7 3.9a1.6 1.6 0 0 0-3.4 0z"/></svg></div>
          <h3 id="confirm-title" style="font-family:var(--font-display); font-size:18px; margin-bottom:8px;">${esc(title)}</h3>
          <p>${esc(body)}</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" data-close>Cancel</button>
          <button class="btn btn-danger-solid" id="confirm-btn">${esc(confirmLabel||"Confirm")}</button>
        </div>
      </div>
    </div>`;
  const backdrop = $("#active-confirm-backdrop", root);
  const modalEl = $(".modal", backdrop);
  const opener = document.activeElement;
  function doClose(after){
    closeModalEl(backdrop, modalEl, ()=>{ root.innerHTML=""; document.removeEventListener("keydown", escHandler); dialogKeyHandlers.delete(escHandler); unlockScroll(); restoreFocus(opener); if(after) after(); });
  }
  backdrop.addEventListener("click", e=>{ if(e.target===backdrop) doClose(); });
  $all("[data-close]", backdrop).forEach(b=> b.addEventListener("click", ()=>doClose()));
  function escHandler(e){ if(e.key==="Escape") doClose(); else trapTab(e, modalEl); }
  document.addEventListener("keydown", escHandler);
  dialogKeyHandlers.add(escHandler);
  $("#confirm-btn", backdrop).addEventListener("click", ()=>{ doClose(); onConfirm(); });
  lockScroll();
  openModalEl(backdrop, modalEl, ()=> $("#confirm-btn", backdrop)?.focus());
}


/* ==================================================================
   ISSUE BOOK: "desk mode". Student and book are picked on one screen (everything works from the keyboard)
   and the loan is confirmed in the bar underneath. Each loan is still ONE request to api/transactions.php:
   the server alone decides eligibility, availability, loan limit, dates and audit logging. The checks shown
   on this screen (blocked students, titles on loan) only save staff a request that would be refused.
   ================================================================== */
const ISSUE_ROW_CAP = 50;      // rows drawn per list; searching narrows the rest
const issueLog = [];           // loans issued in this browser session, newest first
let issueCount = 0;
const issueUi = { sIdx:0, bIdx:0, busy:false, failed:false, sRows:[], bRows:[] };
let issueListRefreshBusy = false;

async function refreshIssueStudentData(){
  if(issueListRefreshBusy) return;
  issueListRefreshBusy = true;
  try {
    await Promise.all([refreshUsers(), refreshBooks()]);
    if(state.currentView === "issue") renderIssueStudentList();
  } catch(e) {
    // Keep the current list usable if a background refresh fails; checkout is still server-validated.
  } finally {
    issueListRefreshBusy = false;
  }
}

/* Why a student cannot borrow right now ("" when they can). Mirrors the server rules; the server has the last word. */
function issueBlockReason(u){
  const why = holdReason(u);
  if(why) return why;
  const max = CONFIG.maxBooksPerUser || 5;
  return u.borrowedBookIds.length >= max ? `Loan limit reached (${u.borrowedBookIds.length} of ${max})` : "";
}
function issueBlockHint(u){
  if(u.overdueLoans > 0) return "The overdue book must be returned first.";
  if(u.unpaidFines > 0) return "Record the payment on the student's record (Users) first.";
  return "A book must be returned before another can be issued.";
}
function resetIssueDates(){
  const issueInput = $("#issue-date");
  issueInput.value = isoDaysAgo(0);
  issueInput.readOnly = true;
  issueInput.title = "The issue date is always today and is set by the server.";
  const dueInput = $("#issue-due-date");
  dueInput.min = isoDaysAgo(0);
  dueInput.max = isoDaysFromNow(CONFIG.loanDays);
  dueInput.value = dueInput.max;
}
function resetIssueWizard(preBookId){
  const pre = preBookId ? findBook(preBookId) : null;
  state.issue = { studentId:null, bookId: pre && pre.status==="Available" ? pre.id : null, sq:"", bq:"", availOnly:true, requestedOnly:false, keep:true };
  Object.assign(issueUi, { sIdx:0, bIdx:0, busy:false, failed:false });
  resetIssueDates();
  $("#issue-student-search").value = "";
  $("#issue-book-search").value = "";
  $("#issue-book-search").placeholder = "Title, author, subject or shelf…";
  $("#issue-keep").checked = true;
  $("#issue-avail").setAttribute("aria-pressed", "true");
  $("#issue-avail").classList.add("active");
  const requestedChip = $("#issue-requested");
  if(requestedChip){
    requestedChip.setAttribute("aria-pressed", "false");
    requestedChip.classList.remove("active");
  }
  $("#issue-error").hidden = true;
  $("#issue-result").hidden = true;
  $("#issue-student-msg").textContent = "";
  $("#issue-book-msg").textContent = "";
  renderIssue();
}

function renderIssueStudentList(scroll){
  const list = $("#issue-student-list"), input = $("#issue-student-search");
  const q = state.issue.sq.trim().toLowerCase(), max = CONFIG.maxBooksPerUser || 5;
  const all = USERS.filter(u=> u.status==="Active" && (!q || userNameMatches(u, q) || u.id.toLowerCase().includes(q) || String(u.studentNumber || "").toLowerCase().includes(q)));
  const rows = all.slice(0, ISSUE_ROW_CAP);
  issueUi.sRows = rows;
  issueUi.sIdx = Math.min(issueUi.sIdx, Math.max(0, rows.length - 1));
  list.innerHTML = rows.map((u,k)=>{
    const why = issueBlockReason(u);
    return `<div class="issue-row${k===issueUi.sIdx ? " hi" : ""}" role="option" id="issue-s-${k}" aria-selected="${k===issueUi.sIdx}"${why ? ` aria-disabled="true"` : ""} data-k="${k}">
      <span class="mini-avatar">${esc(initialsOf(u.name))}</span>
      <span class="issue-who"><span class="issue-name">${esc(u.name)}</span><small>${esc(u.studentNumber || "No student number")} &middot; Library ID ${esc(u.id)} &middot; ${esc(u.program || "—")}</small>${u.requestedBooks.length ? `<small class="issue-request-note">Requests: ${esc(u.requestedBooks.map(request=>request.title).join(", "))}</small>` : ""}</span>
      ${why ? `<span class="badge badge-overdue">${esc(why)}</span>` : u.requestedBooks.length ? `<span class="badge badge-available">${u.requestedBooks.length} request${u.requestedBooks.length===1 ? "" : "s"}</span>` : `<span class="badge badge-available">${u.borrowedBookIds.length}/${max} loans</span>`}
    </div>`;
  }).join("") + (all.length > rows.length ? `<div class="issue-empty">Showing ${rows.length} of ${all.length}. Keep typing to narrow the list.</div>` : "")
    || `<div class="issue-empty">No active student matches your search.</div>`;
  if(rows.length) input.setAttribute("aria-activedescendant", "issue-s-" + issueUi.sIdx); else input.removeAttribute("aria-activedescendant");
  if(scroll) list.querySelector(".hi")?.scrollIntoView({block:"nearest"});
}
function issueEmptyMessage(student){
  if(state.issue.requestedOnly){
    if(!student) return "Select a student to see their borrow requests.";
    if(!student.requestedBooks.length) return `${esc(student.name)} has no pending borrow requests.`;
    return `None of ${esc(student.name)}'s requested titles match${state.issue.availOnly ? ". Some may be on loan: turn off “Available only” to see them" : ""}. Try another search.`;
  }
  return `No title matches. Try another search${state.issue.availOnly ? ", or turn off “Available only”" : ""}.`;
}

function renderIssueBookList(scroll){
  const list = $("#issue-book-list"), input = $("#issue-book-search");
  const q = state.issue.bq.trim().toLowerCase();
  const student = state.issue.studentId ? findUser(state.issue.studentId) : null;
  // "Requested books only": just the titles this student has an ACTIVE borrow request for (fulfilled/cancelled ones are never listed).
  const requestedIds = state.issue.requestedOnly ? new Set((student?.requestedBooks || []).map(request=>request.id)) : null;
  const all = BOOKS.filter(b=> (!requestedIds || requestedIds.has(b.id))
    && (!state.issue.availOnly || b.status==="Available")
    && (!q || [b.title, b.author, b.category, b.location].some(v=> String(v ?? "").toLowerCase().includes(q))));
  const rows = all.slice(0, ISSUE_ROW_CAP);
  issueUi.bRows = rows;
  issueUi.bIdx = Math.min(issueUi.bIdx, Math.max(0, rows.length - 1));
  list.innerHTML = rows.map((b,k)=>{
    const out = b.status !== "Available";
    return `<div class="issue-row${k===issueUi.bIdx ? " hi" : ""}" role="option" id="issue-b-${k}" aria-selected="${k===issueUi.bIdx}"${out ? ` aria-disabled="true"` : ""} data-k="${k}">
      <span class="issue-who"><span class="issue-name">${esc(b.title)}</span><small>${esc(b.author)} &middot; Shelf ${esc(b.location || "—")}</small></span>
      ${out ? `<span class="badge ${b.status==="Overdue" ? "badge-overdue" : "badge-borrowed"}">On loan${b.dueDate ? " &middot; due " + esc(fmtDate(b.dueDate)) : ""}</span>` : `<span class="badge badge-available">Available</span>`}
    </div>`;
  }).join("") + (all.length > rows.length ? `<div class="issue-empty">Showing ${rows.length} of ${all.length}. Keep typing to narrow the list.</div>` : "")
    || `<div class="issue-empty">${issueEmptyMessage(student)}</div>`;
  if(rows.length) input.setAttribute("aria-activedescendant", "issue-b-" + issueUi.bIdx); else input.removeAttribute("aria-activedescendant");
  if(scroll) list.querySelector(".hi")?.scrollIntoView({block:"nearest"});
}

function renderIssueBar(){
  const I = state.issue, student = I.studentId ? findUser(I.studentId) : null, book = I.bookId ? findBook(I.bookId) : null;
  const ready = !!(student && book), max = CONFIG.maxBooksPerUser || 5;
  $("#issue-bar").classList.toggle("ready", ready);
  const grace = CONFIG.gracePeriodDays || 0;
  const fines = CONFIG.overdueFinesEnabled ? `Fine ${peso(CONFIG.finePerDay)} per day after ${grace} grace day${grace===1 ? "" : "s"}` : "Overdue fines are off";
  $("#issue-summary").innerHTML = ready
    ? `<b>${esc(book.title)}</b> &rarr; <b>${esc(student.name)}</b><small>Loan ${student.borrowedBookIds.length + 1} of ${max} &middot; ${esc(fines)}</small>`
    : `<span class="issue-hint">${!student ? "Select a student, then a book." : "Select a book to continue."}</span><small>Nothing is issued until you confirm.</small>`;
  $("#issue-due-date").disabled = !ready;
  const btn = $("#issue-confirm-btn");
  btn.disabled = !ready || issueUi.busy;
  btn.classList.toggle("is-saving", issueUi.busy);
  btn.textContent = issueUi.busy ? "Issuing…" : issueUi.failed ? "Try again" : "Confirm & issue";
}
function renderIssueLog(){
  $("#issue-log").innerHTML = issueLog.length
    ? `<h2 class="issue-log-h">Issued this session &middot; ${issueCount}</h2>` + issueLog.map(l=>
        `<div class="issue-log-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span><b>${esc(l.title)}</b> &rarr; ${esc(l.name)}</span><small>due ${esc(fmtDate(l.due))}</small></div>`).join("")
    : "";
}
function renderIssue(){
  const I = state.issue, student = I.studentId ? findUser(I.studentId) : null, book = I.bookId ? findBook(I.bookId) : null;
  const max = CONFIG.maxBooksPerUser || 5;
  $("#issue-student-find").hidden = !!student;
  const ss = $("#issue-student-selected");
  ss.hidden = !student;
  if(student) ss.innerHTML = `<span class="mini-avatar">${esc(initialsOf(student.name))}</span><span class="issue-who"><span class="issue-name">${esc(student.name)}</span><small>${esc(student.studentNumber || "No student number")} &middot; Library ID ${esc(student.id)} &middot; ${esc(student.program || "—")} &middot; ${student.borrowedBookIds.length}/${max} loans</small></span><button type="button" class="issue-change">Change</button>`;
  $("#issue-book-find").hidden = !!book;
  const bs = $("#issue-book-selected");
  bs.hidden = !book;
  if(book) bs.innerHTML = `<span class="issue-who"><span class="issue-name">${esc(book.title)}</span><small>${esc(book.author)} &middot; Shelf ${esc(book.location || "—")}</small></span><button type="button" class="issue-change">Change</button>`;
  $("#issue-pane-student").classList.toggle("active", !student);
  $("#issue-pane-book").classList.toggle("active", !!student && !book);
  [["student", !!student, "1"], ["book", !!book, "2"]].forEach(([k, done, n])=>{
    const i = $("#issue-num-" + k);
    i.textContent = done ? "✓" : n;
    i.classList.toggle("done", done);
  });
  if(!student) renderIssueStudentList();
  if(!book) renderIssueBookList();
  renderIssueBar();
  renderIssueLog();
}

function pickIssueStudent(){
  const u = issueUi.sRows[issueUi.sIdx], msg = $("#issue-student-msg");
  if(!u) return;
  const why = issueBlockReason(u);
  if(why){ msg.textContent = `${u.name} cannot borrow: ${why.toLowerCase()}. ${issueBlockHint(u)}`; return; }
  msg.textContent = "";
  state.issue.studentId = u.id;
  state.issue.bookId = null;
  state.issue.bq = "";
  $("#issue-book-search").value = "";
  $("#issue-book-search").placeholder = "Title, author, subject or shelf…";
  issueUi.bIdx = 0;
  state.issue.availOnly = true;
  $("#issue-avail").setAttribute("aria-pressed", String(state.issue.availOnly));
  $("#issue-avail").classList.toggle("active", state.issue.availOnly);
  issueUi.failed = false;
  renderIssue();
  (state.issue.bookId ? $("#issue-confirm-btn") : $("#issue-book-search")).focus();
}
function pickIssueBook(){
  const b = issueUi.bRows[issueUi.bIdx], msg = $("#issue-book-msg");
  if(!b) return;
  if(b.status !== "Available"){ msg.textContent = `“${b.title}” is on loan${b.dueDate ? " until " + fmtDate(b.dueDate) : ""}.`; return; }
  msg.textContent = "";
  state.issue.bookId = b.id;
  issueUi.failed = false;
  renderIssue();
  (state.issue.studentId ? $("#issue-confirm-btn") : $("#issue-student-search")).focus();
}
/* Arrow keys move the highlighted row, Enter picks it, Escape clears the search box. */
function issueKeys(e, kind){
  const s = kind==="s", rows = s ? issueUi.sRows : issueUi.bRows, key = s ? "sIdx" : "bIdx";
  const redraw = ()=> s ? renderIssueStudentList(true) : renderIssueBookList(true);
  if(e.key==="ArrowDown" || e.key==="ArrowUp"){
    e.preventDefault();
    issueUi[key] = Math.max(0, Math.min(rows.length - 1, issueUi[key] + (e.key==="ArrowDown" ? 1 : -1)));
    redraw();
  } else if(e.key==="Enter" && !e.ctrlKey && !e.metaKey){
    e.preventDefault();
    s ? pickIssueStudent() : pickIssueBook();
  } else if(e.key==="Escape" && e.target.value){
    e.preventDefault();
    e.target.value = "";
    state.issue[s ? "sq" : "bq"] = "";
    issueUi[key] = 0;
    redraw();
  }
}

async function submitIssue(){
  if(issueUi.busy) return; // ignore double clicks and repeated shortcuts while a request is in flight
  const I = state.issue, student = I.studentId ? findUser(I.studentId) : null, book = I.bookId ? findBook(I.bookId) : null;
  const err = $("#issue-error");
  if(!student || !book) return;
  const why = issueBlockReason(student);
  if(why){ err.textContent = `${student.name} cannot borrow: ${why.toLowerCase()}.`; err.hidden = false; return; }
  // Only IDs and the requested due date are sent; the server sets the issue date and validates everything.
  const dueDate = $("#issue-due-date").value || undefined;
  issueUi.busy = true; issueUi.failed = false; err.hidden = true;
  renderIssueBar();
  try {
    const res = await api("transactions.php", {
      method:"POST",
      body: JSON.stringify({ type:"issue", bookId: book.id, userId: student.id, dueDate }),
    });
    const tx = res.transaction || {};
    try { await refreshAffected(book.id, student.id); }
    catch (e) { showToast("Issued, but the lists could not refresh. Reload the page.", {warn:true}); }
    I.availOnly = true;
    $("#issue-avail").setAttribute("aria-pressed", "true");
    $("#issue-avail").classList.add("active");
    const due = tx.dueDate || dueDate;
    issueLog.unshift({ title: book.title, name: student.name, due });
    if(issueLog.length > 20) issueLog.pop();
    issueCount++;
    $("#issue-final-caption").innerHTML = `<b>${esc(book.title)}</b> issued to <b>${esc(student.name)}</b>, due ${fmtDate(due)}.`;
    $("#issue-result").hidden = false;
    playStamp($("#issue-stamp"));
    showToast("Book issued successfully.");
    renderDashboard();
    // Ready for the next loan: the book is cleared; the student stays when "Keep student" is ticked.
    I.bookId = null; I.bq = ""; $("#issue-book-search").value = ""; issueUi.bIdx = 0;
    if(!I.keep){ I.studentId = null; I.sq = ""; $("#issue-student-search").value = ""; issueUi.sIdx = 0; }
    resetIssueDates();
    $("#issue-student-msg").textContent = ""; $("#issue-book-msg").textContent = "";
    issueUi.busy = false;
    renderIssue();
    (I.studentId ? $("#issue-book-search") : $("#issue-student-search")).focus();
  } catch (e) {
    issueUi.busy = false; issueUi.failed = true;
    err.textContent = e.message; err.hidden = false;
    renderIssueBar();
  }
}

$("#issue-student-search").addEventListener("input", e=>{ state.issue.sq = e.target.value; issueUi.sIdx = 0; renderIssueStudentList(); });
$("#issue-book-search").addEventListener("input", e=>{ state.issue.bq = e.target.value; issueUi.bIdx = 0; renderIssueBookList(); });
$("#issue-student-search").addEventListener("keydown", e=> issueKeys(e, "s"));
$("#issue-book-search").addEventListener("keydown", e=> issueKeys(e, "b"));
$("#issue-student-list").addEventListener("click", e=>{
  const row = e.target.closest(".issue-row");
  if(row && row.dataset.k !== undefined){ issueUi.sIdx = +row.dataset.k; pickIssueStudent(); }
});
$("#issue-book-list").addEventListener("click", e=>{
  const row = e.target.closest(".issue-row");
  if(row && row.dataset.k !== undefined){ issueUi.bIdx = +row.dataset.k; pickIssueBook(); }
});
$("#issue-student-selected").addEventListener("click", e=>{
  if(!e.target.closest(".issue-change")) return;
  state.issue.studentId = null; state.issue.sq = ""; $("#issue-student-search").value = ""; issueUi.sIdx = 0; issueUi.failed = false;
  state.issue.availOnly = true; $("#issue-avail").setAttribute("aria-pressed", "true"); $("#issue-avail").classList.add("active");
  $("#issue-book-search").placeholder = "Title, author, subject or shelf…";
  renderIssue(); $("#issue-student-search").focus();
});
$("#issue-book-selected").addEventListener("click", e=>{
  if(!e.target.closest(".issue-change")) return;
  state.issue.bookId = null; state.issue.bq = ""; $("#issue-book-search").value = ""; issueUi.bIdx = 0; issueUi.failed = false;
  renderIssue(); $("#issue-book-search").focus();
});
$("#issue-avail").addEventListener("click", ()=>{
  state.issue.availOnly = !state.issue.availOnly;
  $("#issue-avail").setAttribute("aria-pressed", String(state.issue.availOnly));
  $("#issue-avail").classList.toggle("active", state.issue.availOnly);
  issueUi.bIdx = 0; renderIssueBookList();
});
// The chip lives in the Issue page markup; if that markup is older, the script still starts normally.
$("#issue-requested")?.addEventListener("click", (event)=>{
  state.issue.requestedOnly = !state.issue.requestedOnly;
  event.currentTarget.setAttribute("aria-pressed", String(state.issue.requestedOnly));
  event.currentTarget.classList.toggle("active", state.issue.requestedOnly);
  issueUi.bIdx = 0; renderIssueBookList();
});
$("#issue-keep").addEventListener("change", e=>{ state.issue.keep = e.target.checked; });
$("#issue-due-date").addEventListener("change", ()=>{ $("#issue-error").hidden = true; issueUi.failed = false; renderIssueBar(); });
$("#issue-confirm-btn").addEventListener("click", submitIssue);
window.setInterval(()=>{
  if(state.currentView === "issue" && !document.hidden) refreshIssueStudentData();
}, 15000);
/* Ctrl+Enter (or Cmd+Enter) confirms from anywhere on this screen once a student and a book are chosen. */
document.addEventListener("keydown", e=>{
  if(e.key!=="Enter" || !(e.ctrlKey || e.metaKey) || state.currentView!=="issue" || scrollLockCount>0) return;
  if(getComputedStyle($("#app")).visibility === "hidden") return; // sign-in screen
  const btn = $("#issue-confirm-btn");
  if(btn && !btn.disabled){ e.preventDefault(); submitIssue(); }
});

/* ==================================================================
   RETURN BOOK: same desk layout as Issue. Search open loans, review
   dates and the estimated fine, then confirm. The server still computes
   the real fine and updates the loan; nothing is returned until confirm.
   ================================================================== */
const RETURN_ROW_CAP = 50;
const returnLog = [];
let returnCount = 0;
const returnUi = { idx:0, busy:false, failed:false, renewing:false, rows:[] };

function resetReturnWizard(){
  state.ret = { bookId:null, q:"", returnDate:null, fine:0, overdueDays:0 };
  Object.assign(returnUi, { idx:0, busy:false, failed:false, renewing:false });
  $("#return-search").value = "";
  $("#return-loan-msg").textContent = "";
  $("#return-error").hidden = true;
  $("#return-result").hidden = true;
  const rd = $("#return-date-input");
  rd.value = isoDaysAgo(0);
  rd.max = isoDaysAgo(0);
  rd.min = "";
  renderReturn();
}

function openLoansMatching(q){
  q = q.trim().toLowerCase();
  return BOOKS.filter(b=> (b.status==="Borrowed"||b.status==="Overdue") &&
    (!q || b.title.toLowerCase().includes(q) || userNameMatches(findUser(b.borrowedBy), q)));
}

function renderReturnLoanList(scroll){
  const list = $("#return-loan-list"), input = $("#return-search");
  const all = openLoansMatching(state.ret.q);
  const hasOpenLoans = BOOKS.some(b=>b.status==="Borrowed"||b.status==="Overdue");
  const rows = all.slice(0, RETURN_ROW_CAP);
  returnUi.rows = rows;
  returnUi.idx = Math.min(returnUi.idx, Math.max(0, rows.length - 1));
  list.innerHTML = rows.map((b,k)=>{
    const u = findUser(b.borrowedBy);
    return `<div class="issue-row${k===returnUi.idx ? " hi" : ""}" role="option" id="return-l-${k}" aria-selected="${k===returnUi.idx}" data-k="${k}">
      <span class="issue-who"><span class="issue-name">${esc(b.title)}</span><small>${esc(u?u.name:"—")} &middot; due ${esc(fmtDate(b.dueDate))}</small></span>
      <span class="badge ${badgeClassFor(b.status)}">${esc(b.status)}</span>
    </div>`;
  }).join("") + (all.length > rows.length ? `<div class="issue-empty">Showing ${rows.length} of ${all.length}. Keep typing to narrow the list.</div>` : "")
    || `<div class="issue-empty">${hasOpenLoans
      ? "No borrowed titles match your search."
      : "No books are currently borrowed. Issue a book first; active loans will appear here."}</div>`;
  if(rows.length) input.setAttribute("aria-activedescendant", "return-l-" + returnUi.idx); else input.removeAttribute("aria-activedescendant");
  if(scroll) list.querySelector(".hi")?.scrollIntoView({block:"nearest"});
}

function renderReturnDetails(){
  const b = state.ret.bookId ? findBook(state.ret.bookId) : null;
  const empty = $("#return-details-empty"), body = $("#return-details-body");
  empty.hidden = !!b;
  body.hidden = !b;
  if(!b) return;
  const u = findUser(b.borrowedBy) || {name:b.borrowedBy || "Unknown patron", id:b.borrowedBy || "—", program:"—"};
  $("#return-facts").innerHTML = `
    <div class="return-fact">
      <span class="return-fact-label">Book</span>
      <div class="issue-sel">
        <span class="issue-who"><span class="issue-name">${esc(b.title)}</span><small>${esc(b.author || "—")} &middot; Shelf ${esc(b.location || "—")} &middot; ${esc(b.category || "—")}</small></span>
        <span class="badge ${badgeClassFor(b.status)}">${esc(b.status)}</span>
      </div>
    </div>
    <div class="return-fact">
      <span class="return-fact-label">Borrower</span>
      <div class="issue-sel">
        <span class="mini-avatar">${esc(initialsOf(u.name))}</span>
        <span class="issue-who"><span class="issue-name">${esc(u.name)}</span><small>${esc(u.id)} &middot; ${esc(u.program || "—")}</small></span>
      </div>
    </div>`;
  $("#return-issue-date-display").value = fmtDate(b.issueDate);
  $("#return-due-date-display").value = fmtDate(b.dueDate);
}

function renderReturnBar(){
  const b = state.ret.bookId ? findBook(state.ret.bookId) : null;
  const u = b ? findUser(b.borrowedBy) : null;
  const ready = !!(b && (b.status==="Borrowed" || b.status==="Overdue"));
  $("#return-bar").classList.toggle("ready", ready);
  const fineNote = ready
    ? (state.ret.fine > 0 ? `Estimated fine ${peso(state.ret.fine)} (assessed on return)` : "No fine estimated")
    : "Nothing is returned until you confirm.";
  $("#return-summary").innerHTML = ready
    ? `<b>${esc(b.title)}</b> &larr; <b>${esc(u ? u.name : (b.borrowedBy || "—"))}</b><small>${esc(fineNote)}</small>`
    : `<span class="issue-hint">Select a borrowed title to continue.</span><small>${esc(fineNote)}</small>`;
  $("#return-date-input").disabled = !ready;
  const btn = $("#return-confirm-btn");
  btn.disabled = !ready || returnUi.busy || returnUi.renewing;
  btn.classList.toggle("is-saving", returnUi.busy);
  btn.textContent = returnUi.busy ? "Returning…" : returnUi.failed ? "Try again" : "Confirm return";
  renderReturnRenew();
}

function renderReturnLog(){
  $("#return-log").innerHTML = returnLog.length
    ? `<h2 class="issue-log-h">Returned this session &middot; ${returnCount}</h2>` + returnLog.map(l=>
        `<div class="issue-log-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span><b>${esc(l.title)}</b> &larr; ${esc(l.name)}</span><small>${l.fine>0 ? "fine "+peso(l.fine) : "no fine"}</small></div>`).join("")
    : "";
}

function renderReturn(){
  const b = state.ret.bookId ? findBook(state.ret.bookId) : null;
  $("#return-loan-find").hidden = !!b;
  const sel = $("#return-loan-selected");
  sel.hidden = !b;
  if(b){
    const u = findUser(b.borrowedBy);
    sel.innerHTML = `<span class="issue-who"><span class="issue-name">${esc(b.title)}</span><small>${esc(u?u.name:"—")} &middot; due ${esc(fmtDate(b.dueDate))}</small></span><button type="button" class="issue-change">Change</button>`;
  }
  $("#return-pane-loan").classList.toggle("active", !b);
  $("#return-pane-details").classList.toggle("active", !!b);
  const loanNum = $("#return-num-loan"), detNum = $("#return-num-details");
  loanNum.textContent = b ? "✓" : "1";
  loanNum.classList.toggle("done", !!b);
  detNum.textContent = b ? "✓" : "2";
  detNum.classList.toggle("done", !!b);
  if(!b) renderReturnLoanList();
  renderReturnDetails();
  if(b) updateReturnCalc();
  else renderReturnBar();
  renderReturnLog();
}

function pickReturnLoan(){
  const b = returnUi.rows[returnUi.idx], msg = $("#return-loan-msg");
  if(!b) return;
  if(b.status!=="Borrowed" && b.status!=="Overdue"){ msg.textContent = `“${b.title}” is not currently on loan.`; return; }
  msg.textContent = "";
  state.ret.bookId = b.id;
  returnUi.failed = false;
  $("#return-error").hidden = true;
  const rd = $("#return-date-input");
  rd.max = isoDaysAgo(0);
  rd.min = b.issueDate || "";
  rd.value = isoDaysAgo(0);
  renderReturn();
  $("#return-confirm-btn").focus();
}

function returnKeys(e){
  const rows = returnUi.rows;
  if(e.key==="ArrowDown" || e.key==="ArrowUp"){
    e.preventDefault();
    returnUi.idx = Math.max(0, Math.min(rows.length - 1, returnUi.idx + (e.key==="ArrowDown" ? 1 : -1)));
    renderReturnLoanList(true);
  } else if(e.key==="Enter" && !e.ctrlKey && !e.metaKey){
    e.preventDefault();
    pickReturnLoan();
  } else if(e.key==="Escape" && e.target.value){
    e.preventDefault();
    e.target.value = "";
    state.ret.q = "";
    returnUi.idx = 0;
    renderReturnLoanList();
  }
}

function updateReturnCalc(){
  const b = findBook(state.ret.bookId);
  if(!b) return;
  const today = isoDaysAgo(0);
  let returnDate = $("#return-date-input").value || today;
  if(returnDate > today) returnDate = today;
  if(b.issueDate && returnDate < b.issueDate) returnDate = b.issueDate;
  $("#return-date-input").value = returnDate;
  const overdueDays = b.dueDate ? Math.max(0, daysBetween(b.dueDate, returnDate)) : 0;
  const grace = CONFIG.gracePeriodDays || 0;
  const billable = CONFIG.overdueFinesEnabled ? Math.max(0, overdueDays - grace) : 0;
  $("#return-days-overdue").value = overdueDays===0 ? "Not overdue" : overdueDays + " day(s)";
  const rate = CONFIG.finePerDay; // saved server setting; the server computes the authoritative fine on return
  const fine = billable * rate;
  $("#return-fine-detail").textContent = !CONFIG.overdueFinesEnabled
    ? "Overdue fines are disabled in Library settings"
    : overdueDays===0
    ? `No overdue days · ₱${rate.toFixed(2)} / day`
    : `${overdueDays} day(s) overdue · ${grace}d grace · ₱${rate.toFixed(2)} / day`;
  const amountEl = $("#return-fine-amount");
  amountEl.classList.toggle("zero", fine===0);
  amountEl.textContent = peso(fine);
  state.ret.returnDate = returnDate;
  state.ret.fine = fine;
  state.ret.overdueDays = overdueDays;
  renderReturnBar();
}

/* Why this loan cannot be renewed right now ("" when it can). The server enforces the same rules and has the last word. */
function renewBlockHint(b){
  if(!b) return "";
  if(b.dueDate && b.dueDate < isoDaysAgo(0)) return "Overdue loans cannot be renewed. Return the book and settle the fine first.";
  const used = b.renewalCount || 0, max = CONFIG.maxRenewals || 0;
  if(used >= max) return `Renewal limit reached (${used} of ${max}).`;
  return "";
}
function renderReturnRenew(){
  const b = state.ret.bookId ? findBook(state.ret.bookId) : null;
  const btn = $("#return-renew-btn"), info = $("#return-renew-info");
  if(!b || !btn || !info) return;
  const hint = renewBlockHint(b), used = b.renewalCount || 0, max = CONFIG.maxRenewals || 0;
  info.textContent = hint || `Renewal ${used + 1} of ${max}: new due date ${fmtDate(addDaysISO(isoDaysAgo(0), CONFIG.loanDays))} (${CONFIG.loanDays} days from today). Reservations are checked when you renew.`;
  btn.disabled = !!hint || returnUi.renewing || returnUi.busy;
  btn.classList.toggle("is-saving", returnUi.renewing);
  btn.textContent = returnUi.renewing ? "Renewing…" : "Renew loan";
}
/* Extends the SAME loan by the configured loan period from today. Same transaction row, no return/re-issue. */
async function submitRenew(){
  if(returnUi.busy || returnUi.renewing) return;
  const b = findBook(state.ret.bookId), err = $("#return-error");
  if(!b || (b.status!=="Borrowed" && b.status!=="Overdue")){ err.textContent = "This title is not currently on loan."; err.hidden = false; return; }
  const why = renewBlockHint(b);
  if(why){ err.textContent = why; err.hidden = false; return; }
  returnUi.renewing = true; err.hidden = true;
  renderReturnBar();
  try {
    const res = await api("transactions.php", { method:"POST", body: JSON.stringify({ type:"renew", bookId: b.id, userId: b.borrowedBy }) });
    try { await refreshAffected(b.id, b.borrowedBy); }
    catch (e) { showToast("Renewed, but the lists could not refresh. Reload the page.", {warn:true}); }
    const due = (res.transaction && res.transaction.dueDate) || (findBook(b.id) || {}).dueDate;
    returnUi.renewing = false;
    showToast(`Loan renewed. New due date: ${fmtDate(due)}.`);
    renderReturn();
  } catch (e) {
    returnUi.renewing = false;
    err.textContent = e.message; err.hidden = false;
    if(!e.sessionExpired && (e.status===409 || e.status===404)){
      // The loan changed under us: re-read it so the screen shows the truth.
      try { await refreshAffected(b.id, b.borrowedBy); } catch (_) {}
      const fresh = findBook(b.id);
      if(!fresh || (fresh.status!=="Borrowed" && fresh.status!=="Overdue")){ state.ret.bookId = null; returnUi.idx = 0; }
    }
    renderReturn();
  }
}

async function submitReturn(){
  if(returnUi.busy || returnUi.renewing) return;
  const b = findBook(state.ret.bookId);
  const err = $("#return-error");
  if(!b){ err.textContent = "Select a loan first."; err.hidden = false; return; }
  if(b.status!=="Borrowed" && b.status!=="Overdue"){
    err.textContent = "This title is not currently on loan.";
    err.hidden = false;
    return;
  }
  returnUi.busy = true; returnUi.failed = false; err.hidden = true;
  renderReturnBar();
  try {
    // The server computes the fine and ignores any client-supplied amount, status, or names.
    const res = await api("transactions.php", {
      method:"POST",
      body: JSON.stringify({ type:"return", bookId: b.id, userId: b.borrowedBy, returnDate: state.ret.returnDate }),
    });
    const fine = Number(res.fine || 0);
    const who = (res.transaction && res.transaction.userName) || "the patron";
    try { await refreshAffected(b.id, b.borrowedBy); }
    catch (e) { showToast("Returned, but the lists could not refresh. Reload the page.", {warn:true}); }
    $("#return-final-caption").innerHTML = fine>0
      ? `<b>${esc(b.title)}</b> returned by <b>${esc(who)}</b>. Fine assessed: <b>₱${fine.toFixed(2)}</b> (unpaid until the payment is recorded on the patron's record).`
      : `<b>${esc(b.title)}</b> returned by <b>${esc(who)}</b> on time. No fine due.`;
    $("#return-result").hidden = false;
    playStamp($("#return-stamp"));
    showToast(fine>0 ? `Fine assessed: ₱${fine.toFixed(2)}` : "Book returned successfully.", {warn: fine>0});
    renderDashboard();
    returnLog.unshift({ title: b.title, name: who, fine });
    if(returnLog.length > 20) returnLog.pop();
    returnCount++;
    state.ret.bookId = null; state.ret.q = ""; $("#return-search").value = ""; returnUi.idx = 0;
    $("#return-loan-msg").textContent = "";
    returnUi.busy = false;
    renderReturn();
    $("#return-search").focus();
  } catch (e) {
    returnUi.busy = false; returnUi.failed = true;
    err.textContent = e.message; err.hidden = false;
    renderReturnBar();
  }
}

$("#return-search").addEventListener("input", e=>{ state.ret.q = e.target.value; returnUi.idx = 0; renderReturnLoanList(); });
$("#return-search").addEventListener("keydown", returnKeys);
$("#return-loan-list").addEventListener("click", e=>{
  const row = e.target.closest(".issue-row");
  if(row && row.dataset.k !== undefined){ returnUi.idx = +row.dataset.k; pickReturnLoan(); }
});
$("#return-loan-selected").addEventListener("click", e=>{
  if(!e.target.closest(".issue-change")) return;
  state.ret.bookId = null; state.ret.q = ""; $("#return-search").value = ""; returnUi.idx = 0; returnUi.failed = false;
  $("#return-error").hidden = true;
  renderReturn(); $("#return-search").focus();
});
$("#return-date-input").addEventListener("change", ()=>{ $("#return-error").hidden = true; returnUi.failed = false; updateReturnCalc(); });
$("#return-confirm-btn").addEventListener("click", submitReturn);
$("#return-renew-btn").addEventListener("click", submitRenew);
$("#return-restart-btn").addEventListener("click", resetReturnWizard);
document.addEventListener("keydown", e=>{
  if(e.key!=="Enter" || !(e.ctrlKey || e.metaKey) || state.currentView!=="return" || scrollLockCount>0) return;
  if(getComputedStyle($("#app")).visibility === "hidden") return;
  const btn = $("#return-confirm-btn");
  if(btn && !btn.disabled){ e.preventDefault(); submitReturn(); }
});


/* ==================================================================
   REPORTS
   ================================================================== */
/* ==================================================================
   OVERDUE REPORT: summary cards, ranked chart, searchable / sortable / paged table.
   Everything is computed in the browser from api/reports.php (`overdue` rows); no API change.
   Fines shown here are ESTIMATES: the real fine is written when the book is returned.
   ================================================================== */
/* Severity bands by days late. Change the thresholds here and the chips, chart zones and badges follow. */
const OVERDUE_BANDS = [
  {id:"crit", min:15, name:"Critical", short:"15+ d",  legend:"15+ days",  cls:"sev-high"},
  {id:"mid",  min:8,  name:"High",     short:"8–14 d", legend:"8–14 days", cls:"sev-mid"},
  {id:"low",  min:1,  name:"Recent",   short:"1–7 d",  legend:"1–7 days",  cls:"sev-low"},
];
const OVERDUE_PAGE_SIZE = 10;
const OVERDUE_CHART_ROWS = 8;
function overdueBand(days){ return OVERDUE_BANDS.find(b=>days>=b.min) || OVERDUE_BANDS[OVERDUE_BANDS.length-1]; }
const OVERDUE_SORTS = {
  days:(a,b)=> b.daysLate - a.daysLate || String(a.dueDate).localeCompare(String(b.dueDate)),
  fine:(a,b)=> b.estimatedFine - a.estimatedFine || b.daysLate - a.daysLate,
  due:(a,b)=> String(a.dueDate).localeCompare(String(b.dueDate)),
  title:(a,b)=> String(a.bookTitle).localeCompare(String(b.bookTitle)),
  borrower:(a,b)=> String(a.userName || "").localeCompare(String(b.userName || "")),
};
function overdueFiltered(rows){
  const {q, band, sort} = state.overdue;
  const needle = q.trim().toLowerCase();
  return rows
    .filter(o=> (band==="all" || overdueBand(o.daysLate).id===band)
      && (!needle || (String(o.bookTitle) + " " + String(o.userName || "")).toLowerCase().includes(needle)))
    .sort(OVERDUE_SORTS[sort] || OVERDUE_SORTS.days);
}

/* Ranked bars (most overdue first, top 8 of whatever the filters leave). The axis is sized from ALL overdue
   loans so bars do not rescale while filtering. Zones behind the bars mark the severity bands. */
function renderOverdueChart(wrap, rowsAll, shown, animate){
  if(!rowsAll.length){
    wrap.innerHTML = `<div class="empty-state" style="padding:40px;"><div class="s">Nothing overdue right now.</div></div>`;
    return;
  }
  if(!shown.length){
    wrap.innerHTML = `<div class="chart-empty">No loans to chart. Clear the search or filter.</div>`;
    return;
  }
  const step = OVERDUE_BANDS[1].min - 1; // 7: one axis step is the width of the 1–7 day band
  const peak = Math.max(...rowsAll.map(o=>o.daysLate));
  const axisMax = Math.max(step*3, Math.ceil((peak + Math.max(2, Math.round(peak*0.08))) / step) * step);
  const tickStep = step * Math.ceil(axisMax / step / 4);
  const ticks = [];
  for(let t=0; t<=axisMax; t+=tickStep) ticks.push(t);
  const z1 = (step/axisMax*100).toFixed(2), z2 = ((OVERDUE_BANDS[0].min-1)/axisMax*100).toFixed(2);
  const bars = shown.slice().sort(OVERDUE_SORTS.days).slice(0, OVERDUE_CHART_ROWS);
  const rowsHtml = bars.map(o=>{
    const b = overdueBand(o.daysLate), w = (o.daysLate/axisMax*100).toFixed(2);
    const tip = `${o.bookTitle} · ${o.userName || "—"} · due ${fmtDate(o.dueDate)} · ${o.daysLate} days late · est. ${peso(o.estimatedFine)}`;
    return `<div class="od-crow" title="${esc(tip)}"><span class="od-ct">${esc(o.bookTitle)}</span>
      <div class="od-track"><div class="od-bar ${b.cls}" data-w="${w}"${animate ? "" : ` style="width:${w}%"`}><span class="od-val">${o.daysLate} d</span></div></div></div>`;
  }).join("");
  wrap.innerHTML = `<div class="od-chart" style="--z1:${z1}%; --z2:${z2}%;">
    <div class="od-lg">${OVERDUE_BANDS.slice().reverse().map(b=>`<span><i class="${b.cls}"></i>${b.legend}</span>`).join("")}</div>
    <div role="img" aria-label="Bar chart of days late for the ${bars.length} most overdue loans. The table below lists every loan.">
      ${rowsHtml}
      <div class="od-axis"><span></span><div class="od-ticks">${ticks.map((t,i)=>`<span${i ? "" : ` class="first"`} style="left:${(t/axisMax*100).toFixed(2)}%">${t ? t + " days" : "0"}</span>`).join("")}</div></div>
    </div>
    ${shown.length > OVERDUE_CHART_ROWS ? `<div class="od-note">Showing the ${OVERDUE_CHART_ROWS} most overdue of ${shown.length} loans. The table lists every loan.</div>` : ""}
  </div>`;
  if(animate) requestAnimationFrame(()=> $all(".od-bar", wrap).forEach((el,i)=> gsap.to(el,{width:el.dataset.w+"%", duration:0.8, delay:0.05*i})));
}

function renderOverdueReport(r, ctx){
  const {chartWrap, theadRow, tbody} = ctx;
  const rows = r.overdue || [];
  const S = state.overdue;
  const byId = id=> document.getElementById(id);
  const cards = byId("overdue-cards"), toolbar = byId("overdue-toolbar"), foot = byId("overdue-foot"), list = byId("overdue-card-list");

  const estTotal = r.totals && r.totals.estimatedOverdueFines != null ? r.totals.estimatedOverdueFines : rows.reduce((n,o)=>n+o.estimatedFine, 0);
  const top = rows.reduce((m,o)=> (!m || o.daysLate > m.daysLate) ? o : m, null);
  const borrowers = new Set(rows.map(o=> o.userId || o.userName)).size;
  cards.hidden = false;
  cards.innerHTML = `
    <div class="od-card"><span class="od-card-k">Overdue loans</span><b>${rows.length}</b><span class="od-card-f">open past their due date</span></div>
    <div class="od-card"><span class="od-card-k">Estimated fines</span><b>${peso(estTotal)}</b><span class="od-card-f">assessed when returned</span></div>
    <div class="od-card"><span class="od-card-k">Most overdue</span><b>${top ? top.daysLate + " days" : "—"}</b><span class="od-card-f">${top ? esc(top.bookTitle) : "No overdue loans"}</span></div>
    <div class="od-card"><span class="od-card-k">Affected borrowers</span><b>${borrowers}</b><span class="od-card-f">blocked from new loans</span></div>`;

  theadRow.innerHTML = "<th scope='col'>Priority</th><th scope='col'>Book</th><th scope='col'>Borrower</th><th scope='col'>Due Date</th><th scope='col' class='od-num'>Days Late</th><th scope='col' class='od-num' title='(days late − grace days) × daily rate. Assessed when the book is returned.'>Est. Fine</th>";

  if(!rows.length){
    toolbar.hidden = true; foot.hidden = true; list.hidden = true;
    renderOverdueChart(chartWrap, rows, rows, false);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--ink-soft); padding:30px;">No overdue records.</td></tr>`;
    return;
  }

  const counts = {};
  OVERDUE_BANDS.forEach(b=> counts[b.id] = rows.filter(o=> overdueBand(o.daysLate).id===b.id).length);
  toolbar.hidden = false;
  toolbar.innerHTML = `
    <div class="search-field">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="overdue-search" type="search" placeholder="Search book or borrower" aria-label="Search book or borrower" autocomplete="off" value="${esc(S.q)}">
    </div>
    <div class="filter-chips" id="overdue-chips" role="group" aria-label="Filter by days late">
      <button type="button" class="chip" data-band="all">All ${rows.length}</button>
      ${OVERDUE_BANDS.map(b=>`<button type="button" class="chip" data-band="${b.id}">${b.short} · ${counts[b.id]}</button>`).join("")}
    </div>
    <div class="toolbar-spacer"></div>
    <select class="sort-select" id="overdue-sort" aria-label="Sort overdue loans">
      ${[["days","Days late"],["fine","Est. fine"],["due","Due date"],["title","Book title"],["borrower","Borrower"]].map(([v,l])=>`<option value="${v}"${S.sort===v ? " selected" : ""}>${l}</option>`).join("")}
    </select>`;
  foot.hidden = false;
  foot.innerHTML = `<span id="overdue-count" role="status"></span>
    <span class="od-pager"><button type="button" class="btn btn-secondary btn-sm" id="overdue-prev">Previous</button><button type="button" class="btn btn-secondary btn-sm" id="overdue-next">Next</button><span>${OVERDUE_PAGE_SIZE} per page</span></span>`;
  list.hidden = false;

  let first = true; // the bars animate in once per render, not on every keystroke
  const draw = ()=>{
    const shown = overdueFiltered(rows);
    const pages = Math.max(1, Math.ceil(shown.length / OVERDUE_PAGE_SIZE));
    S.page = Math.min(Math.max(1, S.page), pages);
    const from = (S.page - 1) * OVERDUE_PAGE_SIZE, slice = shown.slice(from, from + OVERDUE_PAGE_SIZE);
    $all(".chip", toolbar).forEach(c=>{
      const on = c.dataset.band === S.band;
      c.classList.toggle("active", on); c.setAttribute("aria-pressed", String(on));
    });
    renderOverdueChart(chartWrap, rows, shown, first); first = false;

    const clearBtn = `<button type="button" class="btn btn-secondary btn-sm" data-od-clear>Clear filters</button>`;
    tbody.innerHTML = slice.length ? slice.map(o=>{
      const b = overdueBand(o.daysLate);
      return `<tr><td><span class="od-pr ${b.cls}"><i></i>${b.name}</span></td><td class="cell-primary">${esc(o.bookTitle)}</td><td>${esc(o.userName || "—")}</td>
        <td class="cell-mono">${fmtDate(o.dueDate)}</td><td class="od-num">${o.daysLate}</td><td class="od-num cell-mono">${peso(o.estimatedFine)}</td></tr>`;
    }).join("") : `<tr><td colspan="6" style="text-align:center; color:var(--ink-soft); padding:30px;">No overdue loans match your search or filter.<div style="margin-top:10px;">${clearBtn}</div></td></tr>`;
    list.innerHTML = slice.length ? slice.map(o=>{
      const b = overdueBand(o.daysLate);
      return `<div class="record-card"><div class="rc-top"><div><div class="rc-title">${esc(o.bookTitle)}</div><div class="rc-sub">${esc(o.userName || "—")}</div></div><span class="od-pr ${b.cls}"><i></i>${b.name}</span></div>
        <div class="rc-meta"><span>Due <b>${fmtDate(o.dueDate)}</b></span><span><b>${o.daysLate}</b> days late</span><span>Est. fine <b>${peso(o.estimatedFine)}</b></span></div></div>`;
    }).join("") : `<div class="empty-state"><div class="t">No matching loans</div><div class="s">No overdue loan matches your search or filter.</div><div style="margin-top:14px;">${clearBtn}</div></div>`;
    [tbody, list].forEach(box=> $all("[data-od-clear]", box).forEach(btn=> btn.addEventListener("click", ()=>{
      S.q = ""; S.band = "all"; S.page = 1; $("#overdue-search").value = ""; draw();
    })));

    const total = rows.length;
    $("#overdue-count").textContent = !shown.length ? `No matching loans · ${total} overdue in total`
      : shown.length < total ? `Showing ${from+1}–${from+slice.length} of ${shown.length} matching loans · ${total} overdue in total`
      : `Showing ${from+1}–${from+slice.length} of ${total} overdue loans`;
    $("#overdue-prev").disabled = S.page <= 1;
    $("#overdue-next").disabled = S.page >= pages;
  };

  const search = $("#overdue-search"), sortSel = $("#overdue-sort");
  search.addEventListener("input", debounce(()=>{ S.q = search.value; S.page = 1; draw(); }, 150));
  sortSel.addEventListener("change", ()=>{ S.sort = sortSel.value; S.page = 1; draw(); });
  $all(".chip", toolbar).forEach(c=> c.addEventListener("click", ()=>{ S.band = c.dataset.band; S.page = 1; draw(); }));
  $("#overdue-prev").addEventListener("click", ()=>{ S.page--; draw(); });
  $("#overdue-next").addEventListener("click", ()=>{ S.page++; draw(); });
  draw();
}

const BORROWING_PAGE_SIZE = 10;
let borrowingReportRequest = 0;
const BORROWING_SORTS = [
  ["newest","Newest First"],
  ["oldest","Oldest First"],
  ["title_az","Book Title (A–Z)"],
  ["title_za","Book Title (Z–A)"],
  ["borrower_az","Borrower Name (A–Z)"],
  ["due_earliest","Due Date (Earliest First)"],
  ["due_latest","Due Date (Latest First)"],
];
function borrowingLedgerQuery(){
  const S = state.borrowing;
  return "reports.php?ledger=1&" + new URLSearchParams({ q:S.q, sort:S.sort, page:String(S.page) }).toString();
}
function borrowingFineCell(t){
  return t.status==="Returned" ? peso(t.fine) + (t.fine>0 && !t.finePaid ? " · unpaid" : "") : "—";
}
function paintBorrowingRows(tbody, list, rows, total){
  const clearBtn = `<button type="button" class="btn btn-secondary btn-sm" data-br-clear>Clear search</button>`;
  const emptyMsg = total ? "No borrowing records match your search." : "No transactions recorded yet.";
  tbody.innerHTML = rows.length ? rows.map(t=>`
    <tr><td><span class="badge ${badgeClassFor(t.status)}">${esc(t.status)}</span></td>
    <td class="cell-primary">${esc(t.bookTitle)}</td><td>${esc(t.userName || "—")}</td>
    <td class="cell-mono">${fmtDate(t.issueDate)}</td><td class="cell-mono">${fmtDate(t.dueDate)}</td>
    <td class="cell-mono">${fmtDate(t.returnDate)}</td>
    <td class="cell-mono">${borrowingFineCell(t)}</td></tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center; color:var(--ink-soft); padding:30px;">${emptyMsg}${state.borrowing.q ? `<div style="margin-top:10px;">${clearBtn}</div>` : ""}</td></tr>`;
  list.innerHTML = rows.length ? rows.map(t=>`
    <div class="record-card"><div class="rc-top"><div><div class="rc-title">${esc(t.bookTitle)}</div><div class="rc-sub">${esc(t.userName || "—")}</div></div><span class="badge ${badgeClassFor(t.status)}">${esc(t.status)}</span></div>
      <div class="rc-meta"><span>Issued <b>${fmtDate(t.issueDate)}</b></span><span>Due <b>${fmtDate(t.dueDate)}</b></span><span>Returned <b>${fmtDate(t.returnDate)}</b></span><span>Fine <b>${borrowingFineCell(t)}</b></span></div></div>`).join("")
    : `<div class="empty-state"><div class="t">${total ? "No matching records" : "No borrowing records"}</div><div class="s">${emptyMsg}</div>${state.borrowing.q ? `<div style="margin-top:14px;">${clearBtn}</div>` : ""}</div>`;
}
async function renderBorrowingReport(ctx){
  const {tbody} = ctx;
  const S = state.borrowing;
  const toolbar = $("#overdue-toolbar"), foot = $("#overdue-foot"), list = $("#overdue-card-list");
  toolbar.hidden = false;
  toolbar.innerHTML = `
    <div class="search-field">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="borrowing-search" type="search" placeholder="Search book or borrower" aria-label="Search book or borrower" autocomplete="off" value="${esc(S.q)}">
    </div>
    <div class="toolbar-spacer"></div>
    <select class="sort-select" id="borrowing-sort" aria-label="Sort borrowing records">
      ${BORROWING_SORTS.map(([v,l])=>`<option value="${v}"${S.sort===v ? " selected" : ""}>${l}</option>`).join("")}
    </select>`;
  foot.hidden = false;
  foot.innerHTML = `<span id="borrowing-count" role="status"></span>
    <span class="od-pager"><button type="button" class="btn btn-secondary btn-sm" id="borrowing-prev">Previous</button><button type="button" class="btn btn-secondary btn-sm" id="borrowing-next">Next</button><span>${BORROWING_PAGE_SIZE} per page</span></span>`;
  list.hidden = false;

  const draw = async ()=>{
    if(state.reportType !== "borrowing") return;
    const requestId = ++borrowingReportRequest;
    if(!tbody.querySelector(".skel-row")) tbody.classList.add("is-loading"); // dim the old rows while a new page loads
    let data;
    try {
      data = await api(borrowingLedgerQuery());
    } catch (err) {
      if(requestId === borrowingReportRequest) tbody.classList.remove("is-loading");
      if(requestId !== borrowingReportRequest || state.reportType !== "borrowing") return;
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--ink-soft); padding:30px;">Could not load borrowing records: ${esc(err.message)}</td></tr>`;
      list.innerHTML = "";
      $("#borrowing-count").textContent = "Could not load records";
      return;
    }
    if(requestId === borrowingReportRequest) tbody.classList.remove("is-loading");
    if(requestId !== borrowingReportRequest || state.reportType !== "borrowing") return;
    if(REPORT){
      REPORT.recent = data.recent;
      REPORT.recentTotal = data.recentTotal;
      REPORT.recentPage = data.recentPage;
    }
    const total = data.recentTotal || 0;
    const pages = Math.max(1, Math.ceil(total / BORROWING_PAGE_SIZE));
    S.page = data.recentPage || Math.min(Math.max(1, S.page), pages);
    const rows = data.recent || [];
    const from = total ? (S.page - 1) * BORROWING_PAGE_SIZE : 0;
    paintBorrowingRows(tbody, list, rows, total);
    [tbody, list].forEach(box=> $all("[data-br-clear]", box).forEach(btn=> btn.addEventListener("click", ()=>{
      S.q = ""; S.page = 1; const inp = $("#borrowing-search"); if(inp) inp.value = ""; draw();
    })));
    $("#borrowing-count").textContent = !total
      ? (S.q ? "No matching borrowing records" : "No borrowing records")
      : `Showing ${from+1}–${from+rows.length} of ${total} borrowing records`;
    $("#borrowing-prev").disabled = S.page <= 1 || !total;
    $("#borrowing-next").disabled = S.page >= pages || !total;
  };

  const search = $("#borrowing-search"), sortSel = $("#borrowing-sort");
  search.addEventListener("input", debounce(()=>{ S.q = search.value; S.page = 1; draw(); }, 150));
  sortSel.addEventListener("change", ()=>{ S.sort = sortSel.value; S.page = 1; draw(); });
  $("#borrowing-prev").addEventListener("click", ()=>{ S.page--; draw(); });
  $("#borrowing-next").addEventListener("click", ()=>{ S.page++; draw(); });
  await draw();
}

/* ==================================================================
   AUDIT TRAIL — read-only list from api/audit.php (staff only)
   Fine events: loan.return (shows the fine), fine.assess (money owed), fine.pay (money received).
   ================================================================== */
const AUDIT_PAGE_SIZE = 25;
const AUDIT_FILTERS = [
  ["all","All activity",""],
  ["fines","Fines (assessed and paid)","fine.assess,fine.pay"],
  ["loans","Loans (issued, renewed, returned)","loan.issue,loan.renew,loan.return"],
  ["requests","Borrow requests","reservation.create,reservation.cancel"],
  ["books","Books","book.create,book.update,book.delete"],
  ["users","Patrons","user.create,user.update,user.delete"],
  ["accounts","Sign-ins and accounts","auth.login,auth.login_failed,auth.login_denied,auth.logout,auth.setup,auth.signup,auth.account_added,auth.password_change,auth.password_failed,auth.password_reset,account.update"],
  ["settings","Settings","settings.update,settings.reset,notifs.update"],
];
const AUDIT_LABELS = {
  "fine.assess":["Fine assessed","badge-overdue"], "fine.pay":["Fine paid","badge-available"],
  "loan.issue":["Book issued","badge-borrowed"], "loan.renew":["Loan renewed","badge-borrowed"], "loan.return":["Book returned","badge-available"],
  "reservation.create":["Request made","badge-active"], "reservation.cancel":["Request cancelled","badge-inactive"],
  "book.create":["Book added","badge-active"], "book.update":["Book edited","badge-active"], "book.delete":["Book deleted","badge-overdue"],
  "user.create":["Patron added","badge-active"], "user.update":["Patron edited","badge-active"], "user.delete":["Patron deleted","badge-overdue"],
  "auth.login":["Signed in","badge-inactive"], "auth.logout":["Signed out","badge-inactive"],
  "auth.login_failed":["Sign-in failed","badge-overdue"], "auth.login_denied":["Sign-in refused","badge-overdue"],
  "auth.password_change":["Password changed","badge-active"], "auth.password_failed":["Password change failed","badge-overdue"],
  "auth.password_reset":["Password reset","badge-active"], "auth.setup":["First admin created","badge-active"],
  "auth.signup":["Reader signed up","badge-active"], "auth.account_added":["Staff account added","badge-active"],
  "account.update":["Profile edited","badge-inactive"],
  "settings.update":["Settings changed","badge-borrowed"], "settings.reset":["Settings reset","badge-borrowed"], "notifs.update":["Notifications changed","badge-inactive"],
};
function auditDays(n){ n = Number(n) || 0; return `${n} day${n===1 ? "" : "s"}`; }
function auditPatron(e){
  const d = e.details || {};
  const id = d.userId || (e.entityType==="user" ? e.entityId : "");
  if(d.patron) return d.patron + (id ? ` (${id})` : "");
  return id ? `patron ${id}` : "a patron";
}
function auditSettingValue(key, v){
  if(key==="finePerDay") return peso(v);
  if(v===null || v===undefined || v==="") return "empty";
  if(v===true) return "on";
  if(v===false) return "off";
  return String(v);
}
/* One plain-language sentence per entry. The caller escapes it. */
function auditText(e){
  const d = e.details || {};
  const title = d.title ? `“${d.title}”` : `book ${e.entityId || ""}`.trim();
  switch(e.action){
    case "fine.assess":
      return `Fine of ${peso(d.amount)} assessed to ${auditPatron(e)} for ${title}, returned ${auditDays(d.daysOverdue)} late.`;
    case "fine.pay": {
      const n = Number(d.loans) || 0;
      return `Recorded payment of ${peso(d.amount)} from ${auditPatron(e)}, settling ${n} loan${n===1 ? "" : "s"}.`;
    }
    case "loan.return": {
      const fine = Number(d.fine) || 0, late = Number(d.daysOverdue) || 0;
      const tail = fine > 0 ? `${auditDays(late)} late, fine ${peso(fine)}`
        : late > 0 ? `${auditDays(late)} late, no fine (within the grace period or fines are off)` : "on time, no fine";
      return `Returned ${title} from ${auditPatron(e)}: ${tail}.`;
    }
    case "loan.issue": return `Issued ${title} to ${auditPatron(e)}${d.dueDate ? `, due ${fmtDate(d.dueDate)}` : ""}.`;
    case "loan.renew": return `Renewed the loan of book ${e.entityId} (renewal ${d.renewals ?? "?"})${d.dueDate ? `, new due date ${fmtDate(d.dueDate)}` : ""}.`;
    case "reservation.create": return `Borrow request for book ${e.entityId} by patron ${d.userId || "?"}.`;
    case "reservation.cancel": return `Borrow request for book ${e.entityId} cancelled${d.userId ? ` (patron ${d.userId})` : ""}.`;
    case "book.create": return `Added ${title}.`;
    case "book.update": return `Edited ${title}${d.fields ? `: ${d.fields.join(", ")}` : ""}.`;
    case "book.delete": return `Deleted ${title}${d.cancelledReservations ? `, cancelled ${d.cancelledReservations} request(s)` : ""}.`;
    case "user.create": return `Added patron ${d.name || e.entityId}.`;
    case "user.update": return `Edited patron ${e.entityId}${d.fields ? `: ${d.fields.join(", ")}` : ""}.`;
    case "user.delete": return `Deleted patron ${d.name || e.entityId}${d.cancelledReservations ? `, cancelled ${d.cancelledReservations} request(s)` : ""}.`;
    case "settings.update": case "settings.reset": {
      const ch = Object.entries(d.changes || {}).map(([k,[a,b]])=> `${k}: ${auditSettingValue(k,a)} → ${auditSettingValue(k,b)}`);
      return (e.action==="settings.reset" ? "Reset settings to defaults" : "Changed settings") + (ch.length ? `: ${ch.join("; ")}` : "") + ".";
    }
    case "auth.login_failed": return d.accountExists ? "Wrong password for an existing account." : "Unknown username.";
    case "auth.login_denied": return d.reason==="inactive" ? "The account is inactive." : "The account is not a staff account.";
    case "auth.login": return "Signed in.";
    case "auth.logout": return "Signed out.";
    default: return [e.entityType, e.entityId].filter(Boolean).join(" ") || e.action;
  }
}
function auditFineCell(e){
  const d = e.details || {};
  if(e.action==="fine.assess") return `<span class="audit-fine">${esc(peso(d.amount))}<small>assessed</small></span>`;
  if(e.action==="fine.pay") return `<span class="audit-fine">${esc(peso(d.amount))}<small>paid</small></span>`;
  return "—";
}
function auditBadge(e){
  const [label, cls] = AUDIT_LABELS[e.action] || [e.action, "badge-inactive"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
function auditQuery(){
  const S = state.audit;
  const q = new URLSearchParams({ limit:String(AUDIT_PAGE_SIZE), offset:String((S.page-1)*AUDIT_PAGE_SIZE) });
  const actions = (AUDIT_FILTERS.find(f=>f[0]===S.filter) || AUDIT_FILTERS[0])[2];
  if(actions) q.set("action", actions);
  if(S.from) q.set("from", S.from);
  if(S.to) q.set("to", S.to);
  return "audit.php?" + q.toString();
}
let auditRequest = 0;
async function renderAudit(){
  const S = state.audit;
  const toolbar = $("#audit-toolbar"), tbody = $("#audit-tbody"), list = $("#audit-card-list"), foot = $("#audit-foot");
  if(!toolbar || !tbody) return;
  toolbar.innerHTML = `
    <select class="sort-select" id="audit-filter" aria-label="Type of activity">
      ${AUDIT_FILTERS.map(([v,l])=>`<option value="${v}"${S.filter===v ? " selected" : ""}>${esc(l)}</option>`).join("")}
    </select>
    <label class="sort-select" style="display:inline-flex; gap:6px; align-items:center;">From <input type="date" id="audit-from" value="${esc(S.from)}" style="border:none; background:transparent; font:inherit; color:inherit;"></label>
    <label class="sort-select" style="display:inline-flex; gap:6px; align-items:center;">To <input type="date" id="audit-to" value="${esc(S.to)}" style="border:none; background:transparent; font:inherit; color:inherit;"></label>
    <div class="toolbar-spacer"></div>
    <button type="button" class="btn btn-secondary btn-sm" id="audit-clear">Clear filters</button>`;
  foot.innerHTML = `<span id="audit-count" role="status"></span>
    <span class="od-pager"><button type="button" class="btn btn-secondary btn-sm" id="audit-prev">Previous</button><button type="button" class="btn btn-secondary btn-sm" id="audit-next">Next</button><span>${AUDIT_PAGE_SIZE} per page</span></span>`;

  const draw = async ()=>{
    const requestId = ++auditRequest;
    tbody.classList.add("is-loading");
    let data;
    try { data = await api(auditQuery()); }
    catch(err){
      if(requestId !== auditRequest) return;
      tbody.classList.remove("is-loading");
      if(err.sessionExpired) return;
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">Could not load the audit trail: ${esc(err.message)}</td></tr>`;
      list.innerHTML = "";
      $("#audit-count").textContent = "Could not load entries";
      return;
    }
    if(requestId !== auditRequest) return;
    tbody.classList.remove("is-loading");
    const total = data.total || 0, rows = data.entries || [];
    const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
    if(S.page > pages && total){ S.page = pages; return draw(); } // the list shrank: go to the last page
    const empty = "No activity matches these filters.";
    tbody.innerHTML = rows.length ? rows.map(e=>`
      <tr><td class="cell-mono">${esc(fmtDateTime(e.createdAt))}</td>
      <td>${esc(e.actorName || "Not signed in")}</td>
      <td>${auditBadge(e)}</td>
      <td class="audit-detail">${esc(auditText(e))}</td>
      <td>${auditFineCell(e)}</td></tr>`).join("")
      : `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">${empty}</td></tr>`;
    list.innerHTML = rows.length ? rows.map(e=>`
      <div class="record-card"><div class="rc-top"><div><div class="rc-title">${esc(auditText(e))}</div><div class="rc-sub">${esc(e.actorName || "Not signed in")}</div></div>${auditBadge(e)}</div>
      <div class="rc-meta"><span>${esc(fmtDateTime(e.createdAt))}</span>${e.action==="fine.assess" || e.action==="fine.pay" ? `<span>${e.action==="fine.pay" ? "Paid" : "Assessed"} <b>${esc(peso((e.details||{}).amount))}</b></span>` : ""}</div></div>`).join("")
      : `<div class="empty-state"><div class="t">No activity</div><div class="s">${empty}</div></div>`;
    const from = total ? (S.page-1)*AUDIT_PAGE_SIZE : 0;
    $("#audit-count").textContent = total ? `Showing ${from+1}–${from+rows.length} of ${total} entries` : "No entries";
    $("#audit-prev").disabled = S.page <= 1 || !total;
    $("#audit-next").disabled = S.page >= pages || !total;
  };

  $("#audit-filter").addEventListener("change", e=>{ S.filter = e.target.value; S.page = 1; draw(); });
  $("#audit-from").addEventListener("change", e=>{ S.from = e.target.value; S.page = 1; draw(); });
  $("#audit-to").addEventListener("change", e=>{ S.to = e.target.value; S.page = 1; draw(); });
  $("#audit-clear").addEventListener("click", ()=>{
    S.filter = "all"; S.from = ""; S.to = ""; S.page = 1;
    $("#audit-filter").value = "all"; $("#audit-from").value = ""; $("#audit-to").value = ""; draw();
  });
  $("#audit-prev").addEventListener("click", ()=>{ S.page--; draw(); });
  $("#audit-next").addEventListener("click", ()=>{ S.page++; draw(); });
  await draw();
}

async function renderReports(type, opts={}){
  type = type==="overdue" ? "overdue" : "borrowing";
  state.reportType = type;
  if(type !== "borrowing") borrowingReportRequest++;
  const heading = $("#reports-heading"), sub = $("#reports-sub"), panelTitle = $("#reports-panel-title");
  const chartWrap = $("#reports-chart-wrap");
  const theadRow = $("#reports-thead-row"), tbody = $("#reports-tbody");
  ["overdue-cards","overdue-toolbar","overdue-foot","overdue-card-list"].forEach(id=>{ const n = document.getElementById(id); if(n) n.hidden = true; });
  chartWrap.setAttribute("aria-live", type==="overdue" ? "off" : "polite"); // the overdue chart redraws while filtering
  heading.textContent = type==="overdue" ? "Overdue Report" : "Borrowing Report";
  panelTitle.textContent = type==="overdue" ? "Days late, most overdue first" : "Borrowing over the last 7 days";
  tbody.classList.remove("is-loading");
  try{
    if(!opts.cached || !REPORT){
      chartWrap.innerHTML = reportSkeletonHTML();
      tbody.innerHTML = skeletonRowsHTML(5);
      await loadReport();
    }
  }catch(err){
    theadRow.innerHTML = ""; tbody.innerHTML = "";
    errorWithRetry(chartWrap, `Could not load the report: ${err.message}`, ()=> renderReports(type));
    return;
  }
  if(state.reportType !== type) return; // user switched reports while loading
  const r = REPORT;
  $("#reports-note").textContent = `Live data · as of ${fmtDate(r.asOf)}`;

  if(type==="overdue"){
    sub.textContent = `Every loan currently past its due date. Estimated fines use the saved library rules (rate and grace period). Estimated total: ${peso(r.totals.estimatedOverdueFines)}.`;
    renderOverdueReport(r, {chartWrap, theadRow, tbody});
  } else {
    sub.textContent = `Issue and return activity. Fines assessed on returned loans to date: ${peso(r.totals.finesAssessed)}; still unpaid: ${peso(r.totals.finesUnpaid)}.`;
    renderActivityChart("reports-chart-wrap", r.activity);
    theadRow.innerHTML = "<th scope='col'>Status</th><th scope='col'>Book</th><th scope='col'>Person</th><th scope='col'>Issued</th><th scope='col'>Due</th><th scope='col'>Returned</th><th scope='col'>Fine</th>";
    await renderBorrowingReport({chartWrap, theadRow, tbody});
  }
}

/* ==================================================================
   SETTINGS — profile, library, notification, security and system preferences (saved via the API; theme is browser-local)
   ================================================================== */
const AVATAR_PRESETS = ["#237A43","#154A28","#EBB134","#2F4A63","#7A2E2E","#3D6B4F"];
let profileEditing = false;
let profileSnapshot = null;

function setFieldError(input, msg){
  const field = input.closest(".field");
  if(!field) return false;
  field.classList.add("invalid");
  let err = field.querySelector(".err");
  if(!err){ err = document.createElement("div"); err.className = "err"; field.appendChild(err); }
  err.textContent = msg || "Please check this field.";
  if(input.id){ err.id = err.id || input.id + "-err"; input.setAttribute("aria-describedby", err.id); }
  input.setAttribute("aria-invalid","true");
  return false;
}
function clearFieldError(input){
  const field = input?.closest(".field");
  if(!field) return;
  field.classList.remove("invalid");
  const err = field.querySelector(".err");
  if(err) err.textContent = "";
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
}
const BOOK_FIELD_IDS = {title:"f-title", author:"f-author", category:"f-category", year:"f-year", location:"f-location", format:"f-format", description:"f-description", cover:"f-cover"};
const USER_FIELD_IDS = {lastName:"f-lastname", firstName:"f-firstname", middleInitial:"f-middleinitial", program:"f-program", yearLevel:"f-yearlevel", studentNumber:"f-studentnumber", contact:"f-contact"};
/* Show the server's per-field validation messages next to their inputs. Returns false if any
   field can't be mapped, so the caller falls back to a toast. */
function showServerFieldErrors(modalEl, err, idMap){
  if(!err || !err.fields) return false;
  const keys = Object.keys(err.fields);
  const els = keys.map(k=> idMap[k] && $("#"+idMap[k], modalEl));
  if(!keys.length || els.some(el=>!el)) return false;
  keys.forEach((k,i)=> setFieldError(els[i], String(err.fields[k])));
  els[0].focus();
  shakeModal(modalEl);
  return true;
}
function markSaving(btn, on){
  if(!btn) return;
  btn.classList.toggle("is-saving", on);
  btn.disabled = on;
}

function applyDensity(){
  document.documentElement.setAttribute("data-density", CONFIG.density || "comfortable");
}

function paintAvatarEl(el){
  if(!el) return;
  const initials = initialsOf(ACCOUNT.displayName || "AL") || "AL";
  if(ACCOUNT.avatarDataUrl){
    el.classList.add("has-photo");
    el.style.backgroundImage = `url("${ACCOUNT.avatarDataUrl}")`;
    el.style.backgroundColor = "";
    el.textContent = "";
  } else {
    el.classList.remove("has-photo");
    el.style.backgroundImage = "";
    el.style.backgroundColor = ACCOUNT.avatarPreset || "";
    el.textContent = initials;
  }
}
function paintAvatars(){
  paintAvatarEl($("#header-avatar"));
  paintAvatarEl($("#menu-avatar"));
  paintAvatarEl($("#profile-avatar"));
  const name = ACCOUNT.displayName || DEFAULT_ACCOUNT.displayName;
  const user = ACCOUNT.username || DEFAULT_ACCOUNT.username;
  if($("#menu-name")) $("#menu-name").textContent = name;
  if($("#menu-user")) $("#menu-user").textContent = "@" + user.replace(/^@/,"");
  if($("#profile-card-name")) $("#profile-card-name").textContent = name;
  if($("#profile-card-handle")) $("#profile-card-handle").textContent = "@" + user.replace(/^@/,"");
  if($("#profile-role-badge")) $("#profile-role-badge").textContent = ACCOUNT.role;
  if($("#profile-status-badge")) $("#profile-status-badge").textContent = ACCOUNT.status;
}

function syncSwitchLabels(){
  $all(".switch-row").forEach(row=>{
    const input = row.querySelector("input[type=checkbox]");
    const tag = row.querySelector(".onoff");
    if(input && tag) tag.textContent = input.checked ? "ON" : "OFF";
  });
}

function showSettingsPane(id){
  const paneId = id || "profile";
  $all(".settings-nav-item").forEach(b=>{
    const on = b.dataset.settings === paneId;
    b.classList.toggle("active", on);
    if(on) b.setAttribute("aria-current","true"); else b.removeAttribute("aria-current");
  });
  $all(".settings-pane").forEach(p=>{
    p.classList.toggle("active", p.id === "settings-pane-" + paneId);
  });
  const pane = $("#settings-pane-" + paneId);
  if(pane && window.gsap){
    gsap.fromTo(pane, {opacity:0, y:8}, {opacity:1, y:0, duration:0.28, ease:"power2.out"});
  }
  pane?.scrollIntoView({behavior:"smooth", block:"nearest"});
}

function fillProfileForm(){
  $("#profile-name").value = ACCOUNT.displayName;
  $("#profile-username").value = ACCOUNT.username.replace(/^@/,"");
  $("#profile-email").value = ACCOUNT.email;
  $("#profile-role").value = ACCOUNT.role;
  $("#profile-status").value = ACCOUNT.status;
  ["profile-name","profile-username","profile-email"].forEach(id=> clearFieldError($("#"+id)));
}

function setProfileEditing(on){
  profileEditing = on;
  ["profile-name","profile-username","profile-email"].forEach(id=>{
    $("#"+id).disabled = !on;
  });
  $("#profile-form-actions").hidden = !on;
  $("#edit-profile-btn").textContent = on ? "Editing…" : "Edit Profile";
  $("#edit-profile-btn").disabled = on;
  if(on){
    profileSnapshot = {
      displayName: ACCOUNT.displayName,
      username: ACCOUNT.username,
      email: ACCOUNT.email,
    };
    $("#profile-name").focus();
  }
}

function hydrateSettings(){
  fillProfileForm();
  setProfileEditing(false);
  paintAvatars();
  $("#settings-library-name").value = CONFIG.libraryName;
  $("#settings-library-email").value = CONFIG.libraryEmail;
  $("#settings-library-phone").value = CONFIG.libraryPhone;
  $("#settings-library-address").value = CONFIG.libraryAddress;
  $("#settings-loan-days").value = CONFIG.loanDays;
  $("#settings-max-books").value = CONFIG.maxBooksPerUser;
  $("#settings-fine-rate").value = CONFIG.finePerDay;
  $("#settings-max-renewals").value = CONFIG.maxRenewals;
  $("#settings-fines-enabled").checked = !!CONFIG.overdueFinesEnabled;
  $("#notif-due").checked = !!NOTIF_PREFS.due;
  $("#notif-overdue").checked = !!NOTIF_PREFS.overdue;
  $("#notif-newuser").checked = !!NOTIF_PREFS.newUser;
  $("#notif-returns").checked = !!NOTIF_PREFS.returns;
  $("#notif-system").checked = !!NOTIF_PREFS.system;
  $("#sys-date-format").value = CONFIG.dateFormat;
  $("#sys-time-format").value = CONFIG.timeFormat;
  $("#sys-landing").value = CONFIG.landingPage || "dashboard";
  $("#sys-page-size").value = String(CONFIG.pageSize);
  $("#sys-density").value = CONFIG.density || "comfortable";
  $("#sys-confirm-delete").checked = !!CONFIG.confirmDeletes;
  if($("#security-last-login")) $("#security-last-login").textContent = fmtDateTime(ACCOUNT.lastLogin);
  applyTheme(localStorage.getItem(STORAGE.theme) || "light", false);
  applyDensity();
  syncSwitchLabels();
}

$all(".settings-nav-item").forEach(btn=>{
  btn.addEventListener("click", ()=> showSettingsPane(btn.dataset.settings));
});

$("#edit-profile-btn").addEventListener("click", ()=> setProfileEditing(true));
$("#profile-cancel-btn").addEventListener("click", ()=>{
  if(profileSnapshot){
    ACCOUNT.displayName = profileSnapshot.displayName;
    ACCOUNT.username = profileSnapshot.username;
    ACCOUNT.email = profileSnapshot.email;
  }
  fillProfileForm();
  paintAvatars();
  setProfileEditing(false);
  showToast("Profile edits discarded.", {kind:"info"});
});

$("#profile-form").addEventListener("submit", async e=>{
  e.preventDefault();
  if(!profileEditing) { setProfileEditing(true); return; }
  const name = $("#profile-name").value.trim();
  const username = $("#profile-username").value.trim().replace(/^@/,"");
  const email = $("#profile-email").value.trim();
  let ok = true;
  ["profile-name","profile-username","profile-email"].forEach(id=> clearFieldError($("#"+id)));
  if(name.length < 2) ok = setFieldError($("#profile-name"), "Enter a display name.");
  if(!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) ok = setFieldError($("#profile-username"), "Use 3–24 letters, numbers, dots or dashes.");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = setFieldError($("#profile-email"), "Enter a valid email.");
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#profile-save-btn");
  markSaving(btn, true);
  try {
    ACCOUNT.displayName = name;
    ACCOUNT.username = username;
    ACCOUNT.email = email;
    await persistAccount();
    paintAvatars();
    fillProfileForm();
    setProfileEditing(false);
    showToast("Profile updated successfully.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

function compressImageFile(file, cb){
  const reader = new FileReader();
  reader.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const min = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-min)/2, (img.height-min)/2, min, min, 0, 0, size, size);
      cb(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function applyAvatarData(dataUrl, preset){
  ACCOUNT.avatarDataUrl = dataUrl;
  ACCOUNT.avatarPreset = preset || null;
  try {
    await persistAccount();
    paintAvatars();
  } catch (err) {
    /* persistAccount already toasts */
  }
}

$("#avatar-edit-btn").addEventListener("click", ()=>{
  renderModal({
    title:"Profile photo",
    eyebrow:"Account",
    size:"modal-sm",
    bodyHtml:`
      <p class="settings-lead" style="margin-bottom:14px;">Upload a photo, pick a color, or return to initials. Saved to the admin account on the server.</p>
      <div class="preset-grid" id="avatar-presets">
        ${AVATAR_PRESETS.map(c=>`<button type="button" class="preset-swatch" data-preset="${c}" style="background:${c}" aria-label="Avatar color ${c}"></button>`).join("")}
      </div>`,
    footHtml:`
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-secondary" type="button" id="avatar-remove">Remove Photo</button>
      <button class="btn btn-primary" type="button" id="avatar-upload">Upload Photo</button>`,
    onMount:(modalEl)=>{
      $all(".preset-swatch", modalEl).forEach(sw=>{
        sw.addEventListener("click", ()=>{
          applyAvatarData(null, sw.dataset.preset);
          closeModal();
          showToast("Avatar updated.");
        });
      });
      $("#avatar-upload", modalEl).addEventListener("click", ()=> $("#avatar-file").click());
      $("#avatar-remove", modalEl).addEventListener("click", ()=>{
        closeModal();
        renderConfirm({
          title:"Remove profile photo?",
          body:"Initials will be shown instead of a photo.",
          confirmLabel:"Remove",
          onConfirm:()=>{
            applyAvatarData(null, null);
            showToast("Profile photo removed.", {kind:"info"});
          },
        });
      });
    },
  });
});

$("#avatar-file").addEventListener("change", e=>{
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!file) return;
  if(!file.type.startsWith("image/")){
    showToast("Please choose an image file.", {kind:"error"});
    return;
  }
  compressImageFile(file, url=>{
    applyAvatarData(url, null);
    closeModal();
    showToast("Profile photo updated.");
  });
});

$all(".theme-card").forEach(card=>{
  card.addEventListener("click", ()=>{
    applyTheme(card.dataset.themePref, true);
    showToast("Appearance preference saved.");
  });
});

$all(".switch-row input[type=checkbox]").forEach(input=>{
  input.addEventListener("change", syncSwitchLabels);
});

$("#settings-save-btn").addEventListener("click", async ()=>{
  const name = $("#settings-library-name").value.trim();
  const email = $("#settings-library-email").value.trim();
  const phone = $("#settings-library-phone").value.trim();
  const address = $("#settings-library-address").value.trim();
  const loanDays = parseInt($("#settings-loan-days").value,10);
  const maxBooks = parseInt($("#settings-max-books").value,10);
  const rate = parseFloat($("#settings-fine-rate").value);
  const renewals = parseInt($("#settings-max-renewals").value,10);
  let ok = true;
  ["settings-library-name","settings-library-email","settings-loan-days","settings-max-books","settings-fine-rate","settings-max-renewals"].forEach(id=> clearFieldError($("#"+id)));
  if(name.length < 2) ok = setFieldError($("#settings-library-name"), "Enter the library name.");
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = setFieldError($("#settings-library-email"), "Enter a valid email.");
  if(!(loanDays>=1)) ok = setFieldError($("#settings-loan-days"), "Must be at least 1 day.");
  if(!(maxBooks>=1)) ok = setFieldError($("#settings-max-books"), "Must be at least 1.");
  if(!(rate>=0)) ok = setFieldError($("#settings-fine-rate"), "Must be 0 or more.");
  if(!(renewals>=0)) ok = setFieldError($("#settings-max-renewals"), "Must be 0 or more.");
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#settings-save-btn");
  const prevConfig = Object.assign({}, CONFIG);
  markSaving(btn, true);
  try {
    CONFIG.libraryName = name;
    CONFIG.libraryEmail = email;
    CONFIG.libraryPhone = phone;
    CONFIG.libraryAddress = address;
    CONFIG.loanDays = loanDays;
    CONFIG.maxBooksPerUser = maxBooks;
    CONFIG.finePerDay = rate;
    CONFIG.maxRenewals = renewals;
    CONFIG.overdueFinesEnabled = $("#settings-fines-enabled").checked;
    await persistConfig();
    showToast("Library settings saved.");
  } catch (err) {
    Object.assign(CONFIG, prevConfig); // unsaved values must not drive fines or limits
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

$("#notif-prefs-save").addEventListener("click", async ()=>{
  NOTIF_PREFS.due = $("#notif-due").checked;
  NOTIF_PREFS.overdue = $("#notif-overdue").checked;
  NOTIF_PREFS.newUser = $("#notif-newuser").checked;
  NOTIF_PREFS.returns = $("#notif-returns").checked;
  NOTIF_PREFS.system = $("#notif-system").checked;
  const btn = $("#notif-prefs-save");
  markSaving(btn, true);
  try {
    await persistNotifs();
    showToast("Notification preferences updated.");
  } catch (err) {
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

function passwordScore(pw){
  let s = 0;
  if(pw.length >= 10) s++;
  if(/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if(/\d/.test(pw)) s++;
  if(/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
$("#sec-new-pass")?.addEventListener("input", ()=>{
  const pw = $("#sec-new-pass").value;
  const score = passwordScore(pw);
  const bar = $("#pw-meter-bar");
  const label = $("#pw-meter-label");
  if(bar) bar.style.width = (score/4*100) + "%";
  if(bar) bar.dataset.score = String(score);
  if(label) label.textContent = !pw ? "Use 10 or more characters." : ["Weak","Fair","Good","Strong"][Math.max(0,score-1)];
});
$all(".pw-toggle").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const input = $("#"+btn.dataset.pw);
    if(!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
  });
});
$("#sec-change-pass").addEventListener("click", ()=>{
  const cur = $("#sec-current-pass");
  const nw = $("#sec-new-pass");
  const cf = $("#sec-confirm-pass");
  [cur,nw,cf].forEach(clearFieldError);
  let ok = true;
  if(!cur.value) ok = setFieldError(cur, "Enter the current password.");
  if(nw.value.length < 10) ok = setFieldError(nw, "Use at least 10 characters.");
  if(nw.value !== cf.value) ok = setFieldError(cf, "Passwords do not match.");
  if(!ok){
    showToast("Please check the highlighted fields.", {kind:"error"});
    return;
  }
  const btn = $("#sec-change-pass");
  markSaving(btn, true);
  api("auth.php", {
    method:"POST",
    body:JSON.stringify({
      action:"password",
      currentPassword:cur.value,
      newPassword:nw.value,
      confirmPassword:cf.value,
    }),
  }).then(()=>{
    cur.value = nw.value = cf.value = "";
    if($("#pw-meter-bar")) $("#pw-meter-bar").style.width = "0";
    showToast("Password updated successfully.");
  }).catch(err=>{
    const f = err.fields || {};
    if(f.currentPassword) setFieldError(cur, f.currentPassword);
    if(f.newPassword) setFieldError(nw, f.newPassword);
    if(f.confirmPassword) setFieldError(cf, f.confirmPassword);
    showToast(Object.keys(f).length ? "Please check the highlighted fields." : err.message, {kind:"error"});
  }).finally(()=>{
    markSaving(btn, false);
  });
});
$("#sec-logout-one").addEventListener("click", ()=>{
  renderConfirm({
    title:"Sign out of this device?",
    body:"Your current staff session will be ended.",
    confirmLabel:"Sign out",
    onConfirm:signOutCurrentSession,
  });
});

$("#sys-save-btn").addEventListener("click", async ()=>{
  const prevConfig = Object.assign({}, CONFIG);
  CONFIG.dateFormat = $("#sys-date-format").value;
  CONFIG.timeFormat = $("#sys-time-format").value;
  CONFIG.landingPage = $("#sys-landing").value;
  CONFIG.pageSize = parseInt($("#sys-page-size").value,10) || 25;
  CONFIG.density = $("#sys-density").value;
  CONFIG.confirmDeletes = $("#sys-confirm-delete").checked;
  const btn = $("#sys-save-btn");
  markSaving(btn, true);
  try {
    await persistConfig();
    applyDensity();
    showToast("System preferences saved.");
  } catch (err) {
    Object.assign(CONFIG, prevConfig);
    showToast(err.message, {kind:"error"});
  } finally {
    markSaving(btn, false);
  }
});

$("#settings-reset-btn").addEventListener("click", ()=>{
  renderConfirm({
    title:"Reset settings to defaults?",
    body:"Library, system, notification and appearance preferences will be restored to their defaults. Your account (name, username, email, photo), books, patrons and transactions are not changed.",
    confirmLabel:"Reset settings",
    onConfirm: async ()=>{
      try {
        const saved = await api("settings.php", { method:"PUT", body: JSON.stringify({action:"reset"}) });
        if (saved.settings) Object.assign(CONFIG, saved.settings);
        Object.assign(NOTIF_PREFS, DEFAULT_NOTIFS);
        await persistNotifs();
        localStorage.setItem(STORAGE.theme, "light");
        applyTheme("light", true);
        applyDensity();
        hydrateSettings();
        refreshNotifications();
        showToast("Settings restored to defaults.");
      } catch (err) {
        showToast(err.message, {kind:"error"});
      }
    },
  });
});

/* hydrateSettings + paintAvatars run after bootstrapFromApi() */

/* ==================================================================
   GLOBAL SEARCH (topbar) → jumps to Books with the query applied
   ================================================================== */
$("#global-search").addEventListener("keydown", e=>{
  if(e.key==="Enter"){
    const q = e.target.value;
    state.books.search = q;
    state.books.category = "all";
    state.books.filters = emptyFilters();
    if(q.trim()) pushRecentSearch(q);
    goToView("books", {force:true, after:()=>{ $("#books-search").value = q; toggleSearchClear(); }});
  }
});

/* ==================================================================
   LOADING SEQUENCE + INIT
   ================================================================== */
function splitToChars(el){
  const text = el.textContent;
  el.innerHTML = text.split("").map(ch => `<span style="display:inline-block;">${ch===" "?"&nbsp;":ch}</span>`).join("");
  return el.querySelectorAll("span");
}

function playLoadingSequence(){
  if(reducedMotionQuery.matches){
    $("#loading-screen").style.display = "none";
    revealApp();
    return;
  }
  const line1 = splitToChars($("#loader-line-1 span"));
  const line2 = splitToChars($("#loader-line-2 span"));
  gsap.set([line1, line2], {opacity:0, y:26});

  const tl = gsap.timeline();
  tl.to(line1, {opacity:1, y:0, duration:0.35, stagger:0.015, ease:"power3.out"})
    .to(line2, {opacity:1, y:0, duration:0.35, stagger:0.012, ease:"power3.out"}, "-=0.25")
    .to("#loader-rule", {scaleX:1, duration:0.3, ease:"power2.out"}, "-=0.15")
    .to("#loader-sub", {opacity:1, duration:0.3}, "-=0.2")
    .to("#loading-screen", {duration:0.1}) // brief hold
    .to("#loading-screen", {
      opacity:0, duration:0.35, ease:"power2.inOut",
      onComplete:()=>{ document.getElementById("loading-screen").style.display = "none"; }
    })
    .call(revealApp, [], "-=0.2");
  return tl;
}

function revealApp(){
  const app = $("#app");
  app.style.visibility = "visible";
  gsap.to(app, {opacity:1, duration:0.3});
  paintAvatars();
  applyTheme(localStorage.getItem(STORAGE.theme) || "light", false);
  applyDensity();

  const tl = gsap.timeline();
  // clearProps:"transform" is required: GSAP otherwise leaves an inline
  // transform on .app-header after the tween, which creates a new
  // containing block for its position:fixed descendant (.menubar),
  // breaking the mobile slide-out nav (it collapses to the header's height
  // instead of spanning the viewport).
  tl.from(".app-header", {opacity:0, y:-14, duration:0.4, clearProps:"transform"});
  tl.from(".site-hero-copy", {opacity:0, y:18, duration:0.55, ease:"power2.out"}, "-=0.2");
  tl.from(".site-hero-visual", {opacity:0, y:18, duration:0.55, ease:"power2.out"}, "-=0.4");
  tl.call(()=>{
    renderDashboard();
    initScrollReveals();
    initEmblemParallax();
    const start = CONFIG.landingPage || "dashboard";
    if(start !== "dashboard") goToView(start, {force:true, silent:true});
  });
  wireMagnetic(document);
}

/* ==================================================================
   MOTION POLISH: header state on scroll, scroll-triggered reveals, emblem parallax,
   primary-button press feedback, bell nudge. Reduced-motion users get none of the movement,
   and no content is ever left hidden waiting for an animation.
   ================================================================== */
function initHeaderScroll(){
  const header = $("#app-header");
  if(!header) return;
  let queued = false, scrolled = false;
  // Two thresholds (hysteresis) so the state cannot flicker around a single scroll position.
  const update = ()=>{
    queued = false;
    const y = window.scrollY;
    if(!scrolled && y > 40) scrolled = true;
    else if(scrolled && y < 4) scrolled = false;
    header.classList.toggle("is-scrolled", scrolled);
  };
  window.addEventListener("scroll", ()=>{ if(!queued){ queued = true; requestAnimationFrame(update); } }, {passive:true});
  update();
}

/* Homepage sections ease in the first time they scroll into view. The hidden starting state is only applied when
   IntersectionObserver exists and motion is allowed, so nothing can stay invisible. */
let scrollRevealsReady = false;
function initScrollReveals(){
  if(scrollRevealsReady || !("IntersectionObserver" in window) || reducedMotionQuery.matches) return;
  const root = $("#view-dashboard");
  if(!root) return;
  scrollRevealsReady = true;
  const units = [];
  $all(".site-section-head, .library-photo-frame", root).forEach(el=> units.push({el, targets:[el]}));
  const grid = $(".services-grid", root);
  if(grid) units.push({el:grid, targets:$all(".service-card", grid)});
  const statement = $(".editorial-statement", root);
  if(statement) units.push({el:statement, targets:Array.from(statement.children)});
  const foot = $(".site-footer-top", root);
  if(foot) units.push({el:foot, targets:Array.from(foot.children)});
  units.forEach(u=> gsap.set(u.targets, {opacity:0, y:28}));
  const io = new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(!en.isIntersecting) return;
      io.unobserve(en.target);
      const u = units.find(x=> x.el === en.target);
      if(u) gsap.to(u.targets, {opacity:1, y:0, duration:0.7, stagger:0.08, ease:"power2.out", clearProps:"opacity,transform"});
    });
  }, {threshold:0.15, rootMargin:"0px 0px -6% 0px"});
  units.forEach(u=> io.observe(u.el));
}

/* The Tamaraw emblem drifts a few pixels toward the pointer (desktop pointers only). Its idle float is pure CSS. */
let emblemParallaxReady = false;
function initEmblemParallax(){
  if(emblemParallaxReady) return;
  const hero = $("#site-hero"), emblem = $(".hero-emblem");
  if(!hero || !emblem || reducedMotionQuery.matches || typeof gsap.quickTo !== "function") return;
  if(!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  emblemParallaxReady = true;
  const qx = gsap.quickTo(emblem, "x", {duration:0.9, ease:"power3.out"});
  const qy = gsap.quickTo(emblem, "y", {duration:0.9, ease:"power3.out"});
  hero.addEventListener("mousemove", e=>{
    const r = hero.getBoundingClientRect();
    qx(((e.clientX - r.left) / r.width - 0.5) * 18);
    qy(((e.clientY - r.top) / r.height - 0.5) * 12);
  });
  hero.addEventListener("mouseleave", ()=>{ qx(0); qy(0); });
}

/* Primary buttons already carry a GSAP transform (magnetic hover), which beats CSS :active, so press feedback is a tween. */
function wirePressFeedback(){
  let pressed = null;
  document.addEventListener("pointerdown", e=>{
    if(reducedMotionQuery.matches || e.button > 0) return;
    const b = e.target.closest ? e.target.closest(".btn-primary") : null;
    if(!b || b.disabled) return;
    pressed = b;
    gsap.to(b, {scale:0.96, duration:0.1, ease:"power2.out"});
  });
  const release = ()=>{
    if(!pressed) return;
    const b = pressed;
    pressed = null;
    gsap.to(b, {scale:1, duration:0.4, ease:"back.out(2.2)",
      onComplete:()=>{ if(!b.matches(":hover")) gsap.set(b, {clearProps:"transform"}); }});
  };
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
}

/* A short bell wiggle when the notification set changes (the dot's pulse is CSS). */
function nudgeBell(){
  if(reducedMotionQuery.matches) return;
  const icon = $("#notif-btn svg");
  if(!icon) return;
  gsap.timeline()
    .to(icon, {rotate:14, transformOrigin:"50% 0%", duration:0.08})
    .to(icon, {rotate:-12, duration:0.1})
    .to(icon, {rotate:8, duration:0.1})
    .to(icon, {rotate:0, duration:0.14, clearProps:"transform"});
}

initHeaderScroll();
wirePressFeedback();

/* Keyboard: '/' focuses global search when not typing elsewhere */
document.addEventListener("keydown", e=>{
  if(e.key!=="/" || e.ctrlKey || e.metaKey || e.altKey || scrollLockCount>0) return;
  const a = document.activeElement, tag = a ? a.tagName : "";
  if(tag==="INPUT" || tag==="TEXTAREA" || tag==="SELECT" || (a && a.isContentEditable)) return;
  if(getComputedStyle($("#app")).visibility === "hidden") return; // sign-in screen
  e.preventDefault();
  const field = $("#global-search");
  if(!field.offsetParent) $("#search-toggle-btn")?.click(); // narrow screens: reveal the field first
  else field.focus();
});

/* Boot */
function showLoginScreen(message=""){
  syncThemeFromStorage();
  $("#loading-screen").style.display = "none";
  $("#app").style.visibility = "hidden";
  $("#login-screen").hidden = false;
  $("#login-username")?.focus();
  const error = $("#login-error");
  error.textContent = message;
  error.hidden = !message;
}

$("#login-form").addEventListener("submit", async e=>{
  e.preventDefault();
  const form = e.currentTarget;
  const button = $("#login-submit");
  const error = $("#login-error");
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  error.textContent = "";
  error.hidden = true;
  button.disabled = true;
  button.classList.add("is-saving");
  button.textContent = "Signing in…";
  try {
    await api("auth.php", {
      method:"POST",
      body:JSON.stringify({action:"login", username, password}),
    });
    await bootstrapFromApi();
    sessionExpiredHandled = false;
    hydrateSettings();
    paintAvatars();
    $("#login-password").value = "";
    $("#login-screen").hidden = true;
    revealApp();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.classList.remove("is-saving");
    button.textContent = "Sign in";
  }
});

window.addEventListener("load", async ()=>{
  try {
    const auth = await api("auth.php?action=status");
    if (!auth.authenticated) {
      showLoginScreen();
      return;
    }
    await bootstrapFromApi();
    hydrateSettings();
    paintAvatars();
    $("#login-password").value = "";
    playLoadingSequence();
  } catch (err) {
    console.error(err);
    showLoginScreen(`Could not connect to the library service: ${err.message}`);
  }
});