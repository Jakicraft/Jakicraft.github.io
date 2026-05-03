// ═══════════════════════════════════════════
//  GM DICE COUNTDOWN — index.js
// ═══════════════════════════════════════════

import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, set, off }    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ═══════════════════════════════════════════
//  FIREBASE CONFIG
// ═══════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyCDd9PI40-kn51MmeuR21j45fwGIO6Tr3M",
  authDomain:        "dh-dice-countdown.firebaseapp.com",
  databaseURL:       "https://dh-dice-countdown-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "dh-dice-countdown",
  storageBucket:     "dh-dice-countdown.firebasestorage.app",
  messagingSenderId: "582684616489",
  appId:             "1:582684616489:web:4ed0efb0a9bfc05a13b938"
};

// ═══════════════════════════════════════════
//  DIE SHAPES
// ═══════════════════════════════════════════

function regularPoly(cx, cy, r, n, a0 = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (2 * Math.PI * i) / n;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
}

const SHAPES = {
  2:   { type: 'ellipse', rx: 85, ry: 85 },
  4:   { type: 'polygon', pts: () => regularPoly(120, 114, 95, 3, -Math.PI / 2) },
  6:   { type: 'polygon', pts: () => regularPoly(120, 120, 88, 4, -Math.PI / 4) },
  8:   { type: 'polygon', pts: () => `120,25 215,120 120,215 25,120` },
  10:  { type: 'polygon', pts: () => `120,${120-95} ${120+70},${120+23} 120,${120+63} ${120-70},${120+23}` },
  12:  { type: 'polygon', pts: () => regularPoly(120, 120, 92, 5, -Math.PI / 2) },
  20:  { type: 'polygon', pts: () => regularPoly(120, 120, 92, 6, 0) },
  100: { type: 'ellipse', rx: 88, ry: 88 },
};

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════

let sides = 4, value = 4, goal = 4;
let room  = location.hash.replace('#', '').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';

// Room list is synced from Firebase — everyone sees the same list
let sharedRooms = ['default'];

const maxVal = () => sides + 1;
const clampV = v => Math.max(1, Math.min(maxVal(), v));
const clampG = g => Math.max(1, Math.min(maxVal(), g));

// ═══════════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════════

const $ = id => document.getElementById(id);

const syncBar         = $('syncBar');
const syncLabel       = $('syncLabel');
const dieSvg          = $('die-svg');
const dieGroup        = $('die-group');
const dieValueEl      = $('die-value');
const dieGoalLbl      = $('die-goal-label');
const valueBadge      = $('valueBadge');
const progressFill    = $('progressFill');
const goalNotch       = $('goalNotch');
const triggeredBanner = $('triggeredBanner');
const rangeInfo       = $('rangeInfo');
const startInput      = $('startInput');
const goalInput       = $('goalInput');
const progCenter      = $('prog-center');
const progGoalLbl     = $('prog-goal-label');
const activeRoomBadge = $('activeRoomBadge');
const sidebar         = $('sidebar');
const sidebarOverlay  = $('sidebarOverlay');
const sidebarToggle   = $('sidebarToggle');
const sidebarClose    = $('sidebarClose');
const roomList        = $('roomList');
const newRoomInput    = $('newRoomInput');
const addRoomBtn      = $('addRoomBtn');

// ═══════════════════════════════════════════
//  SYNC STATUS
// ═══════════════════════════════════════════

function setSyncStatus(cls, text) {
  syncBar.className = 'sync-bar ' + cls;
  syncLabel.textContent = text;
}

// ═══════════════════════════════════════════
//  FIREBASE
// ═══════════════════════════════════════════

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Two Firebase paths:
//   /roomList         → shared list of room names (array), visible to everyone
//   /rooms/{name}     → the dice state for each room
const roomListRef = ref(db, 'roomList');

let currentRef    = null;
let isLocalChange = false;

// ── Listen to the shared room list ──────────────────────────
// This fires for everyone whenever any client adds/removes a room.
onValue(roomListRef, (snapshot) => {
  const data = snapshot.val();
  if (Array.isArray(data) && data.length > 0) {
    sharedRooms = data;
  } else {
    // First ever load — initialise with default room
    sharedRooms = ['default'];
    set(roomListRef, sharedRooms);
  }
  renderRoomList();
});

// ── Push updated room list to Firebase ──────────────────────
function pushRoomList() {
  set(roomListRef, sharedRooms);
  // onValue will fire for all clients, including us — renderRoomList handles it
}

// ── Subscribe to a room's dice state ────────────────────────
function subscribeToRoom(roomName) {
  if (currentRef) off(currentRef);

  room = roomName;
  location.hash = roomName;
  activeRoomBadge.textContent = roomName;
  setSyncStatus('syncing', `Connecting to room: ${roomName}…`);

  // Make sure this room is in the shared list
  if (!sharedRooms.includes(roomName)) {
    sharedRooms.unshift(roomName);
    pushRoomList();           // everyone's sidebar updates instantly
  }

  currentRef = ref(db, `rooms/${roomName}`);

  onValue(currentRef, (snapshot) => {
    if (isLocalChange) return;

    const data = snapshot.val();
    if (data) {
      sides = data.sides ?? sides;
      value = data.value ?? value;
      goal  = data.goal  ?? goal;
      drawDie();
      render(/* push= */ false);
      setSyncStatus('connected', `Connected · ${roomName}`);
    } else {
      setSyncStatus('connected', `New room: ${roomName}`);
      pushState();
    }
  }, (err) => {
    setSyncStatus('error', 'Error: ' + err.message);
    console.error(err);
  });
}

// ── Push dice state ──────────────────────────────────────────
function pushState() {
  if (!currentRef) return;
  isLocalChange = true;
  set(currentRef, { sides, value, goal })
    .catch(e => {
      setSyncStatus('error', 'Write error — check DB rules');
      console.error(e);
    })
    .finally(() => setTimeout(() => { isLocalChange = false; }, 300));
}

// ═══════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════

function openSidebar()  {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('visible');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
}

function renderRoomList() {
  roomList.innerHTML = '';
  sharedRooms.forEach(name => {
    const item  = document.createElement('div');
    item.className = 'room-item' + (name === room ? ' active' : '');

    const dot   = document.createElement('div');
    dot.className = 'room-item-dot';

    const label = document.createElement('span');
    label.className   = 'room-item-name';
    label.textContent = name;

    const del   = document.createElement('button');
    del.className   = 'room-item-del';
    del.title       = 'Remove room';
    del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      deleteRoom(name);
    });

    item.append(dot, label, del);
    item.addEventListener('click', () => {
      subscribeToRoom(name);
      closeSidebar();
    });

    roomList.appendChild(item);
  });
}

function addRoom() {
  const name = newRoomInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!name) return;
  newRoomInput.value = '';

  if (!sharedRooms.includes(name)) {
    sharedRooms.unshift(name);
    pushRoomList();   // ← all connected clients see the new room immediately
  }
  subscribeToRoom(name);
  closeSidebar();
}

function deleteRoom(name) {
  sharedRooms = sharedRooms.filter(r => r !== name);
  if (sharedRooms.length === 0) sharedRooms = ['default'];
  pushRoomList();   // ← all clients see the room disappear immediately

  // If we deleted our current room, switch to the first available
  if (name === room) subscribeToRoom(sharedRooms[0]);
}

sidebarToggle.addEventListener('click', openSidebar);
sidebarClose.addEventListener ('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);
addRoomBtn.addEventListener   ('click', addRoom);
newRoomInput.addEventListener ('keydown', e => { if (e.key === 'Enter') addRoom(); });

// ═══════════════════════════════════════════
//  DRAW DIE SHAPE
// ═══════════════════════════════════════════

function drawDie() {
  dieGroup.innerHTML = '';
  const def = SHAPES[sides];
  let shape;

  if (def.type === 'ellipse') {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    shape.setAttribute('cx', 120); shape.setAttribute('cy', 120);
    shape.setAttribute('rx', def.rx); shape.setAttribute('ry', def.ry);
  } else {
    shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    shape.setAttribute('points', def.pts());
  }

  shape.setAttribute('fill', '#1a1525');
  shape.setAttribute('stroke', '#4a3a6a');
  shape.setAttribute('stroke-width', '2');
  shape.setAttribute('stroke-linejoin', 'round');
  dieGroup.appendChild(shape);

  if (def.type !== 'ellipse') {
    const arr = def.pts().split(' ');
    if (arr.length >= 2) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const p0 = arr[0].split(','), p1 = arr[1].split(',');
      line.setAttribute('x1', p0[0]); line.setAttribute('y1', p0[1]);
      line.setAttribute('x2', p1[0]); line.setAttribute('y2', p1[1]);
      line.setAttribute('stroke', '#6a508a');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('opacity', '0.5');
      dieGroup.appendChild(line);
    }
  }
}

// ═══════════════════════════════════════════
//  RENDER UI
// ═══════════════════════════════════════════

function render(push = true) {
  value = clampV(value);
  goal  = clampG(goal);
  const max    = maxVal();
  const atGoal = value === goal;

  dieValueEl.textContent = value;
  const len = String(value).length;
  dieValueEl.setAttribute('font-size', len >= 3 ? 34 : len === 2 ? 50 : 64);
  dieValueEl.setAttribute('y', '112');
  dieValueEl.style.fill   = atGoal ? '#40e080' : value === 1 ? '#e06060' : '';
  dieValueEl.style.filter = atGoal
    ? 'drop-shadow(0 0 10px #40e08099)'
    : value === 1 ? 'drop-shadow(0 0 8px #e0404088)' : '';

  dieGoalLbl.textContent = `⚑ GOAL: ${goal}`;
  dieGoalLbl.style.fill  = atGoal ? '#40e080' : '#30a060';

  valueBadge.textContent = `${value} / ${max}`;
  valueBadge.style.color = atGoal ? 'var(--green-glow)' : '';

  const pct     = max > 1 ? ((value - 1) / (max - 1)) * 100 : 100;
  const goalPct = max > 1 ? ((goal  - 1) / (max - 1)) * 100 : 100;
  progressFill.style.width = `${pct}%`;
  progressFill.classList.toggle('at-goal', atGoal);
  goalNotch.style.left = `calc(${goalPct}% - 1px)`;

  progCenter.textContent  = `${value} / ${max}`;
  progGoalLbl.textContent = `⚑ ${goal}`;
  triggeredBanner.classList.toggle('visible', atGoal);

  document.querySelectorAll('.die-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.sides) === sides)
  );

  startInput.value = value;
  goalInput.value  = goal;
  rangeInfo.textContent = `Value & Goal: 1 – ${max}  (d${sides}+1 max)  |  ← → to adjust`;

  if (push) pushState();
}

// ═══════════════════════════════════════════
//  FLASH ANIMATION
// ═══════════════════════════════════════════

function flash(type = 'gold') {
  dieSvg.classList.remove('flash', 'flash-red', 'flash-green', 'bump');
  void dieSvg.offsetWidth;
  dieSvg.classList.add(
    type === 'red' ? 'flash-red' : type === 'green' ? 'flash-green' : 'flash',
    'bump'
  );
  setTimeout(() => dieSvg.classList.remove('flash', 'flash-red', 'flash-green', 'bump'), 350);
}

// ═══════════════════════════════════════════
//  ACTIONS
// ═══════════════════════════════════════════

function decrease() {
  if (value <= 1) { flash('red'); return; }
  value--;
  render();
  flash(value === goal ? 'green' : 'gold');
}

function increase() {
  if (value >= maxVal()) { flash('red'); return; }
  value++;
  render();
  flash(value === goal ? 'green' : 'gold');
}

function applyValue() {
  const v = parseInt(startInput.value);
  value = clampV(isNaN(v) ? 1 : v);
  render();
  flash(value === goal ? 'green' : 'gold');
}

function applyGoal() {
  const g = parseInt(goalInput.value);
  goal = clampG(isNaN(g) ? sides : g);
  render();
  flash(value === goal ? 'green' : 'gold');
}

function setDieType(s) {
  sides = s;
  value = clampV(value);
  goal  = clampG(goal);
  drawDie();
  render();
  flash('gold');
}

// ═══════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════

$('diceSelector').addEventListener('click', e => {
  const btn = e.target.closest('.die-btn');
  if (btn) setDieType(parseInt(btn.dataset.sides));
});

$('btnDec').addEventListener('click', decrease);
$('btnInc').addEventListener('click', increase);
$('setBtn').addEventListener('click', applyValue);
$('setGoalBtn').addEventListener('click', applyGoal);

startInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyValue(); });
goalInput.addEventListener ('keydown', e => { if (e.key === 'Enter') applyGoal(); });

document.addEventListener('keydown', e => {
  if ([startInput, goalInput, newRoomInput].includes(e.target)) return;
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown')  decrease();
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp')    increase();
});

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════

drawDie();
render(false);
// Room list and initial room subscription happen once onValue(roomListRef) fires above
subscribeToRoom(room);
