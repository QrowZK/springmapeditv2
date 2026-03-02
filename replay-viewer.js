/**
 * Zero-K Replay Viewer - Canvas-based 2D visualization
 * Renders individual units with role-based icons, order lines, buildings,
 * and supports pan/zoom/resize.
 */

// Player/ally-team colors
const PLAYER_COLORS = [
    '#4ecdc4', '#ff6b6b', '#ffe66d', '#a8e6cf',
    '#dda0dd', '#87ceeb', '#ffa07a', '#98fb98',
];

const COMMAND_COLORS = {
    move:   '#4ecdc4',
    attack: '#ff6b6b',
    build:  '#ffe66d',
    patrol: '#a8e6cf',
    other:  '#888888',
    spawn:  '#ffffff',
};

// ── State ─────────────────────────────────────────────────────────────
let replayData = null;
let mapImage = null;
let canvas, ctx;
let viewMode = 'units';        // units | heatmap | trails
let isPlaying = false;
let playbackTime = 0;
let playbackSpeed = 1;
let lastFrameTime = 0;
let animFrameId = null;

// View transform (pan & zoom)
let vt = { x: 0, y: 0, scale: 1 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let vtStart = { x: 0, y: 0 };

let mapBounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };

let filters = {
    move: true, attack: true, build: true, patrol: true,
    other: true, startpos: true, mapdraw: true, orderlines: true,
};

// Sidebar resize
let sidebarWidth = 320;
let isResizingSidebar = false;

// ── Initialization ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
    canvas = document.getElementById('replayCanvas');
    ctx = canvas.getContext('2d');
    setupCanvasSize();
    setupEventListeners();
    setupSidebarResize();
    render();
}

function setupCanvasSize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

// ── Event listeners ───────────────────────────────────────────────────
function setupEventListeners() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput  = document.getElementById('fileInput');

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
        e.preventDefault(); uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => {
        if (e.target.files.length) loadFile(e.target.files[0]);
    });

    document.getElementById('timeline').addEventListener('input', e => {
        if (replayData) { playbackTime = (parseFloat(e.target.value) / 100) * replayData.maxGameTime; render(); }
    });

    document.querySelectorAll('#filterGroup input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', e => { filters[e.target.dataset.filter] = e.target.checked; render(); });
    });

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);

    window.addEventListener('resize', () => { setupCanvasSize(); render(); });
}

// ── Sidebar resize ────────────────────────────────────────────────────
function setupSidebarResize() {
    const handle = document.getElementById('resizeHandle');
    const sidebar = document.querySelector('.sidebar');
    if (!handle) return;

    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        isResizingSidebar = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
        if (!isResizingSidebar) return;
        const newW = Math.max(200, Math.min(600, e.clientX));
        sidebar.style.width = newW + 'px';
        sidebar.style.minWidth = newW + 'px';
        sidebarWidth = newW;
        setupCanvasSize();
        render();
    });

    document.addEventListener('mouseup', () => {
        if (isResizingSidebar) {
            isResizingSidebar = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// ── File loading ──────────────────────────────────────────────────────
async function loadFile(file) {
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.remove('hidden');
    overlay.textContent = 'Parsing replay...';
    document.getElementById('emptyState').style.display = 'none';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const parser = new ReplayParser();
        replayData = parser.parse(arrayBuffer);

        overlay.textContent = 'Loading map image...';
        await loadMapImage(replayData.mapName);

        computeMapBounds();
        resetView();
        updateUI();

        playbackTime = replayData.maxGameTime;
        document.getElementById('timeline').value = 100;
        updateTimeDisplay();

        overlay.classList.add('hidden');
        render();
    } catch (err) {
        overlay.textContent = `Error: ${err.message}`;
        console.error('Parse error:', err);
        setTimeout(() => overlay.classList.add('hidden'), 3000);
    }
}

async function loadMapImage(mapName) {
    const urls = [
        `https://zero-k.info/Resources/${encodeURIComponent(mapName)}.minimap.jpg`,
        `https://zero-k.info/Resources/${mapName}.minimap.jpg`,
        `https://zero-k.info/Resources/${mapName.replace(/ /g, '_')}.minimap.jpg`,
    ];
    for (const url of urls) {
        try { const img = await tryLoadImage(url); if (img) { mapImage = img; return; } } catch {}
    }
    console.warn('Could not load map image for:', mapName);
    mapImage = null;
}

function tryLoadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            const img2 = new Image();
            img2.onload = () => resolve(img2);
            img2.onerror = () => resolve(null);
            img2.src = url;
        };
        img.src = url;
    });
}

// ── Coordinate transforms ─────────────────────────────────────────────
function computeMapBounds() {
    if (!replayData) return;
    let maxX = -Infinity, maxZ = -Infinity;
    for (const sp of replayData.startPositions) {
        if (sp.x !== 0 || sp.z !== 0) { maxX = Math.max(maxX, sp.x); maxZ = Math.max(maxZ, sp.z); }
    }
    for (const cmd of replayData.commands) { maxX = Math.max(maxX, cmd.x); maxZ = Math.max(maxZ, cmd.z); }
    if (maxX === -Infinity) { maxX = 8192; maxZ = 8192; }
    maxX = Math.ceil(maxX / 512) * 512;
    maxZ = Math.ceil(maxZ / 512) * 512;
    if (maxX < 1024) maxX = 8192;
    if (maxZ < 1024) maxZ = 8192;
    mapBounds = { minX: 0, minZ: 0, maxX, maxZ };
}

function resetView() {
    if (!canvas) return;
    const mapW = mapBounds.maxX, mapH = mapBounds.maxZ;
    const scale = Math.min(canvas.width / mapW, canvas.height / mapH) * 0.95;
    vt = { x: (canvas.width - mapW * scale) / 2, y: (canvas.height - mapH * scale) / 2, scale };
}

function m2s(x, z) {
    return { sx: x * vt.scale + vt.x, sy: z * vt.scale + vt.y };
}
function s2m(sx, sy) {
    return { x: (sx - vt.x) / vt.scale, z: (sy - vt.y) / vt.scale };
}

// ── Unit position estimation ──────────────────────────────────────────
// For a unit at a given time, find its best-estimated position by looking
// at the events array (sorted by time). Position = last command target
// before or at the current time, with linear interpolation toward the next.
function getUnitPosition(unit, time) {
    const events = unit.events;
    if (!events.length) return null;

    // Find the last event at or before the given time
    let lastIdx = -1;
    for (let i = 0; i < events.length; i++) {
        if (events[i].gameTime <= time) lastIdx = i;
        else break;
    }

    if (lastIdx < 0) return null; // unit not yet seen

    const ev = events[lastIdx];
    if (ev.x === undefined) return null;

    // Simple interpolation toward next command position
    if (lastIdx < events.length - 1) {
        const next = events[lastIdx + 1];
        if (next.x !== undefined && next.gameTime > ev.gameTime) {
            // Estimate travel: assume 2 map-units/sec for mobile, 0 for builders
            const speed = (unit.role === 'commander' || unit.role === 'builder') ? 100 : 200;
            const dx = next.x - ev.x, dz = next.z - ev.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const travelTime = dist / speed;
            const elapsed = time - ev.gameTime;
            const t = Math.min(1, elapsed / Math.max(travelTime, 0.1));
            return { x: ev.x + dx * t, z: ev.z + dz * t };
        }
    }

    return { x: ev.x, z: ev.z };
}

// Get the current order (last event) for a unit at time
function getUnitCurrentOrder(unit, time) {
    const events = unit.events;
    let lastEvent = null;
    for (const e of events) {
        if (e.gameTime <= time) lastEvent = e;
        else break;
    }
    return lastEvent;
}

// ── Rendering ─────────────────────────────────────────────────────────
function render() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!replayData) return;

    drawMapBackground();

    switch (viewMode) {
        case 'units': drawUnits(); break;
        case 'heatmap': drawHeatmap(); break;
        case 'trails': drawTrails(); break;
    }

    if (filters.mapdraw) drawMapDrawings();
}

function drawMapBackground() {
    const tl = m2s(mapBounds.minX, mapBounds.minZ);
    const br = m2s(mapBounds.maxX, mapBounds.maxZ);
    const w = br.sx - tl.sx, h = br.sy - tl.sy;

    if (mapImage) {
        ctx.drawImage(mapImage, tl.sx, tl.sy, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(tl.sx, tl.sy, w, h);
    } else {
        ctx.fillStyle = '#111122';
        ctx.fillRect(tl.sx, tl.sy, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= mapBounds.maxX; gx += 512) {
            const { sx } = m2s(gx, 0);
            ctx.beginPath(); ctx.moveTo(sx, tl.sy); ctx.lineTo(sx, br.sy); ctx.stroke();
        }
        for (let gz = 0; gz <= mapBounds.maxZ; gz += 512) {
            const { sy } = m2s(0, gz);
            ctx.beginPath(); ctx.moveTo(tl.sx, sy); ctx.lineTo(br.sx, sy); ctx.stroke();
        }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.sx, tl.sy, w, h);
}

// ── Icon drawing helpers ──────────────────────────────────────────────
function drawUnitIcon(sx, sy, size, role, color, alpha) {
    ctx.globalAlpha = alpha;
    switch (role) {
        case 'commander':
            drawStar(sx, sy, size, color);
            break;
        case 'builder':
            drawWrench(sx, sy, size, color);
            break;
        case 'combat':
            drawTriangle(sx, sy, size, color);
            break;
        default: // mobile, unknown
            drawCircleIcon(sx, sy, size, color);
            break;
    }
    ctx.globalAlpha = 1;
}

function drawStar(sx, sy, r, color) {
    const spikes = 5, outer = r, inner = r * 0.45;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (i * Math.PI / spikes) - Math.PI / 2;
        const px = sx + Math.cos(angle) * radius;
        const py = sy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawTriangle(sx, sy, r, color) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx + r * 0.87, sy + r * 0.5);
    ctx.lineTo(sx - r * 0.87, sy + r * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawWrench(sx, sy, r, color) {
    // Square with inner dot for builder/constructor
    const half = r * 0.7;
    ctx.fillStyle = color;
    ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - half, sy - half, half * 2, half * 2);
    // inner gear-like dot
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
}

function drawCircleIcon(sx, sy, r, color) {
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawBuildingIcon(sx, sy, size, color) {
    const half = size * 0.5;
    ctx.fillStyle = hexToRGBA(color, 0.6);
    ctx.fillRect(sx - half, sy - half, size, size);
    ctx.strokeStyle = hexToRGBA(color, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - half, sy - half, size, size);
}

// ── Draw units mode ───────────────────────────────────────────────────
function drawUnits() {
    if (!replayData) return;

    // 1) Draw buildings that have been placed by current time
    if (filters.build) {
        for (const b of replayData.buildings) {
            if (b.gameTime > playbackTime) continue;
            const { sx, sy } = m2s(b.x, b.z);
            const color = getPlayerColor(b.playerNum);
            drawBuildingIcon(sx, sy, 6, color);
        }
    }

    // 2) Collect active units and their positions
    const activeUnits = [];
    for (const [uid, unit] of replayData.units) {
        if (unit.firstSeen > playbackTime) continue;
        const pos = getUnitPosition(unit, playbackTime);
        if (!pos) continue;
        activeUnits.push({ uid, unit, pos });
    }

    // 3) Draw order lines first (behind units)
    if (filters.orderlines) {
        drawOrderLines(activeUnits);
    }

    // 4) Draw each unit icon
    for (const { uid, unit, pos } of activeUnits) {
        const { sx, sy } = m2s(pos.x, pos.z);
        const color = getPlayerColor(unit.playerNum);
        const size = unit.isCommander ? 10 : (unit.role === 'builder' ? 6 : 5);

        // Fade units that haven't been seen recently
        const age = playbackTime - unit.lastSeen;
        const alpha = age > 60 ? 0.2 : age > 30 ? 0.5 : 1.0;

        drawUnitIcon(sx, sy, size, unit.role, color, alpha);
    }

    // 5) Draw start position labels (always on top)
    if (filters.startpos) drawStartPositions();
}

function drawOrderLines(activeUnits) {
    // Draw lines from each unit's current position to its current order target
    // Only show for recent commands (within last 10 seconds)
    const ORDER_AGE_LIMIT = 15;

    for (const { uid, unit, pos } of activeUnits) {
        const order = getUnitCurrentOrder(unit, playbackTime);
        if (!order || order.x === undefined) continue;
        if (order.category === 'spawn') continue;

        const age = playbackTime - order.gameTime;
        if (age > ORDER_AGE_LIMIT) continue;

        // Skip if order position is same as unit position (close enough)
        const dx = order.x - pos.x, dz = order.z - pos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 20) continue;

        // Skip categories the user has filtered out
        if (!filters[order.category]) continue;

        const from = m2s(pos.x, pos.z);
        const to   = m2s(order.x, order.z);
        const color = COMMAND_COLORS[order.category] || COMMAND_COLORS.other;
        const alpha = Math.max(0.1, 0.6 * (1 - age / ORDER_AGE_LIMIT));

        ctx.beginPath();
        ctx.moveTo(from.sx, from.sy);
        ctx.lineTo(to.sx, to.sy);
        ctx.strokeStyle = hexToRGBA(color, alpha);
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(to.sy - from.sy, to.sx - from.sx);
        const arrowLen = 6;
        ctx.beginPath();
        ctx.moveTo(to.sx, to.sy);
        ctx.lineTo(to.sx - arrowLen * Math.cos(angle - 0.4), to.sy - arrowLen * Math.sin(angle - 0.4));
        ctx.lineTo(to.sx - arrowLen * Math.cos(angle + 0.4), to.sy - arrowLen * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = hexToRGBA(color, alpha);
        ctx.fill();
    }
}

function drawStartPositions() {
    if (!replayData) return;
    const finalPositions = {};
    for (const sp of replayData.startPositions) {
        if (sp.gameTime <= playbackTime && (sp.x !== 0 || sp.z !== 0)) {
            finalPositions[sp.playerNum] = sp;
        }
    }
    for (const [playerNum, sp] of Object.entries(finalPositions)) {
        const { sx, sy } = m2s(sp.x, sp.z);
        const color = getPlayerColor(parseInt(playerNum));
        const player = replayData.players.find(p => p.index === parseInt(playerNum));

        // Outer glow
        ctx.beginPath();
        ctx.arc(sx, sy, 16, 0, Math.PI * 2);
        ctx.fillStyle = hexToRGBA(color, 0.15);
        ctx.fill();

        // Player name label
        if (player) {
            ctx.font = 'bold 11px sans-serif';
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 3;
            ctx.strokeText(player.name, sx + 18, sy + 4);
            ctx.fillText(player.name, sx + 18, sy + 4);
        }
    }
}

// ── Trails mode (historical view) ─────────────────────────────────────
function drawTrails() {
    if (!replayData) return;

    // Draw unit movement trails
    for (const [uid, unit] of replayData.units) {
        const events = unit.events.filter(e => e.gameTime <= playbackTime && e.x !== undefined);
        if (events.length < 2) continue;

        const color = getPlayerColor(unit.playerNum);
        ctx.strokeStyle = hexToRGBA(color, 0.25);
        ctx.lineWidth = unit.isCommander ? 2 : 1;
        ctx.beginPath();

        let prevTime = -999;
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const { sx, sy } = m2s(e.x, e.z);
            if (i === 0 || e.gameTime - prevTime > 10) {
                ctx.moveTo(sx, sy);
            } else {
                ctx.lineTo(sx, sy);
            }
            prevTime = e.gameTime;
        }
        ctx.stroke();
    }

    // Draw buildings
    if (filters.build) {
        for (const b of replayData.buildings) {
            if (b.gameTime > playbackTime) continue;
            const { sx, sy } = m2s(b.x, b.z);
            const color = getPlayerColor(b.playerNum);
            drawBuildingIcon(sx, sy, 5, color);
        }
    }

    if (filters.startpos) drawStartPositions();
}

// ── Heatmap mode ──────────────────────────────────────────────────────
function drawHeatmap() {
    const cmds = replayData.commands.filter(c => c.gameTime <= playbackTime && filters[c.category]);
    if (!cmds.length) return;

    const tl = m2s(0, 0), br = m2s(mapBounds.maxX, mapBounds.maxZ);
    const w = Math.floor(br.sx - tl.sx), h = Math.floor(br.sy - tl.sy);
    if (w <= 0 || h <= 0) return;

    const res = 2;
    const gW = Math.ceil(w / res), gH = Math.ceil(h / res);
    const grid = new Float32Array(gW * gH);

    for (const cmd of cmds) {
        const { sx, sy } = m2s(cmd.x, cmd.z);
        const gx = Math.floor((sx - tl.sx) / res), gy = Math.floor((sy - tl.sy) / res);
        const r = 8;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const px = gx + dx, py = gy + dy;
            if (px >= 0 && px < gW && py >= 0 && py < gH) {
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d <= r) grid[py * gW + px] += 1 - d / r;
            }
        }
    }

    let max = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
    if (!max) return;

    const id = ctx.createImageData(gW, gH);
    for (let i = 0; i < grid.length; i++) {
        const v = grid[i] / max, idx = i * 4;
        if (v > 0) {
            let r, g, b;
            if (v < 0.25) { const t = v / 0.25; r = 0; g = t * 255 | 0; b = 255; }
            else if (v < 0.5) { const t = (v - 0.25) / 0.25; r = 0; g = 255; b = (1 - t) * 255 | 0; }
            else if (v < 0.75) { const t = (v - 0.5) / 0.25; r = t * 255 | 0; g = 255; b = 0; }
            else { const t = (v - 0.75) / 0.25; r = 255; g = (1 - t) * 255 | 0; b = 0; }
            id.data[idx] = r; id.data[idx + 1] = g; id.data[idx + 2] = b;
            id.data[idx + 3] = Math.min(v * 3, 1) * 200 | 0;
        }
    }
    const tc = document.createElement('canvas');
    tc.width = gW; tc.height = gH;
    tc.getContext('2d').putImageData(id, 0, 0);
    ctx.drawImage(tc, tl.sx, tl.sy, w, h);

    if (filters.startpos) drawStartPositions();
}

// ── Map drawings ──────────────────────────────────────────────────────
function drawMapDrawings() {
    if (!replayData) return;
    for (const draw of replayData.mapDrawings) {
        if (draw.gameTime > playbackTime) continue;
        const color = getPlayerColor(draw.playerNum);
        if (draw.type === 'point') {
            const { sx, sy } = m2s(draw.x, draw.z);
            ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2);
            ctx.fillStyle = hexToRGBA(color, 0.5); ctx.fill();
            ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
        } else if (draw.type === 'line') {
            const p1 = m2s(draw.x1, draw.z1), p2 = m2s(draw.x2, draw.z2);
            ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy);
            ctx.strokeStyle = hexToRGBA(color, 0.7); ctx.lineWidth = 2; ctx.stroke();
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────
function getPlayerColor(playerNum) {
    if (!replayData) return PLAYER_COLORS[0];
    const player = replayData.players.find(p => p.index === playerNum);
    if (!player) return PLAYER_COLORS[playerNum % PLAYER_COLORS.length];
    const team = replayData.teams.find(t => t.index === player.team);
    const allyTeam = team ? team.allyTeam : playerNum;
    return PLAYER_COLORS[allyTeam % PLAYER_COLORS.length];
}

function hexToRGBA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

// ── UI updates ────────────────────────────────────────────────────────
function updateUI() {
    if (!replayData) return;
    for (const id of ['gameInfoPanel','playersPanel','filtersPanel','viewPanel','legendPanel','statsPanel'])
        document.getElementById(id).style.display = '';

    const h = replayData.header;
    const gameDate = h.unixTime > 0 ? new Date(h.unixTime * 1000).toLocaleString() : 'Unknown';
    document.getElementById('gameInfo').innerHTML = `
        <span class="label">Map</span><span class="value">${replayData.mapName}</span>
        <span class="label">Game</span><span class="value">${replayData.gameInfo.gameType}</span>
        <span class="label">Engine</span><span class="value">${h.versionString}</span>
        <span class="label">Duration</span><span class="value">${formatTime(h.gameTime || replayData.maxGameTime)}</span>
        <span class="label">Date</span><span class="value">${gameDate}</span>
        ${replayData.gameInfo.matchInfo ? `<span class="label">Match</span><span class="value">${replayData.gameInfo.matchInfo}</span>` : ''}
    `;

    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    for (const player of replayData.players) {
        if (player.spectator) continue;
        const color = getPlayerColor(player.index);
        const li = document.createElement('li');
        li.style.background = hexToRGBA(color, 0.1);
        li.innerHTML = `
            <span class="player-dot" style="background:${color}"></span>
            <span>${player.name}${player.isAI ? ' (AI)' : ''}</span>
            <span style="margin-left:auto;color:#888;font-size:11px">
                ${player.country || ''} ${player.elo ? ` ELO:${player.elo}` : ''}
            </span>`;
        playerList.appendChild(li);
    }

    // Stats
    const roles = Object.create(null);
    for (const [, u] of replayData.units) roles[u.role] = (roles[u.role] || 0) + 1;
    const cats = Object.create(null);
    for (const c of replayData.commands) cats[c.category] = (cats[c.category] || 0) + 1;

    document.getElementById('statsInfo').innerHTML = `
        <span class="label">Units Tracked</span><span class="value">${replayData.units.size}</span>
        <span class="label">Commanders</span><span class="value">${roles.commander || 0}</span>
        <span class="label">Builders</span><span class="value">${roles.builder || 0}</span>
        <span class="label">Combat</span><span class="value">${roles.combat || 0}</span>
        <span class="label">Mobile</span><span class="value">${roles.mobile || 0}</span>
        <span class="label">Buildings</span><span class="value">${replayData.buildings.length}</span>
        <span class="label">Total Cmds</span><span class="value">${replayData.commands.length.toLocaleString()}</span>
    `;

    updateTimeDisplay();
}

function updateTimeDisplay() {
    if (!replayData) return;
    document.getElementById('timeDisplay').textContent =
        `${formatTime(playbackTime)} / ${formatTime(replayData.maxGameTime)}`;
}

function formatTime(s) {
    return `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, '0')}`;
}

// ── Playback ──────────────────────────────────────────────────────────
function togglePlayback() {
    const btn = document.getElementById('btnPlayPause');
    if (isPlaying) {
        isPlaying = false;
        btn.textContent = '\u25B6 Play';
        btn.classList.remove('active');
        if (animFrameId) cancelAnimationFrame(animFrameId);
    } else {
        isPlaying = true;
        btn.textContent = '\u23F8 Pause';
        btn.classList.add('active');
        lastFrameTime = performance.now();
        if (playbackTime >= replayData.maxGameTime) playbackTime = 0;
        animatePlayback();
    }
}

function animatePlayback() {
    if (!isPlaying || !replayData) return;
    const now = performance.now();
    playbackTime += ((now - lastFrameTime) / 1000) * playbackSpeed;
    lastFrameTime = now;

    if (playbackTime >= replayData.maxGameTime) {
        playbackTime = replayData.maxGameTime;
        isPlaying = false;
        document.getElementById('btnPlayPause').textContent = '\u25B6 Play';
        document.getElementById('btnPlayPause').classList.remove('active');
    }

    document.getElementById('timeline').value = (playbackTime / replayData.maxGameTime) * 100;
    updateTimeDisplay();
    render();
    if (isPlaying) animFrameId = requestAnimationFrame(animatePlayback);
}

function setSpeed(s) { playbackSpeed = parseFloat(s); }

function setViewMode(mode) {
    viewMode = mode;
    document.getElementById('btnTrails').classList.toggle('active', mode === 'trails');
    document.getElementById('btnHeatmap').classList.toggle('active', mode === 'heatmap');
    document.getElementById('btnDots').classList.toggle('active', mode === 'units');
    render();
}

// ── Canvas interaction ────────────────────────────────────────────────
function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    vt.x = mx - (mx - vt.x) * f;
    vt.y = my - (my - vt.y) * f;
    vt.scale *= f;
    render();
}

function onMouseDown(e) {
    if (e.button === 0) {
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        vtStart = { x: vt.x, y: vt.y };
        canvas.style.cursor = 'grabbing';
    }
}

function onMouseMove(e) {
    if (isDragging) {
        vt.x = vtStart.x + (e.clientX - dragStart.x);
        vt.y = vtStart.y + (e.clientY - dragStart.y);
        render();
    } else {
        updateTooltip(e);
    }
}

function onMouseUp() {
    isDragging = false;
    canvas.style.cursor = 'crosshair';
}

function updateTooltip(e) {
    if (!replayData) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { x, z } = s2m(mx, my);
    const tooltip = document.getElementById('tooltip');

    // Find nearest unit
    const thresh = 20 / vt.scale;
    let nearest = null, nearestDist = Infinity;

    for (const [uid, unit] of replayData.units) {
        if (unit.firstSeen > playbackTime) continue;
        const pos = getUnitPosition(unit, playbackTime);
        if (!pos) continue;
        const d = Math.sqrt((pos.x - x) ** 2 + (pos.z - z) ** 2);
        if (d < thresh && d < nearestDist) { nearest = { uid, unit, pos }; nearestDist = d; }
    }

    if (nearest) {
        const player = replayData.players.find(p => p.index === nearest.unit.playerNum);
        const pname = player ? player.name : `Player ${nearest.unit.playerNum}`;
        const order = getUnitCurrentOrder(nearest.unit, playbackTime);
        tooltip.innerHTML = `
            <strong>${pname}</strong> - Unit #${nearest.uid}<br>
            Role: ${nearest.unit.role}${nearest.unit.isCommander ? ' (Commander)' : ''}<br>
            Pos: (${Math.round(nearest.pos.x)}, ${Math.round(nearest.pos.z)})
            ${order ? `<br>Order: ${order.category}` : ''}
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 12) + 'px';
    } else {
        tooltip.style.display = 'none';
    }
}

// Global for onclick handlers
window.togglePlayback = togglePlayback;
window.setSpeed = setSpeed;
window.setViewMode = setViewMode;
