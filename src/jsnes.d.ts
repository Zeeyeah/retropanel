declare module 'jsnes' {
  export interface NESOptions {
    onFrame?: (frameBuffer: number[]) => void;
    onAudioSample?: (left: number, right: number) => void;
    onStatusUpdate?: (status: string) => void;
    onBatteryRamWrite?: () => void;
    preferredFrameRate?: number;
    emulateSound?: boolean;
    sampleRate?: number;
  }

  export class NES {
    constructor(opts?: NESOptions);
    loadROM(data: string | Uint8Array | number[]): void;
    frame(): void;
    buttonDown(controller: number, button: number): void;
    buttonUp(controller: number, button: number): void;
    reset(): void;
    reloadROM(): void;
    getFPS(): number | null;
    setFramerate(rate: number): void;
    zapperMove(x: number, y: number): void;
    zapperFireDown(): void;
    zapperFireUp(): void;
    toJSON(): any;
    fromJSON(s: any): void;
  }

  export class Controller {
    static BUTTON_A: number;
    static BUTTON_B: number;
    static BUTTON_SELECT: number;
    static BUTTON_START: number;
    static BUTTON_UP: number;
    static BUTTON_DOWN: number;
    static BUTTON_LEFT: number;
    static BUTTON_RIGHT: number;
  }
}

