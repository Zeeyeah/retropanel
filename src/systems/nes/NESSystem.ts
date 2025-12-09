import { createComponent, createSystem, Entity } from '@iwsdk/core';
import * as THREE from 'three';
import { NES, Controller } from 'jsnes';
import { Button } from '../button/ButtonSystem.js';
import { AnalogStick } from '../analogStick/AnalogStickSystem.js';

// NES component to track the NES instance and screen
export const NESComponent = createComponent("NESComponent", {
  initialized: { type: 'Boolean', default: false },
});

export class NESSystem extends createSystem({
  nes: { required: [NESComponent] },
  buttons: { required: [Button] },
  stick: { required: [AnalogStick] },
}) {
  private nes: NES | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private screenMesh: THREE.Mesh | null = null;
  private screenLight: THREE.PointLight | null = null;
  private buttonEntityMap: Map<string, Entity> = new Map(); // Map button mesh names to entities
  private stickEntity: Entity | null = null;
  private lastFrameTime = 0;
  private readonly TARGET_FPS = 60;
  private readonly FRAME_TIME = 1000 / this.TARGET_FPS;
  private curveAmount = -0.08; // Curve amount for both geometry and shader
  private audioContext: AudioContext | null = null;
  private audioBuffer: number[][] = [[], []]; // Left and right channel buffers
  private audioBufferSize = 0;
  private readonly AUDIO_BUFFER_TARGET = 4096; // Target buffer size before playing
  private currentRomUrl: string = '/roms/owlia.nes'; // Default ROM
  private isInitializing: boolean = false; // Track if NES is currently initializing

  init() {
    const world = this.world as any;
    if (world.nesButtonEntities) {
      world.nesButtonEntities.forEach((entity: Entity, buttonName: string) => {
        this.buttonEntityMap.set(buttonName, entity);
      });
    }
    
    if (world.nesStickEntity) {
      this.stickEntity = world.nesStickEntity;
    }
    
    if (this.buttonEntityMap.size === 0) {
      this.queries.buttons.entities.forEach((entity) => {
        const mesh = entity.object3D;
        if (mesh && mesh instanceof THREE.Mesh) {
          const meshName = mesh.name;
          if (meshName && (meshName === 'button1' || meshName === 'button2' || meshName === 'button3' || meshName === 'button4')) {
            this.buttonEntityMap.set(meshName, entity);
          }
        }
      });
    }
    
    if (!this.stickEntity) {
      this.queries.stick.entities.forEach((entity) => {
        const mesh = entity.object3D;
        if (mesh && mesh instanceof THREE.Mesh && mesh.name === 'stick_mesh') {
          this.stickEntity = entity;
        }
      });
    }
  }

  private async initializeNES(romUrl?: string, romFile?: File) {
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (romFile) {
        arrayBuffer = await romFile.arrayBuffer();
      } else {
        const urlToLoad = romUrl || this.currentRomUrl;
        this.currentRomUrl = urlToLoad;
        const response = await fetch(urlToLoad);
        if (!response.ok) {
          throw new Error(`Failed to load ROM: ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }
      
      const uint8Array = new Uint8Array(arrayBuffer);
      let romData = '';
      for (let i = 0; i < uint8Array.length; i++) {
        romData += String.fromCharCode(uint8Array[i]);
      }
      
      this.canvas = document.createElement('canvas');
      this.canvas.width = 256;
      this.canvas.height = 240;
      
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.flipY = true;
      
      this.initializeAudio();
      
      this.nes = new NES({
        onFrame: (frameBuffer: number[]) => {
          this.renderFrame(frameBuffer);
        },
        onAudioSample: (left: number, right: number) => {
          this.handleAudioSample(left, right);
        },
      });
      
      this.nes.loadROM(romData);
      this.createScreenPlane();
      this.startAudioPlayback();
      
    } catch (error) {
      console.error('Failed to initialize NES:', error);
    }
  }

  private initializeAudio() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 44100,
      });
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
    }
  }

  private handleAudioSample(left: number, right: number) {
    if (!this.audioContext || this.audioContext.state === 'suspended') {
      return;
    }

    this.audioBuffer[0].push(left);
    this.audioBuffer[1].push(right);
    this.audioBufferSize++;

    if (this.audioBufferSize >= this.AUDIO_BUFFER_TARGET) {
      this.playAudioBuffer();
    }
  }

  private playAudioBuffer() {
    if (!this.audioContext || this.audioContext.state === 'suspended') {
      return;
    }

    if (this.audioBufferSize === 0) {
      return;
    }

    const buffer = this.audioContext.createBuffer(2, this.audioBufferSize, this.audioContext.sampleRate);
    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.getChannelData(1);

    for (let i = 0; i < this.audioBufferSize; i++) {
      leftChannel[i] = this.audioBuffer[0][i];
      rightChannel[i] = this.audioBuffer[1][i];
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    source.start();

    this.audioBuffer[0] = [];
    this.audioBuffer[1] = [];
    this.audioBufferSize = 0;
  }

  private startAudioPlayback() {
    if (!this.audioContext) {
      return;
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((error) => {
        console.error('Failed to resume audio context:', error);
      });
    }
  }

  private createScreenPlane() {
    if (!this.texture) return;
    
    const aspectRatio = 256 / 240;
    const width = 1.5;
    const height = width / aspectRatio;
    
    const widthSegments = 32;
    const heightSegments = 32;
    const geometry = new THREE.PlaneGeometry(width, height, widthSegments, heightSegments);
    
    const positions = geometry.attributes.position;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      
      const normalizedX = (x / (width / 2));
      const normalizedY = (y / (height / 2));
      
      const distanceFromCenter = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
      
      const curveZ = this.curveAmount * (1 - distanceFromCenter * distanceFromCenter);
      
      positions.setZ(i, curveZ);
    }
    
    geometry.computeVertexNormals();
    
    const material = this.createCRTShaderMaterial();
    
    this.screenMesh = new THREE.Mesh(geometry, material);
    
    this.screenMesh.position.set(0, 1.8, -1.3);
    this.screenMesh.rotation.y = Math.PI;
    
    const world = this.world as any;
    if (world.scene) {
      world.scene.add(this.screenMesh);
      
      this.screenLight = new THREE.PointLight(0xffffff, 4.5, 5);
      this.screenLight.position.copy(this.screenMesh.position);
      this.screenLight.position.z += 0.1;
      world.scene.add(this.screenLight);
      
      (world as any).nesScreenLight = this.screenLight;
    }
  }
  
  public getScreenPosition(): THREE.Vector3 | null {
    if (!this.screenMesh) return null;
    return this.screenMesh.position.clone();
  }

  private createCRTShaderMaterial(): THREE.ShaderMaterial {
    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vPosition;
      
      void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D uTexture;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform float uCurveAmount;

      varying vec2 vUv;
      varying vec3 vPosition;

      vec2 barrel(vec2 uv, float amt) {
          uv = uv * 2.0 - 1.0;
          float r2 = dot(uv, uv);
          uv *= 1.0 + amt * r2;
          return uv * 0.5 + 0.5;
      }

      vec2 crtCurve(vec2 uv) {
          uv = uv * 2.0 - 1.0;
          float curve = abs(uCurveAmount) * 0.7;    
          uv.x *= 1.0 + curve * (uv.y * uv.y);
          uv.y *= 1.0 + curve * (uv.x * uv.x);

          return uv * 0.5 + 0.5;
      }

float scanline(float y) {
    float line = sin(y * uResolution.y * 1.4);
    return 0.85 + line * 0.08;
}

float grille(float x) {
    return 0.9 + sin(x * uResolution.x * 3.0) * 0.05;
}

vec3 bloom(sampler2D tex, vec2 uv) {
    float off = 1.5 / uResolution.x;

    vec2 clampedUv = clamp(uv, vec2(0.0), vec2(1.0));
    vec2 clampedUvTL = clamp(uv + vec2(-off, -off), vec2(0.0), vec2(1.0));
    vec2 clampedUvTR = clamp(uv + vec2( off, -off), vec2(0.0), vec2(1.0));
    vec2 clampedUvBL = clamp(uv + vec2(-off,  off), vec2(0.0), vec2(1.0));
    vec2 clampedUvBR = clamp(uv + vec2( off,  off), vec2(0.0), vec2(1.0));

    vec3 sum = vec3(0.0);
    sum += texture2D(tex, clampedUvTL).rgb * 0.6;
    sum += texture2D(tex, clampedUvTR).rgb * 0.6;
    sum += texture2D(tex, clampedUvBL).rgb * 0.6;
    sum += texture2D(tex, clampedUvBR).rgb * 0.6;

    sum += texture2D(tex, clampedUv).rgb * 2.0;

    return sum * 0.25;
}

vec3 chroma(sampler2D tex, vec2 uv, float amt){
    vec2 clampedUv = clamp(uv, vec2(0.0), vec2(1.0));
    vec2 clampedUvR = clamp(uv + vec2( amt, 0.0), vec2(0.0), vec2(1.0));
    vec2 clampedUvB = clamp(uv + vec2(-amt, 0.0), vec2(0.0), vec2(1.0));
    
    return vec3(
        texture2D(tex, clampedUvR).r,
        texture2D(tex, clampedUv).g,
        texture2D(tex, clampedUvB).b
    );
}

float noise(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898,78.233)) + uTime * 4.0) * 43758.5453);
}

void main() {
    vec2 uv = vUv;
    vec3 color = vec3(0.0);

    vec2 distortedUv = crtCurve(uv);
    distortedUv = barrel(distortedUv, 0.08);

    if (distortedUv.x < 0.0 || distortedUv.x > 1.0 || distortedUv.y < 0.0 || distortedUv.y > 1.0){
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    color = chroma(uTexture, distortedUv, 0.0025);
    color *= scanline(distortedUv.y);
    color *= grille(distortedUv.x);
    color += bloom(uTexture, distortedUv) * 0.25;

    float d = distance(vUv, vec2(0.5));
    color *= smoothstep(1.0, 0.35, d);
    color += noise(vUv * uResolution) * 0.02;
    color = pow(color, vec3(1.10));
    color *= 1.12;

    gl_FragColor = vec4(color, 1.0);

      }
    `;

    return new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.texture },
        uTime: { value: 0.0 },
        uResolution: { value: new THREE.Vector2(256, 240) },
        uCurveAmount: { value: this.curveAmount },
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
    });
  }

  private renderFrame(frameBuffer: number[]) {
    if (!this.canvas || !this.texture) return;
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    
    const imageData = ctx.createImageData(256, 240);
    const data = imageData.data;
    
    let totalR = 0, totalG = 0, totalB = 0;
    let sampleCount = 0;
    
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 256; x++) {
        const srcIndex = y * 256 + x;
        const flippedX = 255 - x;
        const dstIndex = (y * 256 + flippedX) * 4;
        
        const rgb = frameBuffer[srcIndex];
        
        const r = (rgb >> 16) & 0xFF;
        const g = (rgb >> 8) & 0xFF;
        const b = rgb & 0xFF;
        
        data[dstIndex] = r;
        data[dstIndex + 1] = g;
        data[dstIndex + 2] = b;
        data[dstIndex + 3] = 255;
        
        if ((x % 4 === 0 && y % 4 === 0)) {
          totalR += r;
          totalG += g;
          totalB += b;
          sampleCount++;
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    this.texture.needsUpdate = true;
    
    if (this.screenLight && sampleCount > 0) {
      const avgR = totalR / sampleCount;
      const avgG = totalG / sampleCount;
      const avgB = totalB / sampleCount;
      
      const gamma = 1.5;
      const r = Math.pow(avgR / 255, 1 / gamma);
      const g = Math.pow(avgG / 255, 1 / gamma);
      const b = Math.pow(avgB / 255, 1 / gamma);
      
      const brightness = 1.2;
      this.screenLight.color.setRGB(
        Math.min(r * brightness, 1),
        Math.min(g * brightness, 1),
        Math.min(b * brightness, 1)
      );
    }
    
    if (this.screenMesh && this.screenMesh.material instanceof THREE.ShaderMaterial) {
      this.screenMesh.material.uniforms.uTime.value = performance.now() / 1000.0;
    }
  }

  private updateNESInputs() {
    if (!this.nes) return;
    
    const buttonA = this.getButtonState('button2');
    const buttonB = this.getButtonState('button1');
    const buttonStart = this.getButtonState('button4');
    const buttonSelect = this.getButtonState('button3');
    
    const dpadState = this.getDpadState();
    
    if (buttonA) {
      this.nes.buttonDown(1, Controller.BUTTON_A);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_A);
    }
    
    if (buttonB) {
      this.nes.buttonDown(1, Controller.BUTTON_B);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_B);
    }
    
    if (buttonSelect) {
      this.nes.buttonDown(1, Controller.BUTTON_SELECT);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_SELECT);
    }
    
    if (buttonStart) {
      this.nes.buttonDown(1, Controller.BUTTON_START);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_START);
    }
    
    if (dpadState.up) {
      this.nes.buttonDown(1, Controller.BUTTON_UP);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_UP);
    }
    
    if (dpadState.down) {
      this.nes.buttonDown(1, Controller.BUTTON_DOWN);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_DOWN);
    }
    
    if (dpadState.left) {
      this.nes.buttonDown(1, Controller.BUTTON_LEFT);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_LEFT);
    }
    
    if (dpadState.right) {
      this.nes.buttonDown(1, Controller.BUTTON_RIGHT);
    } else {
      this.nes.buttonUp(1, Controller.BUTTON_RIGHT);
    }
  }

  private getButtonState(buttonName: string): boolean {
    const entity = this.buttonEntityMap.get(buttonName);
    if (!entity) {
      return false;
    }
    
    const idx = entity.index;
    const state = Button.data.currState[idx];
    return state === 'pressed' || state === 'fully_pressed';
  }

  private getDpadState(): { up: boolean; down: boolean; left: boolean; right: boolean } {
    if (!this.stickEntity) {
      return { up: false, down: false, left: false, right: false };
    }
    
    const idx = this.stickEntity.index;
    const stickX = AnalogStick.data.stickX[idx];
    const stickY = AnalogStick.data.stickY[idx];
    const magnitude = AnalogStick.data.stickMagnitude[idx];
    
    const threshold = 0.3;
    
    return {
      up: magnitude > threshold && stickY < -0.5,
      down: magnitude > threshold && stickY > 0.5,
      left: magnitude > threshold && stickX < -0.5,
      right: magnitude > threshold && stickX > 0.5,
    };
  }

  update(delta: number) {
    const xrSession = (this.world as any).renderer?.xr?.getSession?.();
    if (!xrSession) {
      if (this.audioContext && this.audioContext.state === 'running') {
        this.audioContext.suspend();
      }
      return;
    }
    
    if (!this.nes && !this.isInitializing) {
      this.isInitializing = true;
      const selectedRomUrl = (this.world as any).selectedRomUrl;
      const selectedRomFile = (this.world as any).selectedRomFile;
      
      if (selectedRomFile) {
        this.initializeNES(undefined, selectedRomFile).then(() => {
          this.isInitializing = false;
        }).catch((error) => {
          console.error('Failed to initialize NES:', error);
          this.isInitializing = false;
        });
      } else {
        const romUrl = selectedRomUrl || this.currentRomUrl;
        this.initializeNES(romUrl).then(() => {
          this.isInitializing = false;
        }).catch((error) => {
          console.error('Failed to initialize NES:', error);
          this.isInitializing = false;
        });
      }
      return;
    }
    
    if (!this.nes || this.isInitializing) {
      return;
    }
    
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    if (this.buttonEntityMap.size < 4 || !this.stickEntity) {
      this.queries.buttons.entities.forEach((entity) => {
        const mesh = entity.object3D;
        if (mesh && mesh instanceof THREE.Mesh) {
          const meshName = mesh.name;
          if (meshName && (meshName === 'button1' || meshName === 'button2' || meshName === 'button3' || meshName === 'button4')) {
            if (!this.buttonEntityMap.has(meshName)) {
              this.buttonEntityMap.set(meshName, entity);
            }
          }
        }
      });
      
      if (!this.stickEntity) {
        this.queries.stick.entities.forEach((entity) => {
          const mesh = entity.object3D;
          if (mesh && mesh instanceof THREE.Mesh && mesh.name === 'stick_mesh') {
            this.stickEntity = entity;
          }
        });
      }
    }
    
    this.updateNESInputs();
    
    const currentTime = performance.now();
    const elapsed = currentTime - this.lastFrameTime;
    
    if (elapsed >= this.FRAME_TIME) {
      const framesToStep = Math.min(Math.floor(elapsed / this.FRAME_TIME), 3);
      
      for (let i = 0; i < framesToStep; i++) {
        this.nes.frame();
      }
      
      this.lastFrameTime = currentTime - (elapsed % this.FRAME_TIME);
    }
  }
}

