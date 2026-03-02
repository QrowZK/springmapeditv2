/**
 * Node.js test script for the .sdfz replay parser
 * Runs the parser against a real replay file and verifies correct output.
 */
const fs = require('fs');
const zlib = require('zlib');

// Mock pako for Node.js (use zlib instead)
global.pako = {
    inflate: function(data) {
        return new Uint8Array(zlib.gunzipSync(Buffer.from(data)));
    }
};

// Load the parser
const { ReplayParser } = require('./replay-parser.js');

// Test files
const testFiles = [
    { path: './test_data/replay_27min.sdfz', desc: '27-minute 1v1 game' },
    { path: './test_data/test_replay.sdfz', desc: 'Short game (setup only)' }
];

let allPassed = true;

for (const testFile of testFiles) {
    if (!fs.existsSync(testFile.path)) {
        console.log(`SKIP: ${testFile.path} not found`);
        continue;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${testFile.desc} (${testFile.path})`);
    console.log('='.repeat(60));

    try {
        const fileData = fs.readFileSync(testFile.path);
        const arrayBuffer = fileData.buffer.slice(
            fileData.byteOffset,
            fileData.byteOffset + fileData.byteLength
        );

        const parser = new ReplayParser();
        const result = parser.parse(arrayBuffer);

        // Validate header
        console.log('\n--- Header ---');
        console.log(`  Version: ${result.header.version}`);
        console.log(`  Engine: ${result.header.versionString}`);
        console.log(`  Header Size: ${result.header.headerSize}`);
        console.log(`  Game Time: ${result.header.gameTime}s`);
        console.log(`  Wallclock Time: ${result.header.wallclockTime}s`);
        console.log(`  Players: ${result.header.numPlayers}`);
        console.log(`  Teams: ${result.header.numTeams}`);

        assert(result.header.version === 5, 'Version should be 5');
        assert(result.header.headerSize === 352, 'Header size should be 352');

        // Validate game info
        console.log('\n--- Game Info ---');
        console.log(`  Map: ${result.mapName}`);
        console.log(`  Game Type: ${result.gameInfo.gameType}`);
        console.log(`  Match Info: ${result.gameInfo.matchInfo}`);

        assert(result.mapName && result.mapName !== 'Unknown', 'Map name should be parsed');

        // Validate players
        console.log('\n--- Players ---');
        for (const player of result.players) {
            const teamInfo = player.team >= 0 ? `team=${player.team}` : 'spectator';
            console.log(`  ${player.name} (${teamInfo}${player.isAI ? ', AI' : ''}) - ${player.country || 'N/A'}`);
        }

        const realPlayers = result.players.filter(p => !p.spectator && !p.isAI);
        assert(realPlayers.length >= 1, 'Should have at least 1 non-spectator player');

        // Validate start positions
        console.log('\n--- Start Positions ---');
        for (const sp of result.startPositions) {
            console.log(`  Player ${sp.playerNum} Team ${sp.team}: (${sp.x.toFixed(0)}, ${sp.y.toFixed(0)}, ${sp.z.toFixed(0)}) ready=${sp.ready} t=${sp.gameTime.toFixed(1)}s`);
        }

        if (result.startPositions.length > 0) {
            // Validate coordinates are reasonable
            for (const sp of result.startPositions) {
                if (sp.x !== 0 || sp.z !== 0) {
                    assert(isFinite(sp.x) && sp.x >= 0 && sp.x < 50000, `Start X should be finite and positive: ${sp.x}`);
                    assert(isFinite(sp.z) && sp.z >= 0 && sp.z < 50000, `Start Z should be finite and positive: ${sp.z}`);
                }
            }
        }

        // Validate commands
        console.log('\n--- Commands ---');
        console.log(`  Total: ${result.commands.length}`);

        const categories = {};
        for (const cmd of result.commands) {
            categories[cmd.category] = (categories[cmd.category] || 0) + 1;
        }
        for (const [cat, count] of Object.entries(categories)) {
            console.log(`  ${cat}: ${count}`);
        }

        // Validate command coordinates
        let badCoords = 0;
        for (const cmd of result.commands) {
            if (!isFinite(cmd.x) || !isFinite(cmd.z) || cmd.x < -1000 || cmd.x > 100000 || cmd.z < -1000 || cmd.z > 100000) {
                badCoords++;
            }
        }
        if (badCoords > 0) {
            console.log(`  WARNING: ${badCoords} commands with suspicious coordinates`);
        }
        console.log(`  Valid coordinates: ${result.commands.length - badCoords}/${result.commands.length}`);

        // Show some sample commands
        if (result.commands.length > 0) {
            console.log('\n--- Sample Commands (first 10) ---');
            for (const cmd of result.commands.slice(0, 10)) {
                console.log(`  t=${cmd.gameTime.toFixed(1)}s player=${cmd.playerNum} ${cmd.name} (${cmd.category}) at (${cmd.x.toFixed(0)}, ${cmd.z.toFixed(0)}) ${cmd.isAI ? '[AI]' : ''}`);
            }
        }

        // Map drawings
        console.log(`\n--- Map Drawings: ${result.mapDrawings.length} ---`);
        for (const draw of result.mapDrawings.slice(0, 5)) {
            console.log(`  t=${draw.gameTime.toFixed(1)}s player=${draw.playerNum} type=${draw.type}`);
        }

        // Chat messages
        console.log(`\n--- Chat Messages: ${result.chatMessages.length} ---`);
        for (const chat of result.chatMessages.slice(0, 5)) {
            console.log(`  t=${chat.gameTime.toFixed(1)}s [${chat.fromId}]: ${chat.message.substring(0, 60)}`);
        }

        console.log(`\n  Max Game Time: ${result.maxGameTime.toFixed(1)}s (${(result.maxGameTime/60).toFixed(1)} min)`);

        console.log('\nPASSED');

    } catch (err) {
        console.error(`\nFAILED: ${err.message}`);
        console.error(err.stack);
        allPassed = false;
    }
}

console.log(`\n${'='.repeat(60)}`);
if (allPassed) {
    console.log('ALL TESTS PASSED');
} else {
    console.log('SOME TESTS FAILED');
    process.exit(1);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
        allPassed = false;
    }
}
