// Portronics Hydra 10 — 2.4 GHz dongle plugin for SignalRGB
//
// The wired board (258A:010C) uses a 519-byte feature report. The Compx
// receiver (3554:FA09) is a completely different device: it carries lighting
// on output report 0x13 (19 data bytes) of its vendor interface, using command
// 0x88 and a chunked frame format.
//
// All values below were verified on hardware. The app only ever sends the
// live-lighting command 0x88; the non-volatile config command 0x04 is
// deliberately not implemented.

export function Name() { return "Portronics Hydra 10 (2.4 GHz)"; }
export function VendorId() { return 0x3554; }
export function ProductId() { return [0xfa09]; }
export function Publisher() { return "WhirlwindFx"; }
export function Size() { return [1, 5]; }
export function DeviceType() { return "keyboard"; }

// The receiver exposes two interfaces: 0 is the boot keyboard, 1 carries
// several collections. Only the 0xFF02 collection (usage 0x02) has the
// 19-byte output report 0x13; interface 1 also contains a 0xFF04 feature
// report, so matching the interface alone can select the wrong endpoint.
export function Validate(endpoint) {
	return endpoint.usage_page === 0xff02;
}

export function ControllableParameters() {
	return [
		{property: "shutdownColor", group: "lighting", label: "Shutdown Color", type: "color", default: "#000000"},
		{property: "LightingMode", group: "lighting", label: "Lighting Mode", type: "combobox", values: ["Canvas", "Forced"], default: "Canvas"},
		{property: "forcedColor", group: "lighting", label: "Forced Color", type: "color", default: "#009bde"},
		{property: "frameChunks", group: "lighting", label: "Frame size (6 = smoothest, 10 = most accurate colors)", type: "number", min: "6", max: "10", step: "1", default: "7"},
	];
}

export function Initialize() {
	HYDRA10_DONGLE.Initialize();
}

export function Render() {
	HYDRA10_DONGLE.sendColors();
}

export function Shutdown(SystemSuspending) {
	const color = SystemSuspending ? "#000000" : shutdownColor;
	HYDRA10_DONGLE.sendColors(color);
}

// ---------------------------------------------------------------------------
// Wireless frame format (verified on hardware)
//
//   20 bytes on the wire, 19 bytes of report data:
//   [cmd=0x88][totalChunks][chunkIndex][0x10+len][14 payload][checksum]
//
// The payload is a sequence of groups: [R, G, B, count, ledIndex...].
// checksum = (0x13 + sum(bytes 0..18)) & 0xff.
// ---------------------------------------------------------------------------

const DONGLE_REPORT_ID = 0x13;
const DONGLE_REPORT_SIZE = 19; // data bytes; the report ID is added separately
const DONGLE_CHUNK = 14;
const DONGLE_MAX_CHUNKS = 10;
const DONGLE_CMD_LIGHTING = 0x88;
const DONGLE_CHUNKS_PER_SEC = 60; // below the measured clean ceiling of ~64
const DONGLE_CHUNK_GAP_MS = 13; // vendor-measured minimum, start-to-start
const DONGLE_KEYFRAME_MS = 1000;
const DONGLE_LED_COUNT = 96;

// Smoothness tuning ----------------------------------------------------------
// Delta mode sends only the LEDs whose colour changed, biggest change first,
// capped at DONGLE_DELTA_CHUNKS chunks per frame. Short frames mean a much
// higher frame rate. It relies on the keyboard holding the colour of LEDs that
// are left out of a frame. On the Hydra 10 dongle this is NOT the case (keys
// flash back to the firmware effect), so it stays false.
const DONGLE_DELTA_MODE = false;

// Smooth mode: every frame is a full frame, but its colours are clustered down
// to as few groups as the chunk budget allows. A full frame must name all 68
// keys (68 bytes) plus 4 bytes per colour, so:
//   6 chunks = 4 colours (10 fps)   7 chunks = 7 colours (8.5 fps)
//   8 chunks = 11 colours (7.5 fps) 10 chunks = 18 colours (6 fps)
// The "Frame size" slider picks the chunk budget.
const DONGLE_SMOOTH_MODE = true;
const DONGLE_DELTA_CHUNKS = 4;   // ~15 fps worst case at 60 chunks/s
const DONGLE_QUANT_STEP = 8;     // RGB rounding step in delta mode (bigger = fewer updates)

const DONGLE_PALETTES = [
	{exact: true},
	{h: 12, s: 2, v: 4},
	{h: 8, s: 2, v: 3},
	{h: 6, s: 2, v: 2},
	{h: 4, s: 2, v: 2},
	{h: 3, s: 2, v: 1},
	{h: 2, s: 2, v: 1},
	{h: 1, s: 1, v: 1},
];

function dongleRgbToHsv(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max === 0 ? 0 : d / max, max];
}

function dongleHsvToRgb(h, s, v) {
	h = ((h % 360) + 360) % 360;
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r, g, b;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function dongleQuantizeHsv(rgb, hSteps, sSteps, vSteps) {
	const [h, s, v] = dongleRgbToHsv(rgb[0], rgb[1], rgb[2]);
	if (v < 0.04) return [0, 0, 0];
	const hq = hSteps <= 1 ? 0 : (Math.round((h / 360) * hSteps) % hSteps);
	const sq = sSteps <= 1 ? s : Math.round(s * (sSteps - 1)) / (sSteps - 1);
	// Floor non-black colours to one value step so dim effects don't vanish.
	const vq = vSteps <= 1 ? v : Math.max(1 / (vSteps - 1), Math.round(v * (vSteps - 1)) / (vSteps - 1));
	return dongleHsvToRgb((hq / hSteps) * 360, sq, vq);
}

function dongleBuildGroups(perLed, palette, indices) {
	const buckets = new Map();
	for (const i of indices) {
		let c = perLed[i] || [0, 0, 0];
		c = [c[0] | 0, c[1] | 0, c[2] | 0];
		if (!palette.exact) c = dongleQuantizeHsv(c, palette.h, palette.s, palette.v);
		const k = `${c[0]},${c[1]},${c[2]}`;
		if (!buckets.has(k)) buckets.set(k, {color: c, indices: []});
		buckets.get(k).indices.push(i);
	}
	return Array.from(buckets.values());
}

function dongleEncodeGroups(groups) {
	const out = [];
	for (const g of groups) {
		out.push(g.color[0], g.color[1], g.color[2], g.indices.length);
		for (const idx of g.indices) out.push(idx);
	}
	return out;
}

function dongleChunkPayload(payload) {
	if (!payload.length) return [];
	const total = Math.ceil(payload.length / DONGLE_CHUNK);
	if (total > 255) return [];
	const chunks = [];
	for (let i = 0; i < total; i++) {
		const part = payload.slice(i * DONGLE_CHUNK, (i + 1) * DONGLE_CHUNK);
		const data = new Array(DONGLE_REPORT_SIZE).fill(0);
		data[0] = DONGLE_CMD_LIGHTING;
		data[1] = total;
		data[2] = i;
		data[3] = 0x10 + part.length;
		for (let j = 0; j < part.length; j++) data[4 + j] = part[j];
		// Checksum covers the real report-ID byte (0x13) + bytes 0..17.
		let sum = DONGLE_REPORT_ID;
		for (let j = 0; j < 18; j++) sum = (sum + data[j]) & 0xff;
		data[18] = sum;
		chunks.push(data);
	}
	return chunks;
}

function dongleAverageGroups(perLed, indices) {
	let r = 0, g = 0, b = 0;
	for (const i of indices) {
		const c = perLed[i] || [0, 0, 0];
		r += c[0]; g += c[1]; b += c[2];
	}
	return [{
		color: [Math.round(r / indices.length), Math.round(g / indices.length), Math.round(b / indices.length)],
		indices,
	}];
}

// Pick the richest palette that still fits one frame's chunk budget.
// `indices` lets animation frames carry only the 68 mapped keys, while the
// periodic keyframe covers all 96 slots so the unmapped ones stay black.
function dongleBuildChunks(perLed, indices) {
	for (const palette of DONGLE_PALETTES) {
		const chunks = dongleChunkPayload(dongleEncodeGroups(dongleBuildGroups(perLed, palette, indices)));
		if (chunks.length && chunks.length <= DONGLE_MAX_CHUNKS) return chunks;
	}
	return dongleChunkPayload(dongleEncodeGroups(dongleAverageGroups(perLed, indices)));
}

// Keyframe: pick the palette from the 68 mapped keys only (so colours do not
// shift when a keyframe goes out), then apply it to all 96 slots.
function dongleBuildFull(perLed, keyIndices, allIndices) {
	let groups = null;
	for (const palette of DONGLE_PALETTES) {
		const probe = dongleChunkPayload(dongleEncodeGroups(dongleBuildGroups(perLed, palette, keyIndices)));
		if (probe.length && probe.length <= DONGLE_MAX_CHUNKS) {
			groups = dongleBuildGroups(perLed, palette, allIndices);
			break;
		}
	}
	if (!groups) groups = dongleAverageGroups(perLed, allIndices);
	return {chunks: dongleChunkPayload(dongleEncodeGroups(groups)), groups};
}

function dongleQuantizeRgb(c, step) {
	const q = (v) => Math.min(255, Math.round(v / step) * step);
	return [q(c[0] | 0), q(c[1] | 0), q(c[2] | 0)];
}

function dongleColorDist(a, b) {
	const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
	return 2 * dr * dr + 4 * dg * dg + 3 * db * db; // eye is most sensitive to green
}

function dongleMeanColor(list) {
	let r = 0, g = 0, b = 0;
	for (const p of list) { r += p[0]; g += p[1]; b += p[2]; }
	const n = list.length || 1;
	return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// Median cut: repeatedly split the box with the most colour spread.
function dongleMedianCut(pts, k) {
	const boxes = [pts.slice()];
	while (boxes.length < k) {
		let bi = -1, bScore = 0, bCh = 0;
		for (let i = 0; i < boxes.length; i++) {
			const box = boxes[i];
			if (box.length < 2) continue;
			for (let ch = 0; ch < 3; ch++) {
				let lo = 255, hi = 0;
				for (const p of box) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
				const score = (hi - lo) * box.length * (ch === 1 ? 2 : 1);
				if (score > bScore) { bScore = score; bi = i; bCh = ch; }
			}
		}
		if (bi < 0) break;
		const box = boxes[bi];
		box.sort((x, y) => x[bCh] - y[bCh]);
		const mid = box.length >> 1;
		boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
	}
	return boxes.map(dongleMeanColor);
}

// Cluster the LEDs' colours into at most k groups. Seeding k-means with last
// frame's centres keeps the groups stable, so colours do not shimmer.
function dongleCluster(perLed, indices, k, seeds) {
	const pts = indices.map((i) => {
		const c = perLed[i] || [0, 0, 0];
		return [c[0] | 0, c[1] | 0, c[2] | 0];
	});

	const distinct = new Map();
	for (let n = 0; n < pts.length; n++) {
		const key = pts[n][0] + "," + pts[n][1] + "," + pts[n][2];
		if (!distinct.has(key)) distinct.set(key, {color: pts[n], indices: []});
		distinct.get(key).indices.push(indices[n]);
	}
	if (distinct.size <= k) return {groups: Array.from(distinct.values()), centers: null}; // lossless

	let centers = (seeds && seeds.length === k) ? seeds.map((c) => c.slice()) : dongleMedianCut(pts, k);
	const assign = new Array(pts.length).fill(0);
	for (let iter = 0; iter < 4; iter++) {
		for (let n = 0; n < pts.length; n++) {
			let best = 0, bestD = Infinity;
			for (let c = 0; c < centers.length; c++) {
				const d = dongleColorDist(pts[n], centers[c]);
				if (d < bestD) { bestD = d; best = c; }
			}
			assign[n] = best;
		}
		if (iter === 3) break;
		const members = centers.map(() => []);
		for (let n = 0; n < pts.length; n++) members[assign[n]].push(pts[n]);
		centers = centers.map((c, i) => (members[i].length ? dongleMeanColor(members[i]) : c));
	}

	const out = centers.map((c) => ({color: c, indices: []}));
	for (let n = 0; n < pts.length; n++) out[assign[n]].indices.push(indices[n]);
	return {groups: out.filter((g) => g.indices.length), centers};
}

// Delta frame: LEDs whose colour differs from what the keyboard shows,
// largest error first, packed until the chunk budget is full. Colours that
// do not fit this frame stay "unsent" and are picked up by a later frame.
function dongleBuildDelta(perLed, shown, indices, maxChunks) {
	const changed = [];
	for (const i of indices) {
		const t = dongleQuantizeRgb(perLed[i] || [0, 0, 0], DONGLE_QUANT_STEP);
		const s = shown[i];
		let err = 768;
		if (s) {
			err = Math.abs(t[0] - s[0]) + Math.abs(t[1] - s[1]) + Math.abs(t[2] - s[2]);
			if (!err) continue;
		}
		changed.push({i, c: t, err});
	}
	if (!changed.length) return {chunks: [], sent: []};
	changed.sort((a, b) => b.err - a.err);

	const budget = maxChunks * DONGLE_CHUNK;
	const buckets = new Map();
	const sent = [];
	let used = 0;
	for (const e of changed) {
		const k = e.c[0] + "," + e.c[1] + "," + e.c[2];
		const g = buckets.get(k);
		const cost = g ? 1 : 5; // joining a colour group costs 1 byte, a new group 5
		if (used + cost > budget) continue;
		used += cost;
		if (g) g.indices.push(e.i);
		else buckets.set(k, {color: e.c, indices: [e.i]});
		sent.push(e);
	}
	return {chunks: dongleChunkPayload(dongleEncodeGroups(Array.from(buckets.values()))), sent};
}

function dongleHashChunks(chunks) {
	let h = 2166136261 >>> 0;
	for (const c of chunks) {
		for (let i = 0; i < c.length; i++) {
			h ^= c[i];
			h = Math.imul(h, 16777619);
		}
	}
	return h >>> 0;
}

export class Hydra10_Dongle_Protocol {
	constructor() {
		this.Config = {
			ModelID: 133,
			DeviceName: "Portronics Hydra 10 (2.4 GHz)",
			LedNames: [],
			LedPositions: [],
			Leds: [],
			layout: "68-Key"
		};
		this.resetState();
	}

	resetState() {
		this.lastKeyHash = null;
		this.lastFullAt = 0;
		this.nextFrameAt = 0;
		this.loggedChunks = 0;
		this.shown = new Array(DONGLE_LED_COUNT).fill(null); // colour each LED is known to show
		this.centers = null; // last frame's colour clusters (smooth mode)
	}

	// One smooth frame: cluster the 68 keys into as many colours as the chunk
	// budget allows. On a keyframe the 28 unmapped slots ride along as black.
	buildSmooth(perLed, withUnmapped) {
		const want = (typeof frameChunks === "undefined") ? 7 : Math.round(Number(frameChunks)) || 7;
		const chunks = Math.max(6, Math.min(DONGLE_MAX_CHUNKS, want));
		const keys = this.Config.Leds;
		const k = Math.max(1, Math.floor((chunks * DONGLE_CHUNK - keys.length) / 4));

		const res = dongleCluster(perLed, keys, k, this.centers);
		this.centers = res.centers;
		const groups = res.groups;

		if (withUnmapped && this.unmapped.length) {
			const black = groups.find((g) => g.color[0] === 0 && g.color[1] === 0 && g.color[2] === 0);
			if (black) black.indices = black.indices.concat(this.unmapped);
			else groups.push({color: [0, 0, 0], indices: this.unmapped.slice()});
		}
		return {chunks: dongleChunkPayload(dongleEncodeGroups(groups)), groups};
	}

	getLedPositions() { return this.Config.LedPositions; }
	getLeds() { return this.Config.Leds; }
	getLedNames() { return this.Config.LedNames; }
	getModelID() { return this.Config.ModelID; }

	Initialize() {
		const layoutData = HYDRA10_DONGLE_LIBRARY.LEDLayout["68-Key"];

		this.Config.LedNames = layoutData.vLedNames;
		this.Config.LedPositions = layoutData.vLedPositions;
		this.Config.Leds = layoutData.vLeds;

		this.resetState();
		const mapped = new Set(layoutData.vLeds);
		this.unmapped = DONGLE_ALL_LED_INDICES.filter((i) => !mapped.has(i));
		device.log("Hydra 10 2.4GHz initialized (output report 0x13, cmd 0x88)");
		device.setName(this.Config.DeviceName);
		device.setSize(layoutData.size);
		device.setControllableLeds(this.Config.LedNames, this.Config.LedPositions);
	}

	sendColors(overrideColor) {
		const force = !!overrideColor;

		// Pace first: building a frame costs 68 canvas reads, so skip all of it
		// while the radio is still busy. The next frame is then built from the
		// freshest canvas instead of a stale one.
		if (!force && Date.now() < this.nextFrameAt) return;

		const deviceLedPositions = this.getLedPositions();
		const deviceLeds = this.getLeds();

		// Unmapped slots stay black; leaving them out lets the keyboard's own
		// firmware effect flash through.
		const perLed = new Array(DONGLE_LED_COUNT);
		for (let i = 0; i < DONGLE_LED_COUNT; i++) perLed[i] = [0, 0, 0];

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const iPxX = deviceLedPositions[iIdx][0];
			const iPxY = deviceLedPositions[iIdx][1];
			let color;

			if (overrideColor) {
				color = dongleHexToRgb(overrideColor);
			} else if (LightingMode === "Forced") {
				color = dongleHexToRgb(forcedColor);
			} else {
				color = device.color(iPxX, iPxY);
			}

			perLed[deviceLeds[iIdx]] = color;
		}

		this.writeRGBPackage(perLed, force);
	}

	writeRGBPackage(perLed, force) {
		const start = Date.now();
		const keyframeDue = force || !this.lastFullAt || (start - this.lastFullAt >= DONGLE_KEYFRAME_MS);

		let chunks;
		let groups = null;   // keyframe: what was sent per colour group
		let sentLeds = null; // delta frame: what was sent per LED
		let keyHash = null;

		if (keyframeDue) {
			const full = DONGLE_SMOOTH_MODE
				? this.buildSmooth(perLed, true)
				: dongleBuildFull(perLed, this.Config.Leds, DONGLE_ALL_LED_INDICES);
			chunks = full.chunks;
			groups = full.groups;
		} else if (DONGLE_SMOOTH_MODE) {
			chunks = this.buildSmooth(perLed, false).chunks;
			keyHash = dongleHashChunks(chunks);
			if (keyHash === this.lastKeyHash) return; // unchanged frame
		} else if (DONGLE_DELTA_MODE) {
			const delta = dongleBuildDelta(perLed, this.shown, this.Config.Leds, DONGLE_DELTA_CHUNKS);
			chunks = delta.chunks;
			sentLeds = delta.sent;
		} else {
			chunks = dongleBuildChunks(perLed, this.Config.Leds);
			keyHash = dongleHashChunks(chunks);
			if (keyHash === this.lastKeyHash) return; // unchanged frame
		}
		if (!chunks.length) return;

		for (let i = 0; i < chunks.length; i++) {
			const chunkStart = Date.now();
			const packet = [DONGLE_REPORT_ID].concat(chunks[i]);
			try {
				device.write(packet, packet.length);
			} catch (e) {
				device.log("2.4GHz write failed: " + e);
				this.nextFrameAt = Date.now() + 100; // back off instead of hammering a failing endpoint
				return;
			}
			// Space write starts 13 ms apart, matching the vendor minimum.
			if (i < chunks.length - 1) {
				const elapsed = Date.now() - chunkStart;
				if (elapsed < DONGLE_CHUNK_GAP_MS) device.pause(DONGLE_CHUNK_GAP_MS - elapsed);
			}
		}

		// Budget is measured from the START of the frame, not the end. Writing
		// already takes ~13 ms per chunk, so counting from the end would charge
		// the radio twice for the same time.
		this.nextFrameAt = start + chunks.length * (1000 / DONGLE_CHUNKS_PER_SEC);

		if (groups) {
			for (const g of groups) for (const i of g.indices) this.shown[i] = g.color;
			this.lastFullAt = Date.now();
		}
		if (sentLeds) for (const e of sentLeds) this.shown[e.i] = e.c;
		if (keyHash !== null) this.lastKeyHash = keyHash;

		if (this.loggedChunks !== chunks.length) {
			device.log(`2.4GHz frame sent: ${chunks.length} chunks (${keyframeDue ? "full 96-slot keyframe" : DONGLE_SMOOTH_MODE ? "smooth" : DONGLE_DELTA_MODE ? "delta" : "68 key LEDs"})`);
			this.loggedChunks = chunks.length;
		}
	}
}

export class Hydra10_Dongle_Library {
	constructor() {
		this.LEDLayout = {
			"68-Key": {
				vLedNames: [
					"Esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Home",
					"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del",
					"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter", "PgUp",
					"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow", "PgDn",
					"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Right Ctrl", "Left Arrow", "Down Arrow", "Right Arrow"
				],
				vLeds: [
					1, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61, 67, 73, 79, 91,
					2, 8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68, 74, 80, 92,
					3, 9, 15, 21, 27, 33, 39, 45, 51, 57, 63, 69, 81, 93,
					4, 10, 16, 22, 28, 34, 40, 46, 52, 58, 64, 82, 88, 94,
					5, 11, 17, 35, 53, 59, 65, 83, 89, 95
				],
				vLedPositions: [
					[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0], [10, 0], [11, 0], [12, 0], [13, 0], [14, 0],
					[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1], [13, 1], [14, 1],
					[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2], [11, 2], [13, 2], [14, 2],
					[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [12, 3], [13, 3], [14, 3],
					[0, 4], [1, 4], [2, 4], [6, 4], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [14, 4]
				],
				size: [15, 5]
			}
		};
	}
}

const DONGLE_ALL_LED_INDICES = Array.from({length: DONGLE_LED_COUNT}, (_, i) => i);
const HYDRA10_DONGLE_LIBRARY = new Hydra10_Dongle_Library();
const HYDRA10_DONGLE = new Hydra10_Dongle_Protocol();

function dongleHexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}
