import {
  AssetManifest,
  AssetType,
  SessionMode,
  AssetManager,
  World,
  XRInputManager,
  GrabSystem,
  PhysicsSystem,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  Interactable,
  VisibilityState,
} from "@iwsdk/core";

import * as THREE from "three";
import { Clock } from "three";

import { ButtonSystem, Button, HandPressable } from "./systems/button/ButtonSystem.js";
import { AnalogStickSystem, AnalogStick } from "./systems/analogStick/AnalogStickSystem.js";
import { StickGrabSystem, StickGrab } from "./systems/analogStick/StickGrabSystem.js";
import { NESSystem, NESComponent } from "./systems/nes/NESSystem.js";
import { inject } from "@vercel/analytics"


const assets: AssetManifest = {
  retropanel: {
    url: "/gltf/retropanel.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

inject();

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,

  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    features: {
      handTracking: true,
      anchors: true,
      hitTest: true,
      planeDetection: { required: true },
      meshDetection: { required: true },
      layers: true,
      depthSensing: true,
    },
  },
  features: {
    locomotion: false,
    grabbing: true,
    physics: true,
    sceneUnderstanding: true,

  },
}).then((world) => {
  const { camera } = world;
  const xrInput = new XRInputManager({ scene: world.scene, camera });
  world.scene.add(xrInput.xrOrigin);

  camera.position.set(0, 1, 0.5);

  const { scene: retropanelScene } = AssetManager.getGLTF("retropanel")!;

  world.scene.add(retropanelScene);
  
  const findMeshByName = (object: THREE.Object3D, name: string): THREE.Mesh | null => {
    if (object instanceof THREE.Mesh && object.name === name) {
      return object;
    }
    for (const child of object.children) {
      const found = findMeshByName(child, name);
      if (found) return found;
    }
    return null;
  };
  
  const panelMesh = findMeshByName(retropanelScene, 'panel');
  if (panelMesh) {
    panelMesh.material = new THREE.MeshStandardMaterial({
      color: 0x000000,
      metalness: 0.95,
      roughness: 0.5,
      envMapIntensity: 2.5,
    });
    panelMesh.castShadow = true;
    panelMesh.receiveShadow = true;
  }
  
  const buttonOutterNames = ['button0_outer', 'button1_outer', 'button2_outer', 'button3_outer'];
  buttonOutterNames.forEach((outterName) => {
    const outterMesh = findMeshByName(retropanelScene, outterName);
    if (outterMesh) {
      outterMesh.material = new THREE.MeshStandardMaterial({
        color: 0x000000,
        metalness: 0.6,
        roughness: 0.4,
        envMapIntensity: 1.0,
      });
      outterMesh.castShadow = true;
      outterMesh.receiveShadow = true;
    }
  });
  
  const buttonNames = ['button1', 'button2', 'button3', 'button4'];
  const buttonColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
  buttonNames.forEach((buttonName, index) => {
    const buttonMesh = findMeshByName(retropanelScene, buttonName);
    if (buttonMesh) {
      buttonMesh.material = new THREE.MeshStandardMaterial({
        color: buttonColors[index] || 0x888888,
        metalness: 0.8,
        roughness: 0.2,
        envMapIntensity: 1.0,
      });
      buttonMesh.castShadow = true;
      buttonMesh.receiveShadow = true;
      
      const buttonAction = () => {
        // Button action handled by NES system
      };
      
      const buttonEntity = world.createTransformEntity(buttonMesh)
        .addComponent(Interactable)
        .addComponent(Button, {
          surfaceY: 0.05,
          fullPressDistance: 0.02,
          recoverySpeed: 0.4,
        })
        .addComponent(HandPressable)
        .addComponent(PhysicsShape, {
          shape: PhysicsShapeType.Box,
          dimensions: [0.1, 0.05, 0.1],
          density: 1.0,
          friction: 0.8,
          restitution: 0.1
        })
        .addComponent(PhysicsBody, {
          state: PhysicsState.Static,
        });
      
      ButtonSystem.setButtonAction(buttonEntity.index, buttonAction);
      
      if (!(world as any).nesButtonEntities) {
        (world as any).nesButtonEntities = new Map();
      }
      (world as any).nesButtonEntities.set(buttonName, buttonEntity);
    }
  });
  
  const stickMesh = findMeshByName(retropanelScene, 'stick_mesh');
  if (stickMesh) {
    stickMesh.material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      metalness: 0.7,
      roughness: 0.3,
      envMapIntensity: 1.0,
    });
    stickMesh.castShadow = true;
    stickMesh.receiveShadow = true;

    const stickEntity = world.createTransformEntity(stickMesh)
      .addComponent(StickGrab)
      .addComponent(AnalogStick, {
        maxRadius: 0.03,
        returnSpeed: 5.0,
      });
    
    if (stickMesh.geometry) {
      stickMesh.geometry.computeBoundingBox();
    }
    
    (world as any).nesStickEntity = stickEntity;
  }

  (world as any).xrInput = xrInput;
  world
    .registerSystem(ButtonSystem)
    .registerSystem(StickGrabSystem)
    .registerSystem(AnalogStickSystem)
    .registerSystem(NESSystem)
    .registerSystem(GrabSystem)
    .registerSystem(PhysicsSystem, {
      configData: { gravity: [0, -9.81, 0] }
    })
    .registerComponent(PhysicsBody)
    .registerComponent(PhysicsShape)
    .registerComponent(Button)
    .registerComponent(HandPressable)
    .registerComponent(StickGrab)
    .registerComponent(AnalogStick)
    .registerComponent(NESComponent);
  
  world.createTransformEntity(new THREE.Object3D())
    .addComponent(NESComponent);

  setupRetroUI(world);

  const clock = new Clock();

  world.renderer.setAnimationLoop((time) => {
    const delta = clock.getDelta();
    const xrFrame = world.renderer.xr.getFrame();
  
    if (xrFrame && world.renderer.xr.getSession()) {
      xrInput.update(world.renderer.xr, delta, time / 1000);
    }
  
    world.update(clock.getDelta(), time);
    world.renderer.render(world.scene, world.camera);
  });
});

function setupRetroUI(world: any) {
  const overlay = document.getElementById('retro-overlay');
  const gamesList = document.getElementById('games-list');
  const playButton = document.getElementById('play-button') as HTMLButtonElement;
  const romUpload = document.getElementById('rom-upload') as HTMLInputElement;
  const uploadArea = document.getElementById('upload-area');
  const uploadedRom = document.getElementById('uploaded-rom');
  
  if (!overlay || !gamesList || !playButton || !romUpload || !uploadArea || !uploadedRom) {
    return;
  }
  
  const games = [
    { name: 'Owlia', rom: '/roms/owlia.nes', isFile: false },
    { name: 'Flappy Bird', rom: '/roms/flappy_bird.nes', isFile: false },
    {name: '2048', rom: '/roms/2048.nes', isFile: false },
  ];
  
  let selectedGame: { name: string; rom: string | File; isFile: boolean } = games[0];
  let uploadedRomFile: File | null = null;
  
  function handleFileUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.nes')) {
      alert('Please upload a .nes file');
      return;
    }
    
    uploadedRomFile = file;
    const uploadedRomName = document.createElement('div');
    uploadedRomName.className = 'uploaded-rom-name';
    uploadedRomName.textContent = `Loaded: ${file.name}`;
    if (uploadedRom) {
      uploadedRom.innerHTML = '';
      uploadedRom.appendChild(uploadedRomName);
      uploadedRom.style.display = 'block';
    }
    
    const existingUploaded = gamesList?.querySelector('.game-item.uploaded');
    if (existingUploaded) {
      existingUploaded.remove();
    }
    
    const gameItem = document.createElement('div');
    gameItem.className = 'game-item uploaded selected';
    gameItem.textContent = file.name.replace('.nes', '');
    gameItem.addEventListener('click', () => {
      gamesList?.querySelectorAll('.game-item').forEach(item => {
        item.classList.remove('selected');
      });
      gameItem.classList.add('selected');
      selectedGame = { name: file.name, rom: file, isFile: true };
    });
    
    gamesList?.querySelectorAll('.game-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    if (gamesList) {
      gamesList.insertBefore(gameItem, gamesList.firstChild);
    }
    selectedGame = { name: file.name, rom: file, isFile: true };
  }
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });
  
  romUpload.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFileUpload(target.files[0]);
    }
  });
  
  games.forEach((game, index) => {
    const gameItem = document.createElement('div');
    gameItem.className = 'game-item' + (index === 0 && !uploadedRomFile ? ' selected' : '');
    gameItem.textContent = game.name;
    gameItem.addEventListener('click', () => {
      gamesList?.querySelectorAll('.game-item').forEach(item => {
        item.classList.remove('selected');
      });
      gameItem.classList.add('selected');
      selectedGame = game;
      uploadedRomFile = null;
      if (uploadedRom) {
        uploadedRom.style.display = 'none';
      }
    });
    if (gamesList) {
      gamesList.appendChild(gameItem);
    }
  });
  
  playButton.addEventListener('click', () => {
    if (selectedGame.isFile && selectedGame.rom instanceof File) {
      (world as any).selectedRomFile = selectedGame.rom;
      (world as any).selectedRomUrl = null;
    } else {
      (world as any).selectedRomUrl = selectedGame.rom;
      (world as any).selectedRomFile = null;
    }
    
    overlay.style.display = 'none';
    world.launchXR();
  });
  
  world.visibilityState.subscribe((state: VisibilityState) => {
    if (state === VisibilityState.NonImmersive) {
      overlay.style.display = 'flex';
    } else {
      overlay.style.display = 'none';
    }
  });
  
  overlay.style.display = 'flex';
}
