/**
 * Zero-K Replay Viewer - Canvas-based 2D visualization
 */

// Player colors - distinct and colorblind-friendly
const PLAYER_COLORS = [
    '#4ecdc4', // teal
    '#ff6b6b', // red
    '#ffe66d', // yellow
    '#a8e6cf', // green
    '#dda0dd', // plum
    '#87ceeb', // sky blue
    '#ffa07a', // salmon
    '#98fb98', // pale green
    '#f0e68c', // khaki
    '#dda0dd', // plum
];

const COMMAND_COLORS = {
    move: '#4ecdc4',
    attack: '#ff6b6b',
    build: '#ffe66d',
    patrol: '#a8e6cf',
    other: '#888888'
};

let replayData = null;
let mapImage = null;
let canvas, ctx;
let viewMode = 'trails';
let isPlaying = false;
let playbackTime = 0;
let playbackSpeed = 1;
let lastFrameTime = 0;
let animFrameId = null;

// View transform (pan & zoom)
let viewTransform = { x: 0, y: 0, scale: 1 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragViewStart = { x: 0, y: 0 };

// Map coordinate bounds (determined from data)
let mapBounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };

// Active filters
let filters = {
    move: true,
    attack: true,
    build: true,
    patrol: true,
    other: true,
    startpos: true,
    mapdraw: true
};

// Heatmap data
let heatmapData = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
    canvas = document.getElementById('replayCanvas');
    ctx = canvas.getContext('2d');

    setupCanvasSize();
    setupEventListeners();
    render();
}

function setupCanvasSize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

function setupEventListeners() {
    // File upload
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            loadFile(e.dataTransfer.files[0]);
        }
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            loadFile(e.target.files[0]);
        }
    });

    // Timeline
    document.getElementById('timeline').addEventListener('input', (e) => {
        if (replayData) {
            playbackTime = (parseFloat(e.target.value) / 100) * replayData.maxGameTime;
            render();
        }
    });

    // Filters
    document.querySelectorAll('#filterGroup input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            filters[e.target.dataset.filter] = e.target.checked;
            render();
        });
    });

    // Canvas interactions
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);

    // Resize
    window.addEventListener('resize', () => {
        setupCanvasSize();
        render();
    });
}

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
        heatmapData = null;

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
        try {
            const img = await tryLoadImage(url);
            if (img) {
                mapImage = img;
                return;
            }
        } catch (e) {
            // Continue to next URL
        }
    }

    console.warn('Could not load map image for:', mapName);
    mapImage = null;
}

function tryLoadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => {
            // Retry without crossOrigin (works from file:// but can't read pixels)
            const img2 = new Image();
            img2.onload = () => resolve(img2);
            img2.onerror = () => resolve(null);
            img2.src = url;
        };
        img.src = url;
    });
}

function computeMapBounds() {
    if (!replayData) return;

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    for (const sp of replayData.startPositions) {
        if (sp.x !== 0 || sp.z !== 0) {
            minX = Math.min(minX, sp.x); maxX = Math.max(maxX, sp.x);
            minZ = Math.min(minZ, sp.z); maxZ = Math.max(maxZ, sp.z);
        }
    }

    for (const cmd of replayData.commands) {
        minX = Math.min(minX, cmd.x); maxX = Math.max(maxX, cmd.x);
        minZ = Math.min(minZ, cmd.z); maxZ = Math.max(maxZ, cmd.z);
    }

    if (minX === Infinity) {
        minX = 0; minZ = 0; maxX = 8192; maxZ = 8192;
    }

    // Spring maps use coordinates starting at 0
    // Expand to likely map boundaries (multiples of 512)
    minX = 0;
    minZ = 0;
    maxX = Math.ceil(maxX / 512) * 512;
    maxZ = Math.ceil(maxZ / 512) * 512;

    // Ensure minimum size
    if (maxX < 1024) maxX = 8192;
    if (maxZ < 1024) maxZ = 8192;

    mapBounds = { minX, minZ, maxX, maxZ };
}

function resetView() {
    if (!canvas) return;

    const mapW = mapBounds.maxX - mapBounds.minX;
    const mapH = mapBounds.maxZ - mapBounds.minZ;
    const scaleX = canvas.width / mapW;
    const scaleY = canvas.height / mapH;
    const scale = Math.min(scaleX, scaleY) * 0.95;

    viewTransform = {
        x: (canvas.width - mapW * scale) / 2,
        y: (canvas.height - mapH * scale) / 2,
        scale: scale
    };
}

function mapToScreen(x, z) {
    return {
        sx: (x - mapBounds.minX) * viewTransform.scale + viewTransform.x,
        sy: (z - mapBounds.minZ) * viewTransform.scale + viewTransform.y
    };
}

function screenToMap(sx, sy) {
    return {
        x: (sx - viewTransform.x) / viewTransform.scale + mapBounds.minX,
        z: (sy - viewTransform.y) / viewTransform.scale + mapBounds.minZ
    };
}

function render() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!replayData) return;

    // Draw map image
    drawMapBackground();

    // Draw based on view mode
    switch (viewMode) {
        case 'trails': drawTrails(); break;
        case 'heatmap': drawHeatmap(); break;
        case 'dots': drawDots(); break;
    }

    // Always draw start positions and map drawings on top
    if (filters.mapdraw) drawMapDrawings();
    if (filters.startpos) drawStartPositions();
}

function drawMapBackground() {
    const topLeft = mapToScreen(mapBounds.minX, mapBounds.minZ);
    const botRight = mapToScreen(mapBounds.maxX, mapBounds.maxZ);
    const w = botRight.sx - topLeft.sx;
    const h = botRight.sy - topLeft.sy;

    if (mapImage) {
        ctx.drawImage(mapImage, topLeft.sx, topLeft.sy, w, h);
        // Darken overlay for better visibility
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(topLeft.sx, topLeft.sy, w, h);
    } else {
        // Draw grid as fallback
        ctx.fillStyle = '#111122';
        ctx.fillRect(topLeft.sx, topLeft.sy, w, h);

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        const gridSize = 512;
        for (let gx = mapBounds.minX; gx <= mapBounds.maxX; gx += gridSize) {
            const { sx } = mapToScreen(gx, 0);
            ctx.beginPath();
            ctx.moveTo(sx, topLeft.sy);
            ctx.lineTo(sx, botRight.sy);
            ctx.stroke();
        }
        for (let gz = mapBounds.minZ; gz <= mapBounds.maxZ; gz += gridSize) {
            const { sy } = mapToScreen(0, gz);
            ctx.beginPath();
            ctx.moveTo(topLeft.sx, sy);
            ctx.lineTo(botRight.sx, sy);
            ctx.stroke();
        }
    }

    // Map border
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.sx, topLeft.sy, w, h);
}

function drawTrails() {
    const visibleCommands = getVisibleCommands();

    // Group by player
    const byPlayer = {};
    for (const cmd of visibleCommands) {
        const key = cmd.playerNum;
        if (!byPlayer[key]) byPlayer[key] = [];
        byPlayer[key].push(cmd);
    }

    // Draw trails with fading based on time
    for (const [playerNum, cmds] of Object.entries(byPlayer)) {
        const color = getPlayerColor(parseInt(playerNum));

        for (const cmd of cmds) {
            const { sx, sy } = mapToScreen(cmd.x, cmd.z);
            const timeFraction = cmd.gameTime / replayData.maxGameTime;
            const alpha = 0.15 + 0.7 * timeFraction;

            // Category-based color with player tint
            const cmdColor = COMMAND_COLORS[cmd.category] || '#888';

            ctx.fillStyle = hexToRGBA(cmdColor, alpha * 0.8);
            const size = cmd.category === 'build' ? 4 : 2.5;
            const scaledSize = Math.max(size, size / viewTransform.scale * 0.5);

            if (cmd.category === 'build') {
                ctx.fillRect(sx - scaledSize / 2, sy - scaledSize / 2, scaledSize, scaledSize);
            } else {
                ctx.beginPath();
                ctx.arc(sx, sy, scaledSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Draw connections for sequential commands from same player
    for (const [playerNum, cmds] of Object.entries(byPlayer)) {
        const moveCmds = cmds.filter(c => c.category === 'move' || c.category === 'patrol');
        if (moveCmds.length < 2) continue;

        const color = getPlayerColor(parseInt(playerNum));
        ctx.strokeStyle = hexToRGBA(color, 0.15);
        ctx.lineWidth = 1;
        ctx.beginPath();

        let prevTime = -999;
        for (let i = 0; i < moveCmds.length; i++) {
            const cmd = moveCmds[i];
            const { sx, sy } = mapToScreen(cmd.x, cmd.z);

            // Only connect commands close in time (within 5 seconds)
            if (i === 0 || cmd.gameTime - prevTime > 5) {
                ctx.moveTo(sx, sy);
            } else {
                ctx.lineTo(sx, sy);
            }
            prevTime = cmd.gameTime;
        }
        ctx.stroke();
    }
}

function drawDots() {
    const visibleCommands = getVisibleCommands();

    for (const cmd of visibleCommands) {
        const { sx, sy } = mapToScreen(cmd.x, cmd.z);
        const color = COMMAND_COLORS[cmd.category] || '#888';
        const playerColor = getPlayerColor(cmd.playerNum);

        ctx.fillStyle = hexToRGBA(playerColor, 0.6);
        const size = 3;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();

        // Colored outline for command type
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawHeatmap() {
    const visibleCommands = getVisibleCommands();
    if (visibleCommands.length === 0) return;

    const topLeft = mapToScreen(mapBounds.minX, mapBounds.minZ);
    const botRight = mapToScreen(mapBounds.maxX, mapBounds.maxZ);
    const w = Math.floor(botRight.sx - topLeft.sx);
    const h = Math.floor(botRight.sy - topLeft.sy);

    if (w <= 0 || h <= 0) return;

    // Build heatmap grid
    const resolution = 2;
    const gridW = Math.ceil(w / resolution);
    const gridH = Math.ceil(h / resolution);
    const grid = new Float32Array(gridW * gridH);

    for (const cmd of visibleCommands) {
        const { sx, sy } = mapToScreen(cmd.x, cmd.z);
        const gx = Math.floor((sx - topLeft.sx) / resolution);
        const gy = Math.floor((sy - topLeft.sy) / resolution);

        // Apply gaussian-like spread
        const radius = 8;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = gx + dx;
                const py = gy + dy;
                if (px >= 0 && px < gridW && py >= 0 && py < gridH) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        grid[py * gridW + px] += 1 - dist / radius;
                    }
                }
            }
        }
    }

    // Find max value
    let maxVal = 0;
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] > maxVal) maxVal = grid[i];
    }
    if (maxVal === 0) return;

    // Draw heatmap
    const imageData = ctx.createImageData(gridW, gridH);
    for (let i = 0; i < grid.length; i++) {
        const val = grid[i] / maxVal;
        const idx = i * 4;

        if (val > 0) {
            // Blue -> Cyan -> Green -> Yellow -> Red
            let r, g, b;
            if (val < 0.25) {
                const t = val / 0.25;
                r = 0; g = Math.floor(t * 255); b = 255;
            } else if (val < 0.5) {
                const t = (val - 0.25) / 0.25;
                r = 0; g = 255; b = Math.floor((1 - t) * 255);
            } else if (val < 0.75) {
                const t = (val - 0.5) / 0.25;
                r = Math.floor(t * 255); g = 255; b = 0;
            } else {
                const t = (val - 0.75) / 0.25;
                r = 255; g = Math.floor((1 - t) * 255); b = 0;
            }

            imageData.data[idx] = r;
            imageData.data[idx + 1] = g;
            imageData.data[idx + 2] = b;
            imageData.data[idx + 3] = Math.floor(Math.min(val * 3, 1) * 200);
        }
    }

    // Create temp canvas for scaling
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridW;
    tempCanvas.height = gridH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(tempCanvas, topLeft.sx, topLeft.sy, w, h);
}

function drawStartPositions() {
    if (!replayData) return;

    // Get the final start positions per player
    const finalPositions = {};
    for (const sp of replayData.startPositions) {
        if (sp.gameTime <= playbackTime && (sp.x !== 0 || sp.z !== 0)) {
            finalPositions[sp.playerNum] = sp;
        }
    }

    for (const [playerNum, sp] of Object.entries(finalPositions)) {
        const { sx, sy } = mapToScreen(sp.x, sp.z);
        const color = getPlayerColor(parseInt(playerNum));
        const player = replayData.players.find(p => p.index === parseInt(playerNum));

        // Outer ring
        ctx.beginPath();
        ctx.arc(sx, sy, 12, 0, Math.PI * 2);
        ctx.fillStyle = hexToRGBA(color, 0.3);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Player name label
        if (player) {
            ctx.font = '11px sans-serif';
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 3;
            const name = player.name;
            ctx.strokeText(name, sx + 16, sy + 4);
            ctx.fillText(name, sx + 16, sy + 4);
        }
    }
}

function drawMapDrawings() {
    if (!replayData) return;

    for (const draw of replayData.mapDrawings) {
        if (draw.gameTime > playbackTime) continue;

        const color = getPlayerColor(draw.playerNum);

        if (draw.type === 'point') {
            const { sx, sy } = mapToScreen(draw.x, draw.z);
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, Math.PI * 2);
            ctx.fillStyle = hexToRGBA(color, 0.5);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else if (draw.type === 'line') {
            const p1 = mapToScreen(draw.x1, draw.z1);
            const p2 = mapToScreen(draw.x2, draw.z2);
            ctx.beginPath();
            ctx.moveTo(p1.sx, p1.sy);
            ctx.lineTo(p2.sx, p2.sy);
            ctx.strokeStyle = hexToRGBA(color, 0.7);
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

function getVisibleCommands() {
    if (!replayData) return [];

    return replayData.commands.filter(cmd => {
        if (cmd.gameTime > playbackTime) return false;
        if (!filters[cmd.category]) return false;
        return true;
    });
}

function getPlayerColor(playerNum) {
    if (!replayData) return PLAYER_COLORS[0];
    const player = replayData.players.find(p => p.index === playerNum);
    if (!player) return PLAYER_COLORS[playerNum % PLAYER_COLORS.length];

    // Use team's ally team for color assignment
    const team = replayData.teams.find(t => t.index === player.team);
    const allyTeam = team ? team.allyTeam : playerNum;
    return PLAYER_COLORS[allyTeam % PLAYER_COLORS.length];
}

function hexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// UI updates
function updateUI() {
    if (!replayData) return;

    // Show panels
    document.getElementById('gameInfoPanel').style.display = '';
    document.getElementById('playersPanel').style.display = '';
    document.getElementById('filtersPanel').style.display = '';
    document.getElementById('viewPanel').style.display = '';
    document.getElementById('legendPanel').style.display = '';
    document.getElementById('statsPanel').style.display = '';

    // Game info
    const info = document.getElementById('gameInfo');
    const h = replayData.header;
    const gameDate = h.unixTime > 0 ? new Date(h.unixTime * 1000).toLocaleString() : 'Unknown';
    info.innerHTML = `
        <span class="label">Map</span><span class="value">${replayData.mapName}</span>
        <span class="label">Game</span><span class="value">${replayData.gameInfo.gameType}</span>
        <span class="label">Engine</span><span class="value">${h.versionString}</span>
        <span class="label">Duration</span><span class="value">${formatTime(h.gameTime || replayData.maxGameTime)}</span>
        <span class="label">Date</span><span class="value">${gameDate}</span>
        ${replayData.gameInfo.matchInfo ? `<span class="label">Match</span><span class="value">${replayData.gameInfo.matchInfo}</span>` : ''}
    `;

    // Players
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
                ${player.country ? player.country : ''}
                ${player.elo ? ` ELO:${player.elo}` : ''}
            </span>
        `;
        playerList.appendChild(li);
    }

    // Stats
    const stats = document.getElementById('statsInfo');
    const cmdsByCategory = {};
    for (const cmd of replayData.commands) {
        cmdsByCategory[cmd.category] = (cmdsByCategory[cmd.category] || 0) + 1;
    }
    stats.innerHTML = `
        <span class="label">Total Commands</span><span class="value">${replayData.commands.length.toLocaleString()}</span>
        <span class="label">Move</span><span class="value">${(cmdsByCategory.move || 0).toLocaleString()}</span>
        <span class="label">Attack</span><span class="value">${(cmdsByCategory.attack || 0).toLocaleString()}</span>
        <span class="label">Build</span><span class="value">${(cmdsByCategory.build || 0).toLocaleString()}</span>
        <span class="label">Patrol/Fight</span><span class="value">${(cmdsByCategory.patrol || 0).toLocaleString()}</span>
        <span class="label">Other</span><span class="value">${(cmdsByCategory.other || 0).toLocaleString()}</span>
        <span class="label">Start Positions</span><span class="value">${replayData.startPositions.length}</span>
        <span class="label">Map Drawings</span><span class="value">${replayData.mapDrawings.length}</span>
        <span class="label">Chat Messages</span><span class="value">${replayData.chatMessages.length}</span>
    `;

    updateTimeDisplay();
}

function updateTimeDisplay() {
    if (!replayData) return;
    const current = formatTime(playbackTime);
    const total = formatTime(replayData.maxGameTime);
    document.getElementById('timeDisplay').textContent = `${current} / ${total}`;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Playback controls
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
        if (playbackTime >= replayData.maxGameTime) {
            playbackTime = 0;
        }
        animatePlayback();
    }
}

function animatePlayback() {
    if (!isPlaying || !replayData) return;

    const now = performance.now();
    const delta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    playbackTime += delta * playbackSpeed;

    if (playbackTime >= replayData.maxGameTime) {
        playbackTime = replayData.maxGameTime;
        isPlaying = false;
        document.getElementById('btnPlayPause').textContent = '\u25B6 Play';
        document.getElementById('btnPlayPause').classList.remove('active');
    }

    document.getElementById('timeline').value = (playbackTime / replayData.maxGameTime) * 100;
    updateTimeDisplay();
    render();

    if (isPlaying) {
        animFrameId = requestAnimationFrame(animatePlayback);
    }
}

function setSpeed(speed) {
    playbackSpeed = parseFloat(speed);
}

function setViewMode(mode) {
    viewMode = mode;
    document.getElementById('btnTrails').classList.toggle('active', mode === 'trails');
    document.getElementById('btnHeatmap').classList.toggle('active', mode === 'heatmap');
    document.getElementById('btnDots').classList.toggle('active', mode === 'dots');
    render();
}

// Canvas interaction handlers
function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = viewTransform.scale * zoomFactor;

    // Zoom towards mouse position
    viewTransform.x = mouseX - (mouseX - viewTransform.x) * zoomFactor;
    viewTransform.y = mouseY - (mouseY - viewTransform.y) * zoomFactor;
    viewTransform.scale = newScale;

    render();
}

function onMouseDown(e) {
    if (e.button === 0) {
        isDragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        dragViewStart = { x: viewTransform.x, y: viewTransform.y };
        canvas.style.cursor = 'grabbing';
    }
}

function onMouseMove(e) {
    if (isDragging) {
        viewTransform.x = dragViewStart.x + (e.clientX - dragStart.x);
        viewTransform.y = dragViewStart.y + (e.clientY - dragStart.y);
        render();
    } else {
        // Show tooltip
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
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x, z } = screenToMap(mouseX, mouseY);

    const tooltip = document.getElementById('tooltip');

    // Find nearby command
    const threshold = 20 / viewTransform.scale;
    let nearest = null;
    let nearestDist = Infinity;

    const visibleCmds = getVisibleCommands();
    for (const cmd of visibleCmds) {
        const dx = cmd.x - x;
        const dz = cmd.z - z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < threshold && dist < nearestDist) {
            nearestDist = dist;
            nearest = cmd;
        }
    }

    if (nearest) {
        const player = replayData.players.find(p => p.index === nearest.playerNum);
        const playerName = player ? player.name : `Player ${nearest.playerNum}`;
        tooltip.innerHTML = `
            <strong>${playerName}</strong><br>
            ${nearest.name} at ${formatTime(nearest.gameTime)}<br>
            Pos: (${Math.round(nearest.x)}, ${Math.round(nearest.z)})
            ${nearest.unitId !== undefined ? `<br>Unit: #${nearest.unitId}` : ''}
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 12) + 'px';
    } else {
        tooltip.style.display = 'none';
    }
}

// Make global for onclick handlers
window.togglePlayback = togglePlayback;
window.setSpeed = setSpeed;
window.setViewMode = setViewMode;
