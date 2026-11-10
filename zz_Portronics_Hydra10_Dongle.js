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

// The receiver exposes two interfaces: 0 is the boot keyboard, 1 is the
// vendor page (0xFF02) that advertises output report 0x13. Accept the vendor
// interface either by number or by usage page, never the keyboard interface.
export function Validate(endpoint) {
	return endpoint.interface === 1 || endpoint.usage_page >= 0xff00;
}

export function ControllableParameters() {
	return [
		{property: "shutdownColor", group: "lighting", label: "Shutdown Color", type: "color", default: "#000000"},
		{property: "LightingMode", group: "lighting", label: "Lighting Mode", type: "combobox", values: ["Canvas", "Forced"], default: "Canvas"},
		{property: "forcedColor", group: "lighting", label: "Forced Color", type: "color", default: "#009bde"},
	];
}

export function Initialize() {
	SINOWEALTH.Initialize();
}

export function Render() {
	SINOWEALTH.sendColors();
}

export function Shutdown(SystemSuspending) {
	const color = SystemSuspending ? "#000000" : shutdownColor;
	SINOWEALTH.sendColors(color);
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
const LED_COUNT = 96;

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

function rgbToHsv(r, g, b) {
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

function hsvToRgb(h, s, v) {
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

function quantizeHsv(rgb, hSteps, sSteps, vSteps) {
	const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
	if (v < 0.04) return [0, 0, 0];
	const hq = hSteps <= 1 ? 0 : (Math.round((h / 360) * hSteps) % hSteps);
	const sq = sSteps <= 1 ? s : Math.round(s * (sSteps - 1)) / (sSteps - 1);
	// Floor non-black colours to one value step so dim effects don't vanish.
	const vq = vSteps <= 1 ? v : Math.max(1 / (vSteps - 1), Math.round(v * (vSteps - 1)) / (vSteps - 1));
	return hsvToRgb((hq / hSteps) * 360, sq, vq);
}

function buildDongleGroups(perLed, palette, indices) {
	const buckets = new Map();
	for (const i of indices) {
		let c = perLed[i] || [0, 0, 0];
		c = [c[0] | 0, c[1] | 0, c[2] | 0];
		if (!palette.exact) c = quantizeHsv(c, palette.h, palette.s, palette.v);
		const k = `${c[0]},${c[1]},${c[2]}`;
		if (!buckets.has(k)) buckets.set(k, {color: c, indices: []});
		buckets.get(k).indices.push(i);
	}
	return Array.from(buckets.values());
}

function encodeDongleGroups(groups) {
	const out = [];
	for (const g of groups) {
		out.push(g.color[0], g.color[1], g.color[2], g.indices.length);
		for (const idx of g.indices) out.push(idx);
	}
	return out;
}

function chunkDonglePayload(payload) {
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

function averageDongleGroups(perLed, indices) {
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
function buildDongleChunks(perLed, indices) {
	for (const palette of DONGLE_PALETTES) {
		const chunks = chunkDonglePayload(encodeDongleGroups(buildDongleGroups(perLed, palette, indices)));
		if (chunks.length && chunks.length <= DONGLE_MAX_CHUNKS) return chunks;
	}
	return chunkDonglePayload(encodeDongleGroups(averageDongleGroups(perLed, indices)));
}

function hashChunks(chunks) {
	let h = 2166136261 >>> 0;
	for (const c of chunks) {
		for (let i = 0; i < c.length; i++) {
			h ^= c[i];
			h = Math.imul(h, 16777619);
		}
	}
	return h >>> 0;
}

export class SINOWEALTH_Device_Protocol {
	constructor() {
		this.Config = {
			ModelID: 133,
			DeviceName: "Portronics Hydra 10 (2.4 GHz)",
			LedNames: [],
			LedPositions: [],
			Leds: [],
			layout: "68-Key"
		};
		this.lastKeyHash = null;
		this.lastFullAt = 0;
		this.lastFrameAt = 0;
	}

	getLedPositions() { return this.Config.LedPositions; }
	getLeds() { return this.Config.Leds; }
	getLedNames() { return this.Config.LedNames; }
	getModelID() { return this.Config.ModelID; }

	Initialize() {
		const layoutData = SINOWEALTHdeviceLibrary.LEDLayout["68-Key"];

		this.Config.LedNames = layoutData.vLedNames;
		this.Config.LedPositions = layoutData.vLedPositions;
		this.Config.Leds = layoutData.vLeds;

		device.log("Hydra 10 2.4GHz initialized (output report 0x13, cmd 0x88)");
		device.setName(this.Config.DeviceName);
		device.setSize(layoutData.size);
		device.setControllableLeds(this.Config.LedNames, this.Config.LedPositions);
	}

	sendColors(overrideColor) {
		const deviceLedPositions = this.getLedPositions();
		const deviceLeds = this.getLeds();

		// All 96 matrix slots are painted every keyframe, exactly like the wired
		// path. The 28 slots with no key stay black; leaving them out lets the
		// keyboard's own firmware effect flash through.
		const perLed = new Array(LED_COUNT);
		for (let i = 0; i < LED_COUNT; i++) perLed[i] = [0, 0, 0];

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const iPxX = deviceLedPositions[iIdx][0];
			const iPxY = deviceLedPositions[iIdx][1];
			let color;

			if (overrideColor) {
				color = hexToRgb(overrideColor);
			} else if (LightingMode === "Forced") {
				color = hexToRgb(forcedColor);
			} else {
				color = device.color(iPxX, iPxY);
			}

			perLed[deviceLeds[iIdx]] = color;
		}

		this.writeRGBPackage(perLed, !!overrideColor);
	}

	writeRGBPackage(perLed, force) {
		const now = Date.now();

		const keyChunks = buildDongleChunks(perLed, this.Config.Leds);
		if (!keyChunks.length) return;

		const keyHash = hashChunks(keyChunks);
		const keyframeDue = force || !this.lastFullAt || (now - this.lastFullAt >= DONGLE_KEYFRAME_MS);

		// Skip unchanged animation frames between keyframes.
		if (!force && !keyframeDue && keyHash === this.lastKeyHash) return;

		const useFull = keyframeDue;
		const chunks = useFull ? buildDongleChunks(perLed, ALL_LED_INDICES) : keyChunks;
		if (!chunks.length) return;

		// Budget by chunks per second, not frames. A 6-chunk frame may start
		// every ~100 ms; an 8-chunk frame every ~133 ms.
		const budgetMs = chunks.length * (1000 / DONGLE_CHUNKS_PER_SEC);
		if (!force && now - this.lastFrameAt < budgetMs) return;

		this.lastFrameAt = now;

		for (let i = 0; i < chunks.length; i++) {
			const chunkStart = Date.now();
			const packet = [DONGLE_REPORT_ID].concat(chunks[i]);
			try {
				device.write(packet, packet.length);
			} catch (e) {
				device.log("2.4GHz write failed: " + e);
				return;
			}
			// Space write starts 13 ms apart, matching the vendor minimum.
			if (i < chunks.length - 1) {
				const elapsed = Date.now() - chunkStart;
				if (elapsed < DONGLE_CHUNK_GAP_MS) device.pause(DONGLE_CHUNK_GAP_MS - elapsed);
			}
		}

		this.lastKeyHash = keyHash;
		if (useFull) this.lastFullAt = Date.now();
		this.lastFrameAt = Date.now();
	}
}

export class deviceLibrary {
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

const ALL_LED_INDICES = Array.from({length: LED_COUNT}, (_, i) => i);
const SINOWEALTHdeviceLibrary = new deviceLibrary();
const SINOWEALTH = new SINOWEALTH_Device_Protocol();

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}
