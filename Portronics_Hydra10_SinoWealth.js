import {Assert} from "@SignalRGB/Errors.js";
import DeviceDiscovery from "@SignalRGB/DeviceDiscovery";

export function Name() { return "Portronics Hydra 10"; }
export function VendorId() { return 0x258a; }
export function ProductId() { return [0x010c]; }
export function Publisher() { return "WhirlwindFx"; }
export function Size() { return [1, 5]; }
export function DeviceType(){return "keyboard";}
export function Validate(endpoint) { return endpoint.interface === 1 && endpoint.usage === 0x0001 && endpoint.usage_page === 0xFF00 && endpoint.collection === 0x0006; }

export function ControllableParameters(){
	return [
		{property:"shutdownColor", group:"lighting", label:"Shutdown Color", type:"color", default:"#000000"},
		{property:"LightingMode", group:"lighting", label:"Lighting Mode", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
		{property:"forcedColor", group:"lighting", label:"Forced Color", type:"color", default:"#009bde"},
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

export class SINOWEALTH_Device_Protocol {
	constructor() {
		this.Config = {
			ModelID: 133,
			DeviceName: "Portronics Hydra 10",
			LedNames: [],
			LedPositions: [],
			Leds: [],
			layout: "68-Key"
		};
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

		device.log("Hydra 10 Initialized");
		device.setName(this.Config.DeviceName);
		device.setSize(layoutData.size);
		device.setControllableLeds(this.Config.LedNames, this.Config.LedPositions);
	}

	sendColors(overrideColor) {
		const deviceLedPositions = this.getLedPositions();
		const deviceLeds = this.getLeds();
		const RGBData = new Array(90 * 3).fill(0); 

		for (let iIdx = 0; iIdx < deviceLeds.length; iIdx++) {
			const iPxX = deviceLedPositions[iIdx][0];
			const iPxY = deviceLedPositions[iIdx][1];
			let color;

			if(overrideColor){
				color = hexToRgb(overrideColor);
			} else if (LightingMode === "Forced") {
				color = hexToRgb(forcedColor);
			} else {
				color = device.color(iPxX, iPxY);
			}

			const ledIdx = deviceLeds[iIdx];
			RGBData[(ledIdx * 3)] = color[0];
			RGBData[(ledIdx * 3) + 1] = color[1];
			RGBData[(ledIdx * 3) + 2] = color[2];
		}

		this.writeRGBPackage(RGBData);
	}

	writeRGBPackage(data){
		let packet = [0x06, 0x08, 0x00, 0x00, 0x01, 0x00, 0x7A, 0x01];
		packet = packet.concat(data);

		while (packet.length < 520) {
			packet.push(0x00);
		}

		device.send_report(packet, 520);
		device.pause(1);
	}
}

export class deviceLibrary {
	constructor(){
		this.LEDLayout = {
			"68-Key": {
				vLedNames: [
					"Esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-_", "=+", "Backspace", "Home", 
					"Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\", "Del", 
					"CapsLock", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "Enter", "PgUp",
					"Left Shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "Right Shift", "Up Arrow", "PgDn", 
					"Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Right Ctrl", "Left Arrow", "Down Arrow",  "Right Arrow"			
                             	],
				vLeds: [
					1, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61, 67, 73, 79, 91,
					2, 8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68, 74, 80, 92,
					3, 9, 15, 21, 27, 33, 39, 45, 51, 57, 63, 69, 81, 93,
					4, 10, 16, 22, 28, 34, 40, 46, 52, 58, 64,82,88, 94,
					5, 11, 17, 35, 53, 59, 65,83,89, 95
				],
				vLedPositions: [
					[0,0], [1,0], [2,0], [3,0], [4,0], [5,0], [6,0], [7,0], [8,0], [9,0], [10,0], [11,0], [12,0], [13,0], [14,0],
					[0,1], [1,1], [2,1], [3,1], [4,1], [5,1], [6,1], [7,1], [8,1], [9,1], [10,1], [11,1], [12,1], [13,1], [14,1],
					[0,2], [1,2], [2,2], [3,2], [4,2], [5,2], [6,2], [7,2], [8,2], [9,2], [10,2], [11,2], [13,2], [14,2], 
					[0,3], [1,3], [2,3], [3,3], [4,3], [5,3], [6,3], [7,3], [8,3], [9,3], [10,3], [12,3], [13,3], [14,3], 
					[0,4], [1,4], [2,4], [6,4], [9,4], [10,4],[11,4],[12,4], [13,4], [14,4]
				],
				size: [15, 5]
			}
		};
	}
}

const SINOWEALTHdeviceLibrary = new deviceLibrary();
const SINOWEALTH = new SINOWEALTH_Device_Protocol();

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
}