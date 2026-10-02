// Faster Clothes Change Redux v1.0
// Original mod / animation: Junior_Djjr
// CLEO Redux port/remaster: Flaqko project
// Target: GTA San Andreas Classic 1.0 US + CLEO Redux
//
// Strategy:
// - Load Junior_Djjr's stripped clothing animations as a private block FClothes.
// - DO NOT assign TASK_PLAY_ANIM to CJ.
// - Instead, redirect the already-loaded vanilla CLOTHES hierarchies to use
//   Junior's FClothes sequence data while keeping the original CLOTHES hierarchy
//   addresses/block identity intact.
// - This lets GTA's own wardrobe task/state machine remain fully in control.

const MOD = "FasterClothesChange";
const VERSION = "v1.0";
const PLAYER = 0;
const DEBUG = false;

const SCRIPT_SPACE = 0xA49960;
const CLOTHES_STATE_ADDR = SCRIPT_SPACE + (9990 * 4); // $9990

const VANILLA_BLOCK = "CLOTHES";
const PRIVATE_BLOCK = "FClothes";
const IFP_PATH = __dirname + "\\animations\\FClothes.ifp";

const ALL_CLOTHES_ANIMS = [
    "CLO_Buy",
    "CLO_In",
    "CLO_Out",
    "CLO_Pose_Hat",
    "CLO_Pose_In",
    "CLO_Pose_In_O",
    "CLO_Pose_Legs",
    "CLO_Pose_Loop",
    "CLO_Pose_Out",
    "CLO_Pose_Out_O",
    "CLO_Pose_Shoes",
    "CLO_Pose_Torso",
    "CLO_Pose_Watch"
];

const CAMERA_POSES = [
    "CLO_Pose_Hat",
    "CLO_Pose_Legs",
    "CLO_Pose_Shoes",
    "CLO_Pose_Torso",
    "CLO_Pose_Watch"
];

const SA = {
    RW_STREAM_OPEN: 0x7ECEF0,
    RW_STREAM_CLOSE: 0x7ECE20,
    ANIM_LOAD_FILE: 0x4D47F0,
    ANIM_GET_BLOCK: 0x4D3940,
    ANIM_GET_ANIMATION: 0x4D42F0,
    ANIM_UNCOMPRESS: 0x4D41C0
};

// CAnimBlendHierarchy layout (Classic SA 1.0):
// +0x00 hash
// +0x04 sequence pointer
// +0x08 sequence count (u16)
// +0x0A running compressed (u8)
// +0x0B misc byte
// +0x0C anim block id (KEEP VANILLA)
// +0x10 total time
// +0x14 misc dword
const HIER = {
    SEQUENCES: 0x04,
    SEQ_COUNT: 0x08,
    COMPRESSED: 0x0A,
    FIELD_B: 0x0B,
    TOTAL_TIME: 0x10,
    FIELD_14: 0x14
};

function modLog(msg) {
    if (DEBUG) log(`[${MOD}] ${msg}`);
}

function cdecl(address, ...args) {
    Memory.CallFunction(address, args.length, args.length, ...args);
}

function cdeclRet(address, ...args) {
    const v = Memory.CallFunctionReturn(address, args.length, args.length, ...args);
    return v === undefined || v === null ? 0 : Memory.ToU32(v);
}

function readClothesState() {
    return Memory.ReadI32(CLOTHES_STATE_ADDR, false);
}

function inWardrobeState(state) {
    return state > 3 && state < 8;
}

function getBlock(name) {
    return cdeclRet(SA.ANIM_GET_BLOCK, name);
}

function getAnim(blockPtr, name) {
    if (!blockPtr) return 0;
    return cdeclRet(SA.ANIM_GET_ANIMATION, name, blockPtr);
}

function loadPrivateIfp() {
    let block = getBlock(PRIVATE_BLOCK);
    if (block) {
        modLog(`FClothes already resident at 0x${block.toString(16).toUpperCase()}.`);
        return block;
    }

    modLog(`Opening private IFP: ${IFP_PATH}`);
    const stream = cdeclRet(SA.RW_STREAM_OPEN, 2, 1, IFP_PATH);
    if (!stream) {
        modLog("ERROR: RwStreamOpen returned NULL.");
        return 0;
    }

    try {
        cdecl(SA.ANIM_LOAD_FILE, stream, 1, 0);
    } finally {
        cdeclRet(SA.RW_STREAM_CLOSE, stream, 0);
    }

    block = getBlock(PRIVATE_BLOCK);
    if (!block) {
        modLog("ERROR: FClothes block not registered after load.");
        return 0;
    }

    let found = 0;
    for (const name of ALL_CLOTHES_ANIMS) {
        if (getAnim(block, name)) found++;
    }
    modLog(`FClothes validation: ${found}/${ALL_CLOTHES_ANIMS.length} animations found.`);
    return found === ALL_CLOTHES_ANIMS.length ? block : 0;
}

function initialisePrivateHierarchy(privateHier, name) {
    try {
        // GTA normally does this when an animation is actually added/blended.
        // Our private block is only a donor, so initialise it explicitly first.
        cdecl(SA.ANIM_UNCOMPRESS, privateHier);
    } catch (e) {
        modLog(`ERROR ${name}: UncompressAnimation failed: ${String(e)}`);
        return false;
    }

    const seq = Memory.ReadU32(privateHier + HIER.SEQUENCES, false);
    const count = Memory.ReadU16(privateHier + HIER.SEQ_COUNT, false);
    const time = Memory.ReadFloat(privateHier + HIER.TOTAL_TIME, false);

    modLog(
        `INIT ${name}: seq=0x${seq.toString(16).toUpperCase()} ` +
        `count=${count} time=${Number.isFinite(time) ? time.toFixed(4) : "?"}`
    );

    return !!seq && count > 0 && Number.isFinite(time) && time > 0.0;
}

function patchOneHierarchy(vanillaHier, privateHier, name) {
    if (!initialisePrivateHierarchy(privateHier, name)) {
        modLog(`ERROR ${name}: private hierarchy did not initialise to a positive duration.`);
        return false;
    }

    const privateSeq = Memory.ReadU32(privateHier + HIER.SEQUENCES, false);
    const privateCount = Memory.ReadU16(privateHier + HIER.SEQ_COUNT, false);
    const privateCompressed = Memory.ReadU8(privateHier + HIER.COMPRESSED, false);
    const privateFieldB = Memory.ReadU8(privateHier + HIER.FIELD_B, false);
    const privateTime = Memory.ReadFloat(privateHier + HIER.TOTAL_TIME, false);

    if (!privateSeq || privateCount === 0) {
        modLog(`ERROR ${name}: private hierarchy has no sequence data.`);
        return false;
    }

    // Preserve hash and vanilla anim-block ID. Only redirect the playable data.
    Memory.WriteU32(vanillaHier + HIER.SEQUENCES, privateSeq, false);
    Memory.WriteU16(vanillaHier + HIER.SEQ_COUNT, privateCount, false);
    Memory.WriteU8(vanillaHier + HIER.COMPRESSED, privateCompressed, false);
    Memory.WriteU8(vanillaHier + HIER.FIELD_B, privateFieldB, false);
    Memory.WriteFloat(vanillaHier + HIER.TOTAL_TIME, privateTime, false);

    const checkSeq = Memory.ReadU32(vanillaHier + HIER.SEQUENCES, false);
    const checkCount = Memory.ReadU16(vanillaHier + HIER.SEQ_COUNT, false);
    const checkTime = Memory.ReadFloat(vanillaHier + HIER.TOTAL_TIME, false);

    modLog(
        `PATCH ${name}: vanillaHier=0x${vanillaHier.toString(16).toUpperCase()} ` +
        `privateHier=0x${privateHier.toString(16).toUpperCase()} ` +
        `seq=0x${checkSeq.toString(16).toUpperCase()} count=${checkCount} ` +
        `time=${Number.isFinite(checkTime) ? checkTime.toFixed(4) : "?"}`
    );

    return checkSeq === privateSeq && checkCount === privateCount;
}

function patchVanillaClothesHierarchies(privateBlock) {
    const vanillaBlock = getBlock(VANILLA_BLOCK);
    if (!vanillaBlock) {
        modLog("ERROR: vanilla CLOTHES animation block was not found.");
        return false;
    }

    let patched = 0;
    for (const name of ALL_CLOTHES_ANIMS) {
        const vanillaHier = getAnim(vanillaBlock, name);
        const privateHier = getAnim(privateBlock, name);

        if (!vanillaHier || !privateHier) {
            modLog(`ERROR ${name}: vanilla=${!!vanillaHier} private=${!!privateHier}`);
            continue;
        }

        if (patchOneHierarchy(vanillaHier, privateHier, name)) patched++;
    }

    modLog(`Hierarchy redirect result: ${patched}/${ALL_CLOTHES_ANIMS.length} patched.`);
    return patched === ALL_CLOTHES_ANIMS.length;
}

function currentCameraPose(cj) {
    for (const name of CAMERA_POSES) {
        try {
            if (native("IS_CHAR_PLAYING_ANIM", cj, name)) return name;
        } catch (_) {}
    }
    return "default";
}

function vec(v) {
    if (!v) return null;
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) return v;
    if (Array.isArray(v) && v.length >= 3) return { x: v[0], y: v[1], z: v[2] };
    const nums = [];
    for (const k in v) {
        if (typeof v[k] === "number" && Number.isFinite(v[k])) nums.push(v[k]);
    }
    return nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;
}

function cameraPair(cj, pose) {
    let camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.7, 1.8, 0.1);
    let target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, -0.1);

    if (pose === "CLO_Pose_Hat") {
        camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.4, 0.8, 0.6);
        target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, 0.5);
    } else if (pose === "CLO_Pose_Legs") {
        camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.5, 1.1, -0.3);
        target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, -0.35);
    } else if (pose === "CLO_Pose_Shoes") {
        camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.5, 1.1, -0.4);
        target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, -0.7);
    } else if (pose === "CLO_Pose_Torso") {
        camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.5, 1.1, 0.4);
        target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, 0.35);
    } else if (pose === "CLO_Pose_Watch") {
        camera = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, -0.5, 1.0, 0.0);
        target = native("GET_OFFSET_FROM_CHAR_IN_WORLD_COORDS", cj, 0.0, 0.0, 0.0);
    }

    return { camera: vec(camera), target: vec(target) };
}

if (HOST !== "sa") {
    modLog(`Unsupported host '${HOST}'. Classic GTA SA is required.`);
    exit();
}

const privateBlock = loadPrivateIfp();
if (!privateBlock) {
    modLog("FATAL: private FClothes block failed to load.");
    exit();
}

// CLOTHES is normally streamed only when the wardrobe system needs it.
// v0.5 tried to patch at boot, before that vanilla block existed, so it found
// 0/13 and terminated. Keep the vanilla block requested/resident and patch it
// only after GTA has actually registered it.
let clothesPatched = false;
let lastVanillaBlock = 0;
let nextPatchAttemptAt = 0;
let requestLogged = false;

function ensureVanillaClothesPatched() {
    const now = Date.now();

    let vanillaBlock = getBlock(VANILLA_BLOCK);

    // If GTA unloaded/recreated CLOTHES, the hierarchy addresses may change.
    // Treat a new block pointer as needing a fresh redirect.
    if (clothesPatched && vanillaBlock && vanillaBlock === lastVanillaBlock) {
        return true;
    }

    if (clothesPatched && vanillaBlock !== lastVanillaBlock) {
        modLog("Vanilla CLOTHES block changed; re-patching new resident block.");
        clothesPatched = false;
    }

    if (!vanillaBlock) {
        if (now < nextPatchAttemptAt) return false;
        nextPatchAttemptAt = now + 250;

        try {
            native("REQUEST_ANIMATION", VANILLA_BLOCK);
            if (!requestLogged) {
                modLog("Requested vanilla CLOTHES animation block; waiting for GTA to stream it.");
                requestLogged = true;
            }
        } catch (e) {
            modLog("REQUEST_ANIMATION CLOTHES failed: " + String(e));
        }
        return false;
    }

    // CAnimBlock can exist before its hierarchies have actually streamed.
    // v0.6 spammed 0/13 attempts during that window. Wait for one known
    // vanilla hierarchy before attempting the full redirect.
    const vanillaSentinel = getAnim(vanillaBlock, "CLO_In");
    if (!vanillaSentinel) {
        if (!requestLogged) {
            modLog("Vanilla CLOTHES block registered but hierarchy data is not streamed yet; waiting for CLO_In.");
            requestLogged = true;
        }
        return false;
    }

    requestLogged = false;

    if (now < nextPatchAttemptAt) return false;
    nextPatchAttemptAt = now + 1000;

    modLog(`Vanilla CLOTHES hierarchies ready at 0x${vanillaBlock.toString(16).toUpperCase()}; initialising Junior donor data, then redirecting.`);

    if (!patchVanillaClothesHierarchies(privateBlock)) {
        modLog("Patch attempt incomplete; will retry after 1 second.");
        return false;
    }

    clothesPatched = true;
    lastVanillaBlock = vanillaBlock;
    modLog("SUCCESS: 13/13 vanilla CLOTHES hierarchies now use INITIALIZED Junior_Djjr stripped animation data.");
    return true;
}

modLog(`${VERSION} loaded. FClothes donor hierarchies initialize through GTA before redirecting vanilla CLOTHES; camera-hold behavior enabled.`);

while (true) {
    wait(0);

    if (!native("IS_PLAYER_PLAYING", PLAYER)) continue;

    // Keep trying even before the first wardrobe visit. Once REQUEST_ANIMATION
    // makes CLOTHES resident, patching happens exactly once for that block.
    ensureVanillaClothesPatched();

    if (!inWardrobeState(readClothesState())) continue;

    // A wardrobe can begin on the same frame CLOTHES is streamed. Give the
    // redirect a chance to complete before the clothing animation progresses.
    let patchWaitStart = Date.now();
    while (!ensureVanillaClothesPatched() && inWardrobeState(readClothesState())) {
        wait(0);
        if (Date.now() - patchWaitStart > 3000) {
            modLog("Wardrobe patch wait exceeded 3000ms; leaving vanilla behavior for this attempt.");
            break;
        }
    }

    // Match Junior_Djjr's original: wait until wardrobe removes player control.
    while (
        native("IS_PLAYER_PLAYING", PLAYER) &&
        native("IS_PLAYER_CONTROL_ON", PLAYER) &&
        inWardrobeState(readClothesState())
    ) {
        wait(0);
    }

    if (!native("IS_PLAYER_PLAYING", PLAYER) || !inWardrobeState(readClothesState())) continue;

    const cj = native("GET_PLAYER_CHAR", PLAYER);
    if (!cj || !native("DOES_CHAR_EXIST", cj)) continue;

    const startedAt = Date.now();

    // Match Junior_Djjr's original camera behavior exactly:
    // establish the default wardrobe camera once, then only replace the stored
    // coordinates when one of the five body-part pose animations is observed.
    // The original does NOT snap back to the default camera when the very short
    // pose animation ends. v0.7 did, which caused a one-frame camera flash.
    let heldCamera = cameraPair(cj, "default");
    let heldPose = "default";
    modLog(`wardrobe camera active. state=${readClothesState()} cameraHold=default`);

    while (inWardrobeState(readClothesState())) {
        wait(0);

        if (!native("IS_PLAYER_PLAYING", PLAYER)) break;
        if (native("IS_PLAYER_CONTROL_ON", PLAYER)) break;

        const pose = currentCameraPose(cj);

        // Only a real body-part pose changes the held camera. "default" means
        // no recognized pose is active this frame; keep the last coordinates.
        if (pose !== "default" && pose !== heldPose) {
            const nextCamera = cameraPair(cj, pose);
            if (nextCamera.camera && nextCamera.target) {
                heldCamera = nextCamera;
                heldPose = pose;
                modLog(`camera hold -> ${pose}`);
            }
        }

        if (heldCamera.camera && heldCamera.target) {
            native("SET_FIXED_CAMERA_POSITION", heldCamera.camera.x, heldCamera.camera.y, heldCamera.camera.z, 0.0, 0.0, 0.0);
            native("POINT_CAMERA_AT_POINT", heldCamera.target.x, heldCamera.target.y, heldCamera.target.z, 2);
        }
    }

    try {
        native("RESTORE_CAMERA_JUMPCUT");
        native("SET_CAMERA_BEHIND_PLAYER");
    } catch (_) {}

    modLog(`wardrobe camera restored. duration=${Date.now() - startedAt}ms`);
}
