/**
 * Zero-K / Spring RTS .sdfz Replay Parser
 *
 * Parses Spring Demo Files (gzip-compressed .sdfz) and extracts:
 * - Game metadata (map, engine version, duration, etc.)
 * - Player information from the setup script
 * - All commands with positions (move, attack, build, etc.)
 * - Start positions
 * - Map drawings
 *
 * Based on the Recoil Engine source:
 *   rts/System/LoadSave/demofile.h
 *   rts/Net/Protocol/NetMessageTypes.h
 *   rts/Net/Protocol/BaseNetProtocol.cpp
 */

const DEMOFILE_MAGIC = "spring demofile";
const DEMOFILE_VERSION = 5;
const HEADER_SIZE = 352;

// Network message types
const NETMSG = {
    KEYFRAME: 1,
    NEWFRAME: 2,
    QUIT: 3,
    STARTPLAYING: 4,
    SETPLAYERNUM: 5,
    PLAYERNAME: 6,
    CHAT: 7,
    RANDSEED: 8,
    GAMEID: 9,
    PATH_CHECKSUM: 10,
    COMMAND: 11,
    SELECT: 12,
    PAUSE: 13,
    AICOMMAND: 14,
    AICOMMANDS: 15,
    AISHARE: 16,
    USER_SPEED: 19,
    INTERNAL_SPEED: 20,
    CPU_USAGE: 21,
    DIRECT_CONTROL: 22,
    DC_UPDATE: 23,
    SHARE: 26,
    SETSHARE: 27,
    PLAYERSTAT: 29,
    GAMEOVER: 30,
    MAPDRAW: 32,
    SYNCRESPONSE: 33,
    SYSTEMMSG: 35,
    STARTPOS: 36,
    PLAYERINFO: 38,
    PLAYERLEFT: 39,
    LOGMSG: 49,
    LUAMSG: 50,
    TEAM: 51,
    GAMEDATA: 52,
    ALLIANCE: 53,
    CCOMMAND: 54,
    TEAMSTAT: 60,
    CLIENTDATA: 61,
    ATTEMPTCONNECT: 65,
    REJECT_CONNECT: 66,
    AI_CREATED: 70,
    AI_STATE_CHANGED: 71,
    REQUEST_TEAMSTAT: 72,
    CREATE_NEWPLAYER: 75,
    AICOMMAND_TRACKED: 76,
    GAME_FRAME_PROGRESS: 77,
    PING: 78
};

// Command IDs
const CMD = {
    STOP: 0,
    INSERT: 1,
    REMOVE: 2,
    WAIT: 5,
    TIMEWAIT: 6,
    DEATHWAIT: 7,
    SQUADWAIT: 8,
    GATHERWAIT: 9,
    MOVE: 10,
    PATROL: 15,
    FIGHT: 16,
    ATTACK: 20,
    AREA_ATTACK: 21,
    GUARD: 25,
    GROUPSELECT: 35,
    GROUPADD: 36,
    GROUPCLEAR: 37,
    REPAIR: 40,
    FIRE_STATE: 45,
    MOVE_STATE: 50,
    SETBASE: 55,
    INTERNAL: 60,
    SELFD: 65,
    LOAD_UNITS: 75,
    LOAD_ONTO: 76,
    UNLOAD_UNITS: 80,
    UNLOAD_UNIT: 81,
    ONOFF: 85,
    RECLAIM: 90,
    CLOAK: 95,
    STOCKPILE: 100,
    MANUALFIRE: 105,
    RESTORE: 110,
    REPEAT: 115,
    TRAJECTORY: 120,
    RESURRECT: 125,
    CAPTURE: 130,
    AUTOREPAIRLEVEL: 135,
    IDLEMODE: 145,
    FAILED: 150
};

const CMD_NAMES = {};
for (const [name, id] of Object.entries(CMD)) {
    CMD_NAMES[id] = name;
}

// Zero-K custom command IDs (from LuaRules/Gadgets/)
const ZK_CMD = {
    RAW_MOVE: 31109,
    RAW_BUILD: 31110,
    PLACE_BEACON: 34924,
    AREA_MEX: 31200,
    AREA_TERRA: 31201,
    JUMP: 38521,
    AREA_GUARD: 38522,
};

// Zero-K base unit internal names (272 units from units/ directory, alphabetically sorted)
// The engine assigns unitDefIDs alphabetically across ALL loaded units (including
// dynamically generated comms, PW structures, etc.), so the IDs shift per game.
// We build the full sorted list at parse time using replay setup script data.
const ZK_BASE_UNITS = [
    'amphaa','amphassault','amphbomb','amphcon','amphfloater','amphimpulse','amphlaunch',
    'amphraid','amphriot','amphsupport','amphtele','armcom1','assaultcruiser','asteroid',
    'athena','benzcom1','bomberassault','bomberdisarm','bomberheavy','bomberheavyold',
    'bomberprec','bomberriot','bomberstrike','chicken','chicken_blimpy','chicken_digger',
    'chicken_dodo','chicken_dragon','chicken_drone','chicken_drone_starter','chicken_leaper',
    'chicken_listener','chicken_pigeon','chicken_rafflesia','chicken_roc','chicken_shield',
    'chicken_spidermonkey','chicken_sporeshooter','chicken_tiamat','chickena','chickenblobber',
    'chickenbroodqueen','chickenc','chickend','chickenf','chickenflyerqueen','chickenlandqueen',
    'chickenr','chickens','chickenspire','chickenwurm','cloakaa','cloakarty','cloakassault',
    'cloakbomb','cloakcon','cloakheavyraid','cloakjammer','cloakraid','cloakriot','cloakskirm',
    'cloaksnipe','commrecon1','commstrike1','commsupport1','corcom1','cremcom1','damagesink',
    'damagesinkrock','dbg_m0r0','dbg_m0r1','dbg_m1r0','dbg_m1r1','dbg_moire','dronecarry',
    'dronefighter','droneheavyslow','dronelight','dynassault1','dynknight1','dynrecon1',
    'dynstrike1','dynsupport1','empiricaldpser','empiricaldpsersmall','empmissile',
    'energyfusion','energygeo','energyheavygeo','energypylon','energysingu','energysolar',
    'energywind','factoryamph','factorycloak','factorygunship','factoryhover','factoryjump',
    'factoryplane','factoryshield','factoryship','factoryspider','factorytank','factoryveh',
    'fakeunit','fakeunit_aatarget','fakeunit_los','grebe','gunshipaa','gunshipassault',
    'gunshipbomb','gunshipcon','gunshipemp','gunshipheavyskirm','gunshipheavytrans',
    'gunshipkrow','gunshipraid','gunshipskirm','gunshiptrans','hoveraa','hoverarty',
    'hoverassault','hovercon','hoverdepthcharge','hoverheavyraid','hoverminer','hoverraid',
    'hoverriot','hovershotgun','hoverskirm','hoverskirm2','hoversonic','jumpaa','jumparty',
    'jumpassault','jumpblackhole','jumpbomb','jumpcon','jumpraid','jumpscout','jumpskirm',
    'jumpsumo','mahlazer','missileslow','napalmmissile','nebula','neebcomm','obj_artefact',
    'planecon','planefighter','planeheavyfighter','planelightscout','planescout','plateamph',
    'platecloak','plategunship','platehover','platejump','plateplane','plateshield','plateship',
    'platespider','platetank','plateveh','pw_generic','pw_hq_attacker','pw_hq_defender',
    'raveparty','roost','seismic','shieldaa','shieldarty','shieldassault','shieldbomb',
    'shieldcon','shieldfelon','shieldraid','shieldriot','shieldscout','shieldshield',
    'shieldskirm','shipaa','shiparty','shipassault','shipcarrier','shipcon','shipheavyarty',
    'shipriot','shipscout','shipskirm','shiptorpraider','slicer','spideraa','spideranarchid',
    'spiderantiheavy','spiderassault','spidercon','spidercrabe','spideremp','spiderriot',
    'spiderscout','spiderskirm','starlight_satellite','staticantinuke','staticarty','staticcon',
    'staticheavyarty','staticheavyradar','staticjammer','staticmex','staticmissilesilo',
    'staticnuke','staticradar','staticrearm','staticshield','staticsonar','staticstorage',
    'statictele','statictempshield','striderantiheavy','striderarty','striderbantha',
    'striderdante','striderdetriment','striderdozer','striderfunnelweb','striderhub',
    'striderscorpion','subraider','subscout','subtacmissile','tacnuke','tankaa','tankarty',
    'tankassault','tankcon','tankheavyarty','tankheavyassault','tankheavyraid','tankraid',
    'tankriot','tele_beacon','terraunit','tiptest','turretaaclose','turretaafar','turretaaflak',
    'turretaaheavy','turretaalaser','turretantiheavy','turretemp','turretgauss','turretheavy',
    'turretheavylaser','turretimpulse','turretlaser','turretmissile','turretriot',
    'turretsunlance','turrettorp','vehaa','veharty','vehassault','vehcapture','vehcon',
    'vehheavyarty','vehraid','vehriot','vehscout','vehsupport','wolverine_mine','zenith'
];

// Known dynamically generated units (cloned comms, PW structures, predefined comms, static comms)
const ZK_DYNAMIC_UNITS = [
    // Cloned commander levels (0, 2-5 for each base type)
    'armcom0','armcom2','armcom3','armcom4','armcom5',
    'benzcom0','benzcom2','benzcom3','benzcom4','benzcom5',
    'commrecon0','commrecon2','commrecon3','commrecon4','commrecon5',
    'commstrike0','commstrike2','commstrike3','commstrike4','commstrike5',
    'commsupport0','commsupport2','commsupport3','commsupport4','commsupport5',
    'corcom0','corcom2','corcom3','corcom4','corcom5',
    'cremcom0','cremcom2','cremcom3','cremcom4','cremcom5',
    'dynassault0','dynassault2','dynassault3','dynassault4','dynassault5',
    'dynknight0','dynknight2','dynknight3','dynknight4','dynknight5',
    'dynrecon0','dynrecon2','dynrecon3','dynrecon4','dynrecon5',
    'dynstrike0','dynstrike2','dynstrike3','dynstrike4','dynstrike5',
    'dynsupport0','dynsupport2','dynsupport3','dynsupport4','dynsupport5',
    // Predefined dynamic comms
    'dynfancy_guardian_base','dynfancy_recon_base','dynfancy_strike_base',
    'dynfancy_strike_lobster_base','dynfancy_support_base',
    'dynhub_assault_base','dynhub_recon_base','dynhub_strike_base','dynhub_support_base',
    'dyntrainer_assault_base','dyntrainer_knight_base','dyntrainer_recon_base',
    'dyntrainer_strike_base','dyntrainer_support_base',
    // PW structures (LOAD_ALL_STRUCTURES = true in pw_unitdefgen.lua)
    'generic_tech','pw_artefact','pw_bomberfac','pw_dropfac','pw_estorage','pw_estorage2',
    'pw_garrison','pw_gaspowerstation','pw_grid','pw_guerilla','pw_inhibitor',
    'pw_interception','pw_metal','pw_mine','pw_mine2','pw_mine3','pw_mstorage2',
    'pw_relay','pw_storage','pw_techlab','pw_warpgate','pw_warpgatealt','pw_warpjammer',
    'pw_wormhole','pw_wormhole2',
    // Static comms (from staticcomms.lua - for AI/missions)
    'comm_battle_pea','comm_campaign_ada','comm_campaign_biovizier',
    'comm_campaign_freemachine','comm_campaign_isonade','comm_campaign_legion',
    'comm_campaign_odin','comm_campaign_praetorian','comm_campaign_promethean',
    'comm_econ_cai','comm_flamer','comm_guardian','comm_hammer','comm_hunter',
    'comm_marine','comm_marksman','comm_marksman_cai','comm_mission_tutorial1',
    'comm_recon','comm_recon_pea','comm_riot','comm_riot_cai','comm_rocketeer',
    'comm_strike_hmg','comm_strike_lpb','comm_strike_pea','comm_stun_cai',
    'comm_support_pea','comm_thunder',
];

// Human-readable names for unit internal names
const ZK_UNIT_HUMANNAMES = {
    amphaa:'Angler',amphassault:'Grizzly',amphbomb:'Limpet',amphcon:'Conch',amphfloater:'Buoy',
    amphimpulse:'Archer',amphlaunch:'Lobster',amphraid:'Duck',amphriot:'Scallop',
    amphsupport:'Bulkhead',amphtele:'Djinn',cloakaa:'Gremlin',cloakarty:'Sling',
    cloakassault:'Knight',cloakbomb:'Imp',cloakcon:'Conjurer',cloakheavyraid:'Scythe',
    cloakjammer:'Iris',cloakraid:'Glaive',cloakriot:'Reaver',cloakskirm:'Ronin',
    cloaksnipe:'Phantom',energyfusion:'Fusion Reactor',energygeo:'Geothermal',
    energyheavygeo:'Adv Geothermal',energypylon:'Energy Pylon',energysingu:'Singularity Reactor',
    energysolar:'Solar Collector',energywind:'Wind/Tidal',factoryamph:'Amphbot Factory',
    factorycloak:'Cloakbot Factory',factorygunship:'Gunship Plant',factoryhover:'Hovercraft Platform',
    factoryjump:'Jumpbot Factory',factoryplane:'Airplane Plant',factoryshield:'Shieldbot Factory',
    factoryship:'Shipyard',factoryspider:'Spider Factory',factorytank:'Tank Foundry',
    factoryveh:'Rover Assembly',grebe:'Grebe',gunshipaa:'Trident',gunshipassault:'Revenant',
    gunshipbomb:'Blastwing',gunshipcon:'Wasp',gunshipemp:'Gnat',gunshipheavyskirm:'Nimbus',
    gunshipheavytrans:'Hercules',gunshipkrow:'Krow',gunshipraid:'Locust',gunshipskirm:'Harpy',
    gunshiptrans:'Charon',hoveraa:'Flail',hoverarty:'Lance',hoverassault:'Halberd',
    hovercon:'Quill',hoverdepthcharge:'Claymore',hoverheavyraid:'Bolas',hoverraid:'Dagger',
    hoverriot:'Mace',hoverskirm:'Scalpel',hoverskirm2:'Trisula',hoversonic:'Morningstar',
    jumpaa:'Toad',jumparty:'Firewalker',jumpassault:'Jack',jumpbomb:'Skuttle',jumpcon:'Constable',
    jumpraid:'Pyro',jumpscout:'Puppy',jumpskirm:'Moderator',jumpsumo:'Jugglenaut',
    mahlazer:'Starlight',planecon:'Crane',planefighter:'Swift',planeheavyfighter:'Raptor',
    planescout:'Owl',plateamph:'Amphbot Plate',platecloak:'Cloakbot Plate',
    plategunship:'Gunship Plate',platehover:'Hovercraft Plate',platejump:'Jumpbot Plate',
    plateplane:'Airplane Plate',plateshield:'Shieldbot Plate',plateship:'Ship Plate',
    platespider:'Spider Plate',platetank:'Tank Plate',plateveh:'Rover Plate',
    raveparty:'Disco Rave Party',shieldaa:'Vandal',shieldarty:'Racketeer',shieldassault:'Thug',
    shieldbomb:'Snitch',shieldcon:'Convict',shieldfelon:'Felon',shieldraid:'Bandit',
    shieldriot:'Outlaw',shieldscout:'Dirtbag',shieldshield:'Aspis',shieldskirm:'Rogue',
    shipaa:'Zephyr',shiparty:'Envoy',shipassault:'Siren',shipcarrier:'Reef',shipcon:'Mariner',
    shipheavyarty:'Shogun',shipriot:'Corsair',shipscout:'Cutter',shipskirm:'Mistral',
    shiptorpraider:'Hunter',slicer:'Slicer',spideraa:'Tarantula',spideranarchid:'Anarchid',
    spiderantiheavy:'Widow',spiderassault:'Hermit',spidercon:'Weaver',spidercrabe:'Crab',
    spideremp:'Venom',spiderriot:'Redback',spiderscout:'Flea',spiderskirm:'Recluse',
    staticantinuke:'Antinuke',staticarty:'Cerberus',staticcon:'Caretaker',
    staticheavyarty:'Big Bertha',staticheavyradar:'Adv Radar',staticjammer:'Cornea',
    staticmex:'Metal Extractor',staticmissilesilo:'Missile Silo',staticnuke:'Trinity',
    staticradar:'Radar Tower',staticrearm:'Airpad',staticshield:'Aegis',staticsonar:'Sonar Station',
    staticstorage:'Storage',statictele:'Teleporter',statictempshield:'Pavise',
    striderantiheavy:'Ultimatum',striderarty:'Merlin',striderbantha:'Paladin',
    striderdante:'Dante',striderdetriment:'Detriment',striderdozer:'Dozer',
    striderfunnelweb:'Funnelweb',striderhub:'Strider Hub',striderscorpion:'Scorpion',
    subraider:'Seawolf',subscout:'Lancelet',subtacmissile:'Scylla',
    tankaa:'Ettin',tankarty:'Emissary',tankassault:'Minotaur',tankcon:'Welder',
    tankheavyarty:'Tremor',tankheavyassault:'Cyclops',tankheavyraid:'Blitz',tankraid:'Kodachi',
    tankriot:'Ogre',terraunit:'Terraform',turretaaclose:'Hacksaw',turretaafar:'Chainsaw',
    turretaaflak:'Thresher',turretaaheavy:'Artemis',turretaalaser:'Razor',
    turretantiheavy:'Lucifer',turretemp:'Faraday',turretgauss:'Gauss',turretheavy:'Desolator',
    turretheavylaser:'Stinger',turretimpulse:'Newton',turretlaser:'Lotus',turretmissile:'Picket',
    turretriot:'Stardust',turretsunlance:'Sunlance',turrettorp:'Urchin',vehaa:'Crasher',
    veharty:'Badger',vehassault:'Ravager',vehcapture:'Dominatrix',vehcon:'Mason',
    vehheavyarty:'Impaler',vehraid:'Scorcher',vehriot:'Ripper',vehscout:'Dart',
    vehsupport:'Fencer',zenith:'Zenith',
};

/**
 * Build the full unitDefID -> name mapping for a specific game by combining
 * base units, known dynamic units, and per-game commander profiles from the
 * replay's setup script. IDs are assigned alphabetically by the engine.
 */
function buildUnitDefMapping(setupScript) {
    const allNames = new Set([...ZK_BASE_UNITS, ...ZK_DYNAMIC_UNITS]);

    // Extract per-game commander profile IDs from setup script's commandertypes modoption
    if (setupScript) {
        const ctMatch = setupScript.match(/commandertypes=([^;\n]+)/);
        if (ctMatch) {
            try {
                let decoded = ctMatch[1].trim();
                // It's base64 encoded Lua table - extract profile keys like c45022, c45023
                if (typeof atob === 'function') {
                    decoded = atob(decoded);
                } else {
                    decoded = Buffer.from(decoded, 'base64').toString();
                }
                // Extract comm profile IDs (keys like c12345)
                const profileIds = decoded.match(/\bc\d+\b/g);
                if (profileIds) {
                    for (const pid of profileIds) {
                        allNames.add(pid + '_base');
                    }
                }
            } catch (e) { /* ignore decode errors */ }
        }
    }

    // Sort alphabetically (same as engine) and build ID mapping
    const sorted = [...allNames].sort();
    const idToName = {};
    const idToHumanName = {};
    for (let i = 0; i < sorted.length; i++) {
        const name = sorted[i];
        const id = i + 1; // IDs start at 1
        idToName[id] = name;
        idToHumanName[id] = ZK_UNIT_HUMANNAMES[name] || name;
    }
    return { idToName, idToHumanName, nameToId: Object.fromEntries(sorted.map((n, i) => [n, i + 1])) };
}

/**
 * Get human-readable name for a unitDefID using a mapping
 */
function getUnitDefName(unitDefId, mapping) {
    if (mapping && mapping.idToHumanName[unitDefId]) return mapping.idToHumanName[unitDefId];
    return `Unit #${unitDefId}`;
}

/**
 * Get the internal unit name for icon URL construction
 */
function getUnitInternalName(unitDefId, mapping) {
    if (mapping && mapping.idToName[unitDefId]) return mapping.idToName[unitDefId];
    return null;
}

// Map draw sub-actions
const MAPDRAW = {
    POINT: 0,
    ERASE: 1,
    LINE: 2
};

/**
 * Classify a command ID into a category for filtering/coloring
 */
function classifyCommand(cmdId) {
    if (cmdId < 0) return 'build';
    switch (cmdId) {
        case CMD.MOVE:
        case ZK_CMD.RAW_MOVE: return 'move';
        case CMD.PATROL:
        case CMD.FIGHT: return 'patrol';
        case CMD.ATTACK:
        case CMD.AREA_ATTACK:
        case CMD.MANUALFIRE: return 'attack';
        case CMD.REPAIR:
        case CMD.RECLAIM:
        case CMD.RESURRECT:
        case CMD.CAPTURE:
        case CMD.RESTORE: return 'other';
        case CMD.GUARD:
        case ZK_CMD.AREA_GUARD: return 'other';
        case ZK_CMD.RAW_BUILD: return 'build';
        case ZK_CMD.JUMP: return 'move';
        default: return 'other';
    }
}

/**
 * Get human-readable command name
 */
const ZK_CMD_NAMES = {};
for (const [name, id] of Object.entries(ZK_CMD)) {
    ZK_CMD_NAMES[id] = name;
}

function getCommandName(cmdId, mapping) {
    if (cmdId < 0) return `Build ${getUnitDefName(-cmdId, mapping)}`;
    return CMD_NAMES[cmdId] || ZK_CMD_NAMES[cmdId] || `CMD_${cmdId}`;
}

class ReplayParser {
    constructor() {
        this.header = null;
        this.script = '';
        this.gameInfo = {};
        this.players = [];
        this.teams = [];
        this.commands = [];
        this.startPositions = [];
        this.mapDrawings = [];
        this.chatMessages = [];
        this.selections = [];       // {gameTime, playerNum, unitIds[]}
        this.frames = [];
        this.maxGameTime = 0;
        this._currentSelection = {}; // playerNum -> unitIds[]
    }

    /**
     * Parse a .sdfz file from an ArrayBuffer
     */
    parse(arrayBuffer) {
        let data;
        try {
            // Try gzip decompression first
            const compressed = new Uint8Array(arrayBuffer);
            data = pako.inflate(compressed);
        } catch (e) {
            // If decompression fails, assume raw .sdf
            data = new Uint8Array(arrayBuffer);
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.data = data;
        this.view = view;

        this._parseHeader(view);
        this._parseScript(data);
        this._parseDemoStream(data, view);

        // Post-process: build unit tracking data
        this._buildUnitData();

        return {
            header: this.header,
            gameInfo: this.gameInfo,
            players: this.players,
            teams: this.teams,
            commands: this.commands,
            startPositions: this.startPositions,
            mapDrawings: this.mapDrawings,
            chatMessages: this.chatMessages,
            selections: this.selections,
            units: this.units,           // Map<unitId, UnitInfo>
            buildings: this.buildings,     // Array of placed buildings
            unitDefMapping: this.unitDefMapping, // unitDefID -> name mapping
            maxGameTime: this.maxGameTime,
            mapName: this.gameInfo.mapName || 'Unknown'
        };
    }

    _parseHeader(view) {
        // Validate magic
        const magic = this._readString(this.data, 0, 16).replace(/\0/g, '');
        if (magic !== DEMOFILE_MAGIC) {
            throw new Error(`Invalid demo file: bad magic "${magic}"`);
        }

        const version = view.getInt32(16, true);
        if (version !== DEMOFILE_VERSION) {
            console.warn(`Demo version ${version}, expected ${DEMOFILE_VERSION}`);
        }

        const headerSize = view.getInt32(20, true);
        const versionString = this._readString(this.data, 24, 256);

        const gameId = Array.from(this.data.slice(280, 296))
            .map(b => b.toString(16).padStart(2, '0')).join('');

        // Read unixTime as two 32-bit values (little-endian)
        const unixTimeLow = view.getUint32(296, true);
        const unixTimeHigh = view.getUint32(300, true);
        const unixTime = unixTimeLow + unixTimeHigh * 0x100000000;

        this.header = {
            version,
            headerSize,
            versionString,
            gameId,
            unixTime,
            scriptSize: view.getInt32(304, true),
            demoStreamSize: view.getInt32(308, true),
            gameTime: view.getInt32(312, true),
            wallclockTime: view.getInt32(316, true),
            numPlayers: view.getInt32(320, true),
            playerStatSize: view.getInt32(324, true),
            playerStatElemSize: view.getInt32(328, true),
            numTeams: view.getInt32(332, true),
            teamStatSize: view.getInt32(336, true),
            teamStatElemSize: view.getInt32(340, true),
            teamStatPeriod: view.getInt32(344, true),
            winningAllyTeamsSize: view.getInt32(348, true)
        };
    }

    _parseScript(data) {
        const start = this.header.headerSize;
        const end = start + this.header.scriptSize;
        this.script = this._readString(data, start, this.header.scriptSize);
        this._parseScriptContent(this.script);
    }

    _parseScriptContent(script) {
        // Extract map name
        const mapMatch = script.match(/mapname=([^;\n]+)/);
        this.gameInfo.mapName = mapMatch ? mapMatch[1].trim() : 'Unknown';

        // Extract game type
        const gameTypeMatch = script.match(/gametype=([^;\n]+)/);
        this.gameInfo.gameType = gameTypeMatch ? gameTypeMatch[1].trim() : 'Unknown';

        // Extract server name / match info
        const serverMatch = script.match(/showservername=([^;\n]+)/);
        this.gameInfo.matchInfo = serverMatch ? serverMatch[1].trim() : '';

        // Extract start position type
        const startPosMatch = script.match(/startpostype=(\d+)/);
        this.gameInfo.startPosType = startPosMatch ? parseInt(startPosMatch[1]) : 0;

        // Parse players
        const playerRegex = /\[player(\d+)\]\s*\{([^}]+)\}/g;
        let match;
        while ((match = playerRegex.exec(script)) !== null) {
            const playerIdx = parseInt(match[1]);
            const block = match[2];
            const player = { index: playerIdx };

            const nameMatch = block.match(/name=([^;\n]+)/);
            player.name = nameMatch ? nameMatch[1].trim() : `Player ${playerIdx}`;

            const teamMatch = block.match(/team=(\d+)/);
            player.team = teamMatch ? parseInt(teamMatch[1]) : -1;

            const specMatch = block.match(/spectator=(\d+)/);
            player.spectator = specMatch ? parseInt(specMatch[1]) === 1 : false;

            const countryMatch = block.match(/countrycode=([^;\n]+)/);
            player.country = countryMatch ? countryMatch[1].trim() : '';

            const eloMatch = block.match(/elo=([^;\n]+)/);
            player.elo = eloMatch ? parseInt(eloMatch[1]) : 0;

            this.players.push(player);
        }

        // Sort players by index
        this.players.sort((a, b) => a.index - b.index);

        // Parse teams
        const teamRegex = /\[team(\d+)\]\s*\{([^}]+)\}/g;
        while ((match = teamRegex.exec(script)) !== null) {
            const teamIdx = parseInt(match[1]);
            const block = match[2];
            const team = { index: teamIdx };

            const allyTeamMatch = block.match(/allyteam=(\d+)/);
            team.allyTeam = allyTeamMatch ? parseInt(allyTeamMatch[1]) : -1;

            const leaderMatch = block.match(/teamleader=(\d+)/);
            team.leader = leaderMatch ? parseInt(leaderMatch[1]) : -1;

            this.teams.push(team);
        }
        this.teams.sort((a, b) => a.index - b.index);

        // Parse AI players
        const aiRegex = /\[ai(\d+)\]\s*\{([^}]+)\}/g;
        while ((match = aiRegex.exec(script)) !== null) {
            const aiIdx = parseInt(match[1]);
            const block = match[2];

            const nameMatch = block.match(/name=([^;\n]+)/);
            const shortNameMatch = block.match(/shortname=([^;\n]+)/);
            const teamMatch = block.match(/team=(\d+)/);
            const hostMatch = block.match(/host=(\d+)/);

            this.players.push({
                index: 100 + aiIdx,
                name: nameMatch ? nameMatch[1].trim() : `AI ${aiIdx}`,
                shortName: shortNameMatch ? shortNameMatch[1].trim() : '',
                team: teamMatch ? parseInt(teamMatch[1]) : -1,
                spectator: false,
                isAI: true,
                host: hostMatch ? parseInt(hostMatch[1]) : -1,
                country: ''
            });
        }
    }

    _parseDemoStream(data, view) {
        const streamStart = this.header.headerSize + this.header.scriptSize;
        let streamSize = this.header.demoStreamSize;

        // If demoStreamSize is 0, the engine crashed - read to EOF
        if (streamSize === 0) {
            streamSize = data.length - streamStart;
        }

        const streamEnd = streamStart + streamSize;
        let pos = streamStart;

        while (pos < streamEnd - 8) {
            const modGameTime = view.getFloat32(pos, true);
            const chunkLength = view.getUint32(pos + 4, true);
            pos += 8;

            if (chunkLength === 0 || pos + chunkLength > data.length) break;

            const msgType = this.data[pos];
            this._processMessage(msgType, data, view, pos, chunkLength, modGameTime);

            if (modGameTime > this.maxGameTime && modGameTime < 1e6) {
                this.maxGameTime = modGameTime;
            }

            pos += chunkLength;
        }
    }

    _processMessage(msgType, data, view, pos, length, gameTime) {
        switch (msgType) {
            case NETMSG.STARTPOS:
                this._parseStartPos(view, pos, length, gameTime);
                break;
            case NETMSG.SELECT:
                this._parseSelect(view, pos, length, gameTime);
                break;
            case NETMSG.COMMAND:
                this._parseCommand(view, pos, length, gameTime);
                break;
            case NETMSG.AICOMMAND:
                this._parseAICommand(view, pos, length, gameTime);
                break;
            case NETMSG.AICOMMAND_TRACKED:
                this._parseAICommandTracked(view, pos, length, gameTime);
                break;
            case NETMSG.AICOMMANDS:
                this._parseAICommands(data, view, pos, length, gameTime);
                break;
            case NETMSG.MAPDRAW:
                this._parseMapDraw(data, view, pos, length, gameTime);
                break;
            case NETMSG.CHAT:
                this._parseChat(data, pos, length, gameTime);
                break;
            case NETMSG.GAMEOVER:
                this.gameInfo.gameOver = true;
                break;
        }
    }

    _parseStartPos(view, pos, length, gameTime) {
        if (length < 16) return;
        const playerNum = this.data[pos + 1];
        const team = this.data[pos + 2];
        const ready = this.data[pos + 3];
        const x = view.getFloat32(pos + 4, true);
        const y = view.getFloat32(pos + 8, true);
        const z = view.getFloat32(pos + 12, true);

        if (isFinite(x) && isFinite(z)) {
            this.startPositions.push({ gameTime, playerNum, team, ready, x, y, z });
        }
    }

    /**
     * NETMSG_SELECT packet layout:
     * byte 0:    uint8   type (12)
     * byte 1-2:  uint16  packetSize
     * byte 3:    uint8   playerNum
     * byte 4+:   int16[] selectedUnitIDs
     */
    _parseSelect(view, pos, length, gameTime) {
        if (length < 4) return;
        const msgSize = view.getUint16(pos + 1, true);
        const playerNum = this.data[pos + 3];
        const numUnits = (msgSize - 4) / 2;
        const unitIds = [];
        for (let i = 0; i < numUnits; i++) {
            const offset = pos + 4 + i * 2;
            if (offset + 2 <= pos + length) {
                unitIds.push(view.getInt16(offset, true));
            }
        }
        this._currentSelection[playerNum] = unitIds;
        this.selections.push({ gameTime, playerNum, unitIds });
    }

    /**
     * NETMSG_COMMAND packet layout (from BaseNetProtocol.cpp SendCommand):
     * byte 0:    uint8   type (11)
     * byte 1-2:  uint16  packetSize
     * byte 3:    uint8   playerNum
     * byte 4-7:  int32   commandID
     * byte 8-11: int32   timeout
     * byte 12:   uint8   options
     * byte 13-16: uint32 numParams
     * byte 17+:  float[] params
     */
    _parseCommand(view, pos, length, gameTime) {
        if (length < 17) return;
        const playerNum = this.data[pos + 3];
        const cmdId = view.getInt32(pos + 4, true);
        const options = this.data[pos + 12];
        const numParams = view.getUint32(pos + 13, true);

        const params = [];
        for (let i = 0; i < Math.min(numParams, 8); i++) {
            const offset = pos + 17 + i * 4;
            if (offset + 4 <= pos + length) {
                params.push(view.getFloat32(offset, true));
            }
        }

        if (params.length >= 3 && isFinite(params[0]) && isFinite(params[2])) {
            const selectedUnits = this._currentSelection[playerNum] || [];
            this.commands.push({
                gameTime,
                playerNum,
                cmdId,
                category: classifyCommand(cmdId),
                name: getCommandName(cmdId),
                options,
                x: params[0],
                y: params[1],
                z: params[2],
                params,
                isAI: false,
                selectedUnitIds: selectedUnits.length > 0 ? [...selectedUnits] : undefined
            });
        }
    }

    /**
     * NETMSG_AICOMMAND packet layout (from BaseNetProtocol.cpp SendAICommand):
     * byte 0:    uint8   type (14)
     * byte 1-2:  uint16  packetSize
     * byte 3:    uint8   playerNum
     * byte 4:    uint8   aiInstID
     * byte 5:    uint8   aiTeamID
     * byte 6-7:  int16   unitID
     * byte 8-11: int32   commandID
     * byte 12-15: int32  timeout
     * byte 16:   uint8   options
     * byte 17-20: uint32 numParams
     * byte 21+:  float[] params
     */
    _parseAICommand(view, pos, length, gameTime) {
        if (length < 21) return;
        const playerNum = this.data[pos + 3];
        const aiTeamId = this.data[pos + 5];
        const unitId = view.getInt16(pos + 6, true);
        const cmdId = view.getInt32(pos + 8, true);
        const options = this.data[pos + 16];
        const numParams = view.getUint32(pos + 17, true);

        const params = [];
        for (let i = 0; i < Math.min(numParams, 8); i++) {
            const offset = pos + 21 + i * 4;
            if (offset + 4 <= pos + length) {
                params.push(view.getFloat32(offset, true));
            }
        }

        if (params.length >= 3 && isFinite(params[0]) && isFinite(params[2])) {
            this.commands.push({
                gameTime,
                playerNum,
                cmdId,
                category: classifyCommand(cmdId),
                name: getCommandName(cmdId),
                options,
                x: params[0],
                y: params[1],
                z: params[2],
                params,
                unitId,
                isAI: true
            });
        }
    }

    /**
     * NETMSG_AICOMMAND_TRACKED: same as AICOMMAND but with extra aiCommandId
     * byte 17-20: uint32 numParams
     * byte 21-24: int32  aiCommandId
     * byte 25+:   float[] params
     */
    _parseAICommandTracked(view, pos, length, gameTime) {
        if (length < 25) return;
        const playerNum = this.data[pos + 3];
        const aiTeamId = this.data[pos + 5];
        const unitId = view.getInt16(pos + 6, true);
        const cmdId = view.getInt32(pos + 8, true);
        const options = this.data[pos + 16];
        const numParams = view.getUint32(pos + 17, true);
        // aiCommandId at pos+21..24

        const params = [];
        for (let i = 0; i < Math.min(numParams, 8); i++) {
            const offset = pos + 25 + i * 4;
            if (offset + 4 <= pos + length) {
                params.push(view.getFloat32(offset, true));
            }
        }

        if (params.length >= 3 && isFinite(params[0]) && isFinite(params[2])) {
            this.commands.push({
                gameTime,
                playerNum,
                cmdId,
                category: classifyCommand(cmdId),
                name: getCommandName(cmdId),
                options,
                x: params[0],
                y: params[1],
                z: params[2],
                params,
                unitId,
                isAI: true
            });
        }
    }

    /**
     * NETMSG_AICOMMANDS - batch commands, complex format
     * byte 0:    uint8  type (15)
     * byte 1-2:  uint16 packetSize
     * byte 3:    uint8  playerNum
     * byte 4:    uint8  aiID
     * byte 5:    uint8  pairwise
     * byte 6-9:  uint32 sameCmdID
     * byte 10:   uint8  sameCmdOpt
     * byte 11-12: uint16 sameCmdParamSize
     * byte 13-14: int16 unitIDCount
     * ...unitIDs (unitIDCount * 2 bytes)
     * then int16 commandCount
     * then commands...
     */
    _parseAICommands(data, view, pos, length, gameTime) {
        if (length < 17) return;
        const playerNum = data[pos + 3];
        const pairwise = data[pos + 5];
        const sameCmdID = view.getUint32(pos + 6, true);
        const sameCmdOpt = data[pos + 10];
        const sameCmdParamSize = view.getUint16(pos + 11, true);
        const unitIDCount = view.getInt16(pos + 13, true);

        let offset = pos + 15;
        // Skip unit IDs
        offset += unitIDCount * 2;
        if (offset + 2 > pos + length) return;

        const commandCount = view.getInt16(offset, true);
        offset += 2;

        for (let c = 0; c < commandCount && offset < pos + length; c++) {
            let cmdId, cmdOpt, numCmdParams;

            if (sameCmdID === 0) {
                if (offset + 4 > pos + length) break;
                cmdId = view.getInt32(offset, true);
                offset += 4;
            } else {
                cmdId = sameCmdID;
            }

            if (sameCmdOpt === 0xFF) {
                if (offset >= pos + length) break;
                cmdOpt = data[offset];
                offset += 1;
            } else {
                cmdOpt = sameCmdOpt;
            }

            if (sameCmdParamSize === 0xFFFF) {
                if (offset + 2 > pos + length) break;
                numCmdParams = view.getUint16(offset, true);
                offset += 2;
            } else {
                numCmdParams = sameCmdParamSize / 4;
            }

            const params = [];
            for (let i = 0; i < Math.min(numCmdParams, 8); i++) {
                if (offset + 4 <= pos + length) {
                    params.push(view.getFloat32(offset, true));
                }
                offset += 4;
            }
            // Skip remaining params beyond 8
            if (numCmdParams > 8) {
                offset += (numCmdParams - 8) * 4;
            }

            if (params.length >= 3 && isFinite(params[0]) && isFinite(params[2])) {
                this.commands.push({
                    gameTime,
                    playerNum,
                    cmdId,
                    category: classifyCommand(cmdId),
                    name: getCommandName(cmdId),
                    options: cmdOpt,
                    x: params[0],
                    y: params[1],
                    z: params[2],
                    params,
                    isAI: true
                });
            }
        }
    }

    /**
     * NETMSG_MAPDRAW - map draw commands
     * Format depends on sub-command:
     * POINT: uint8 msgSize, uint8 playerNum, uint8 cmd=0, int32 x, int32 z, uint8 fromLua, string label
     * ERASE: uint8 type, uint8 msgSize=12, uint8 playerNum, uint8 cmd=1, int32 x, int32 z
     * LINE:  uint8 type, uint8 msgSize=21, uint8 playerNum, uint8 cmd=2, int32 x1, int32 z1, int32 x2, int32 z2, uint8 fromLua
     */
    _parseMapDraw(data, view, pos, length, gameTime) {
        if (length < 4) return;

        // Format: type(1), msgSize(1), playerNum(1), command(1), ...
        const playerNum = data[pos + 2];
        const drawCmd = data[pos + 3];

        if (drawCmd === MAPDRAW.POINT && length >= 12) {
            const x = view.getInt32(pos + 4, true);
            const z = view.getInt32(pos + 8, true);
            this.mapDrawings.push({ gameTime, playerNum, type: 'point', x, z });
        } else if (drawCmd === MAPDRAW.ERASE && length >= 12) {
            const x = view.getInt32(pos + 4, true);
            const z = view.getInt32(pos + 8, true);
            this.mapDrawings.push({ gameTime, playerNum, type: 'erase', x, z });
        } else if (drawCmd === MAPDRAW.LINE && length >= 20) {
            const x1 = view.getInt32(pos + 4, true);
            const z1 = view.getInt32(pos + 8, true);
            const x2 = view.getInt32(pos + 12, true);
            const z2 = view.getInt32(pos + 16, true);
            this.mapDrawings.push({ gameTime, playerNum, type: 'line', x1, z1, x2, z2 });
        }
    }

    _parseChat(data, pos, length, gameTime) {
        if (length < 4) return;
        const fromId = data[pos + 2];
        const destId = data[pos + 3];
        const msgBytes = data.slice(pos + 4, pos + length);
        const message = new TextDecoder().decode(msgBytes).replace(/\0/g, '');

        this.chatMessages.push({ gameTime, fromId, destId, message });
    }

    /**
     * Post-process: build unit tracking data from commands, selections, and start positions.
     * Creates:
     *   this.units - Map of unitId -> { playerNum, firstSeen, lastSeen, isCommander, events[] }
     *   this.buildings - Array of { gameTime, playerNum, x, z, unitDefId }
     */
    _buildUnitData() {
        this.units = new Map();
        this.buildings = [];

        // Build unitDefID -> name mapping for this specific game
        this.unitDefMapping = buildUnitDefMapping(this.script);

        // Identify commander unit IDs from the first SELECT per player
        // (first selected unit at game start is typically the commander)
        const commanderCandidates = {};
        for (const sel of this.selections) {
            if (sel.unitIds.length === 1 && !commanderCandidates[sel.playerNum]) {
                commanderCandidates[sel.playerNum] = sel.unitIds[0];
            }
        }

        // Also check first AI commands per player - the first unit to receive
        // a build order is likely the commander
        const firstAIBuildUnit = {};
        for (const cmd of this.commands) {
            if (cmd.isAI && cmd.unitId !== undefined && cmd.category === 'build' && !firstAIBuildUnit[cmd.playerNum]) {
                firstAIBuildUnit[cmd.playerNum] = cmd.unitId;
            }
        }

        // Merge commander candidates
        for (const [pn, uid] of Object.entries(firstAIBuildUnit)) {
            if (!commanderCandidates[pn]) commanderCandidates[pn] = uid;
        }

        // Get final start positions per player
        const playerStartPos = {};
        for (const sp of this.startPositions) {
            if (sp.x !== 0 || sp.z !== 0) {
                playerStartPos[sp.playerNum] = { x: sp.x, y: sp.y, z: sp.z };
            }
        }

        // Helper to get or create a unit entry
        const getUnit = (unitId, playerNum, gameTime) => {
            if (!this.units.has(unitId)) {
                const isCommander = Object.values(commanderCandidates).includes(unitId);
                this.units.set(unitId, {
                    unitId,
                    playerNum,
                    firstSeen: gameTime,
                    lastSeen: gameTime,
                    isCommander,
                    role: isCommander ? 'commander' : 'unknown',
                    events: []
                });
            }
            const unit = this.units.get(unitId);
            unit.lastSeen = Math.max(unit.lastSeen, gameTime);
            return unit;
        };

        // Process all commands to build unit data
        for (const cmd of this.commands) {
            // AI commands have direct unit IDs
            if (cmd.unitId !== undefined) {
                const unit = getUnit(cmd.unitId, cmd.playerNum, cmd.gameTime);
                unit.events.push({
                    gameTime: cmd.gameTime,
                    cmdId: cmd.cmdId,
                    category: cmd.category,
                    x: cmd.x, z: cmd.z
                });

                // Classify unit role
                if (cmd.category === 'build' && cmd.cmdId < 0 && unit.role !== 'commander') {
                    unit.role = 'builder';
                } else if ((cmd.category === 'move' || cmd.category === 'patrol') && unit.role === 'unknown') {
                    unit.role = 'mobile';
                } else if (cmd.category === 'attack' && unit.role !== 'commander') {
                    unit.role = 'combat';
                }
            }

            // Player commands apply to selected units
            if (!cmd.isAI && cmd.selectedUnitIds) {
                for (const uid of cmd.selectedUnitIds) {
                    const unit = getUnit(uid, cmd.playerNum, cmd.gameTime);
                    unit.events.push({
                        gameTime: cmd.gameTime,
                        cmdId: cmd.cmdId,
                        category: cmd.category,
                        x: cmd.x, z: cmd.z
                    });
                    if (cmd.category === 'attack' && unit.role !== 'commander') {
                        unit.role = 'combat';
                    } else if ((cmd.category === 'move' || cmd.category === 'patrol') && unit.role === 'unknown') {
                        unit.role = 'mobile';
                    }
                }
            }

            // Track buildings from build commands
            if (cmd.category === 'build' && cmd.cmdId < 0) {
                const defId = -cmd.cmdId;
                this.buildings.push({
                    gameTime: cmd.gameTime,
                    playerNum: cmd.playerNum,
                    x: cmd.x,
                    z: cmd.z,
                    unitDefId: defId,
                    unitName: getUnitDefName(defId, this.unitDefMapping),
                    internalName: getUnitInternalName(defId, this.unitDefMapping),
                    facing: cmd.params.length >= 4 ? cmd.params[3] : 0
                });
            }
        }

        // Set commander initial positions from start positions
        for (const [pn, uid] of Object.entries(commanderCandidates)) {
            const unit = this.units.get(uid);
            if (unit && playerStartPos[pn]) {
                const sp = playerStartPos[pn];
                unit.events.unshift({
                    gameTime: 0,
                    cmdId: -1,
                    category: 'spawn',
                    x: sp.x, z: sp.z
                });
            }
        }

        // Also track units from selections that had no commands
        for (const sel of this.selections) {
            for (const uid of sel.unitIds) {
                if (!this.units.has(uid)) {
                    getUnit(uid, sel.playerNum, sel.gameTime);
                }
            }
        }
    }

    _readString(data, offset, maxLen) {
        const bytes = data.slice(offset, offset + maxLen);
        const nullIdx = bytes.indexOf(0);
        const end = nullIdx >= 0 ? nullIdx : maxLen;
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, end));
    }
}

// Export for use in viewer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ReplayParser, CMD, CMD_NAMES, ZK_UNIT_HUMANNAMES, classifyCommand, buildUnitDefMapping, getUnitDefName, getUnitInternalName };
}
if (typeof window !== 'undefined') {
    window.ReplayParser = ReplayParser;
    window.classifyCommand = classifyCommand;
    window.CMD = CMD;
    window.CMD_NAMES = CMD_NAMES;
    window.ZK_UNIT_HUMANNAMES = ZK_UNIT_HUMANNAMES;
    window.buildUnitDefMapping = buildUnitDefMapping;
    window.getUnitDefName = getUnitDefName;
    window.getUnitInternalName = getUnitInternalName;
}
