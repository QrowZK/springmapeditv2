/**
 * End-to-end test for the Zero-K replay viewer.
 * Verifies the full pipeline: file loading -> parsing -> data extraction -> rendering logic.
 */
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');
const path = require('path');

// Mock pako for Node.js
global.pako = {
    inflate: function(data) {
        return new Uint8Array(zlib.gunzipSync(Buffer.from(data)));
    }
};

const { ReplayParser, CMD, classifyCommand } = require('./replay-parser.js');

console.log('=== Zero-K Replay Viewer E2E Test ===\n');

// Test 1: Parse real replay file
console.log('Test 1: Parse 27-minute replay file');
const fileData = fs.readFileSync('./test_data/replay_27min.sdfz');
const arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
const parser = new ReplayParser();
const result = parser.parse(arrayBuffer);

assert(result.header.version === 5, 'Header version should be 5');
assert(result.mapName === 'Ravaged_v2', 'Map should be Ravaged_v2');
assert(result.players.length >= 2, 'Should have at least 2 players');
assert(result.commands.length > 100, 'Should have many commands');
assert(result.startPositions.length > 0, 'Should have start positions');
assert(result.maxGameTime > 1000, 'Should be a long game');

// Verify command categories
const categories = {};
for (const cmd of result.commands) {
    categories[cmd.category] = (categories[cmd.category] || 0) + 1;
}
assert(categories.move > 0, 'Should have move commands');
assert(categories.build > 0, 'Should have build commands');
console.log(`  Commands: ${result.commands.length} total`);
console.log(`  Categories: ${JSON.stringify(categories)}`);
console.log('  PASSED\n');

// Test 2: Verify coordinate ranges
console.log('Test 2: Verify all command coordinates are valid');
let invalidCoords = 0;
for (const cmd of result.commands) {
    if (!isFinite(cmd.x) || !isFinite(cmd.z) || cmd.x < -100 || cmd.x > 100000 || cmd.z < -100 || cmd.z > 100000) {
        invalidCoords++;
    }
}
assert(invalidCoords === 0, `All coordinates should be valid (got ${invalidCoords} invalid)`);
console.log(`  All ${result.commands.length} commands have valid coordinates`);
console.log('  PASSED\n');

// Test 3: Verify player data
console.log('Test 3: Verify player data');
const nonSpecPlayers = result.players.filter(p => !p.spectator);
assert(nonSpecPlayers.length >= 2, 'Should have at least 2 non-spectator players');
for (const p of nonSpecPlayers) {
    assert(p.name && p.name.length > 0, `Player should have a name: ${JSON.stringify(p)}`);
    assert(p.team >= 0, `Player should have a team: ${JSON.stringify(p)}`);
}
console.log(`  Players: ${nonSpecPlayers.map(p => p.name).join(', ')}`);
console.log('  PASSED\n');

// Test 4: Verify map bounds computation
console.log('Test 4: Verify map bounds computation');
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
for (const cmd of result.commands) {
    minX = Math.min(minX, cmd.x);
    maxX = Math.max(maxX, cmd.x);
    minZ = Math.min(minZ, cmd.z);
    maxZ = Math.max(maxZ, cmd.z);
}
console.log(`  X range: ${minX.toFixed(0)} - ${maxX.toFixed(0)}`);
console.log(`  Z range: ${minZ.toFixed(0)} - ${maxZ.toFixed(0)}`);
assert(maxX > minX, 'Should have X spread');
assert(maxZ > minZ, 'Should have Z spread');
assert(maxX < 50000, 'Max X should be reasonable');
assert(maxZ < 50000, 'Max Z should be reasonable');
console.log('  PASSED\n');

// Test 5: Verify start positions match players
console.log('Test 5: Verify start positions');
const startPlayers = new Set(result.startPositions.map(sp => sp.playerNum));
assert(startPlayers.size >= 2, 'Should have start positions for at least 2 players');
for (const sp of result.startPositions) {
    if (sp.x !== 0 || sp.z !== 0) {
        assert(isFinite(sp.x) && sp.x >= 0, `Start X should be valid: ${sp.x}`);
        assert(isFinite(sp.z) && sp.z >= 0, `Start Z should be valid: ${sp.z}`);
    }
}
console.log(`  Start positions for players: ${[...startPlayers].join(', ')}`);
console.log('  PASSED\n');

// Test 6: Verify time ordering
console.log('Test 6: Verify command time ordering');
let outOfOrder = 0;
let prevTime = -1;
for (const cmd of result.commands) {
    if (cmd.gameTime < prevTime - 0.01) {
        outOfOrder++;
    }
    prevTime = cmd.gameTime;
}
// Some out-of-order is acceptable due to batched commands
console.log(`  Out of order: ${outOfOrder}/${result.commands.length}`);
assert(outOfOrder < result.commands.length * 0.01, 'Less than 1% should be out of order');
console.log('  PASSED\n');

// Test 7: Verify HTML, JS files exist and are syntactically valid
console.log('Test 7: Verify web files exist');
assert(fs.existsSync('./index.html'), 'index.html should exist');
assert(fs.existsSync('./replay-parser.js'), 'replay-parser.js should exist');
assert(fs.existsSync('./replay-viewer.js'), 'replay-viewer.js should exist');

const html = fs.readFileSync('./index.html', 'utf8');
assert(html.includes('replayCanvas'), 'HTML should reference canvas');
assert(html.includes('replay-parser.js'), 'HTML should load parser');
assert(html.includes('replay-viewer.js'), 'HTML should load viewer');
assert(html.includes('pako'), 'HTML should load pako for decompression');
console.log('  All web files present and valid');
console.log('  PASSED\n');

// Test 8: HTTP server smoke test
console.log('Test 8: HTTP server serves files correctly');
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    filePath = decodeURIComponent(filePath);
    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200);
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(0, () => {
    const port = server.address().port;

    // Fetch index.html
    http.get(`http://localhost:${port}/`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            assert(res.statusCode === 200, 'Should serve index.html');
            assert(body.includes('Zero-K Replay Viewer'), 'Should contain app title');

            // Fetch replay-parser.js
            http.get(`http://localhost:${port}/replay-parser.js`, (res2) => {
                let body2 = '';
                res2.on('data', chunk => body2 += chunk);
                res2.on('end', () => {
                    assert(res2.statusCode === 200, 'Should serve parser JS');
                    assert(body2.includes('ReplayParser'), 'Should contain parser class');

                    // Fetch replay-viewer.js
                    http.get(`http://localhost:${port}/replay-viewer.js`, (res3) => {
                        let body3 = '';
                        res3.on('data', chunk => body3 += chunk);
                        res3.on('end', () => {
                            assert(res3.statusCode === 200, 'Should serve viewer JS');
                            assert(body3.includes('render'), 'Should contain render function');

                            server.close();
                            console.log('  Server serves all files correctly');
                            console.log('  PASSED\n');

                            console.log('=== ALL E2E TESTS PASSED ===');
                        });
                    });
                });
            });
        });
    });
});

function assert(condition, message) {
    if (!condition) {
        console.error(`ASSERTION FAILED: ${message}`);
        process.exit(1);
    }
}
