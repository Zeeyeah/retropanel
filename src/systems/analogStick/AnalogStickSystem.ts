import { Entity, createSystem, createComponent } from '@iwsdk/core';
import { XRInputManager, XRHandVisualAdapter } from '@iwsdk/xr-input';
import * as THREE from 'three';
import { StickGrab, attachedHands } from './StickGrabSystem.js';

// Analog stick component with rotation tracking
export const AnalogStick = createComponent("AnalogStick", {
  centerX: { type: 'Float32', default: 0 }, // Center position X
  centerY: { type: 'Float32', default: 0 }, // Center position Y
  centerZ: { type: 'Float32', default: 0 }, // Center position Z
  maxRadius: { type: 'Float32', default: 0.05 }, // Maximum stick deflection radius
  stickX: { type: 'Float32', default: 0 }, // Current stick X position (-1 to 1)
  stickY: { type: 'Float32', default: 0 }, // Current stick Y position (-1 to 1)
  stickAngle: { type: 'Float32', default: 0 }, // Current stick angle in radians
  stickMagnitude: { type: 'Float32', default: 0 }, // Current stick magnitude (0 to 1)
  isActive: { type: 'Boolean', default: false }, // Whether stick is currently being manipulated
  returnSpeed: { type: 'Float32', default: 5.0 }, // Speed of return to center
});

// Store callbacks for stick updates (can't store functions in component data)
const stickCallbacks = new Map<number, ((x: number, y: number, angle: number, magnitude: number) => void) | null>();

// System to handle analog stick rotation - works with StickGrabSystem for grab detection
export class AnalogStickSystem extends createSystem({
  stick: { required: [AnalogStick, StickGrab] },
}) {
  private xrInput?: XRInputManager;
  private vec3 = new THREE.Vector3();
  private initialPositions = new Map<number, THREE.Vector3>();
  private initialRotations = new Map<number, THREE.Euler>();
  private grabbedHands = new Map<number, XRHandVisualAdapter>(); // Track which hand is grabbing which stick
  private pivotOffsets = new Map<number, THREE.Vector3>(); // Offset from mesh origin to bottom pivot point
  private grabHandPositions = new Map<number, THREE.Vector3>(); // Store hand position when stick was first grabbed
  private stickCylinders = new Map<number, THREE.Mesh>(); // Store cylinder meshes attached to stick balls

  init() {
    // Try to get xrInput from world context
    if ((this.world as any).xrInput) {
      this.xrInput = (this.world as any).xrInput;
    }

    // Initialize stick center positions when stick is created
    this.queries.stick.subscribe("qualify", (entity) => {
      const obj3D = entity.object3D;
      if (obj3D && obj3D instanceof THREE.Mesh && obj3D.geometry) {
        const idx = entity.index;
        
        // Calculate pivot point at bottom of mesh (where stick connects to base)
        obj3D.geometry.computeBoundingBox();
        const bbox = obj3D.geometry.boundingBox;
        if (bbox) {
          // Pivot is at the bottom center of the mesh (min Y, center X and Z)
          // This is where the stick connects to the base/panel - bottom stays fixed, top tilts
          const pivotOffset = new THREE.Vector3(
            0, // Center X
            bbox.min.y, // Bottom Y (where stick connects to base)
            0  // Center Z
          );
          this.pivotOffsets.set(idx, pivotOffset);
        }
        
        // Store initial WORLD position as center
        const initialPos = obj3D.getWorldPosition(new THREE.Vector3());
        AnalogStick.data.centerX[idx] = initialPos.x;
        AnalogStick.data.centerY[idx] = initialPos.y;
        AnalogStick.data.centerZ[idx] = initialPos.z;
        this.initialPositions.set(idx, initialPos.clone());
        // Store initial rotation
        this.initialRotations.set(idx, obj3D.rotation.clone());
        
        // Create cylinder attached to bottom of stick (ball)
            // Make it more visible - use larger size and brighter color
        const stickSize = bbox ? {
          width: bbox.max.x - bbox.min.x,
          height: bbox.max.y - bbox.min.y,
          depth: bbox.max.z - bbox.min.z,
        } : { width: 0.02, height: 0.02, depth: 0.02 };
        
        const cylinderHeight = stickSize.height * 0.6;
        const cylinderRadius = Math.max(stickSize.width, stickSize.depth) * 0.4;
        
        const cylinderGeometry = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, cylinderHeight, 16);
        const cylinderMaterial = new THREE.MeshStandardMaterial({
          color: 0x00ff00, // Bright green so it's very visible for debugging
          metalness: 0.2,
          roughness: 0.8,
        });
        const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
        cylinder.castShadow = true;
        cylinder.receiveShadow = true;
        cylinder.name = `stick_cylinder_${idx}`;
        
        // Position cylinder at bottom of stick (ball)
        // CylinderGeometry is centered, so we position it so the top aligns with the bottom of the stick
        if (bbox) {
          // Position so top of cylinder is at bottom of stick
          cylinder.position.y = bbox.min.y - cylinderHeight / 2;
        } else {
          cylinder.position.y = -cylinderHeight / 2;
        }
        
        // Add cylinder as child of stick mesh
        obj3D.add(cylinder);
        this.stickCylinders.set(idx, cylinder);
        
        obj3D.updateMatrixWorld(true);
      }
    });
  }

  update(delta: number) {
    // Get xrInput and hand adapters
    if (!this.xrInput) {
      if ((this.world as any).xrInput) {
        this.xrInput = (this.world as any).xrInput;
      } else {
        return;
      }
    }

    const handAdapters = this.xrInput?.visualAdapters?.hand;
    if (!handAdapters) {
      return;
    }

    const hands: XRHandVisualAdapter[] = [];
    Object.entries(handAdapters).forEach(([side, adapter]) => {
      if (adapter && adapter instanceof XRHandVisualAdapter) {
        hands.push(adapter);
      }
    });

    // Process each analog stick
    this.queries.stick.entities.forEach(entity => {
      const stickMesh = entity.object3D;
      const idx = entity.index;
      
      if (!stickMesh) return;

      // Get center position - use the stick's current world position as the center
      // This is the pivot point around which the stick rotates
      const currentWorldPos = stickMesh.getWorldPosition(new THREE.Vector3());
      const centerX = currentWorldPos.x;
      const centerY = currentWorldPos.y;
      const centerZ = currentWorldPos.z;
      
      // Store initial position if not set yet
      if (!this.initialPositions.has(idx)) {
        this.initialPositions.set(idx, currentWorldPos.clone());
        this.initialRotations.set(idx, stickMesh.rotation.clone());
        AnalogStick.data.centerX[idx] = centerX;
        AnalogStick.data.centerY[idx] = centerY;
        AnalogStick.data.centerZ[idx] = centerZ;
      }
      
      const maxRadius = AnalogStick.data.maxRadius[idx];
      const returnSpeed = AnalogStick.data.returnSpeed[idx];

      // Check if stick is currently being grabbed by OneHandGrabbable
      // We can detect this by checking if the stick's position has changed from initial
      // or by checking the grab system. For now, let's check if any hand is near and grabbing
      let isGrabbed = false;
      let grabbingHand: XRHandVisualAdapter | null = null;
      let handPosition = new THREE.Vector3();

      // Check if we previously tracked a grab
      const previousGrabHand = this.grabbedHands.get(idx);
      
       // Check if stick is grabbed using StickGrab component
       const grabIdx = entity.index;
       const wasGrabbed = StickGrab.data.attached[grabIdx] || StickGrab.data.attached[grabIdx] === 1;
       const justGrabbed = StickGrab.data.justAttached[grabIdx] || StickGrab.data.justAttached[grabIdx] === 1;
       
       if (wasGrabbed) {
         isGrabbed = true;
         // Get attached hand from the map in StickGrabSystem
         grabbingHand = attachedHands.get(grabIdx) || null;
         if (grabbingHand) {
           this.grabbedHands.set(idx, grabbingHand);
         }
       } else {
         // If not grabbed, clear the tracked hand and grab position
         if (previousGrabHand) {
           this.grabbedHands.delete(idx);
           this.grabHandPositions.delete(idx);
         }
       }

      // If grabbed, update stick rotation based on hand movement
      if (isGrabbed && grabbingHand) {
        // Get current hand position using gripSpace (like StickGrabSystem)
        let positionFound = false;
        
        // Try gripSpace first (like StickGrabSystem)
        if ((grabbingHand as any).gripSpace && (grabbingHand as any).gripSpace instanceof THREE.Object3D) {
          (grabbingHand as any).gripSpace.getWorldPosition(handPosition);
          positionFound = true;
        }
        
        // Fallback to index finger tip
        if (!positionFound) {
          const indexTip = grabbingHand.jointSpaces[17];
          if (indexTip) {
            const jointAny = indexTip as any;
            if (indexTip instanceof THREE.Object3D) {
              indexTip.getWorldPosition(handPosition);
              positionFound = true;
            } else if (jointAny.matrixWorld && jointAny.matrixWorld instanceof THREE.Matrix4) {
              handPosition.setFromMatrixPosition(jointAny.matrixWorld);
              positionFound = true;
            }
          }
        }
        
        // Fallback to raySpace
        if (!positionFound && grabbingHand.raySpace && grabbingHand.raySpace instanceof THREE.Object3D) {
          grabbingHand.raySpace.getWorldPosition(handPosition);
          positionFound = true;
        }

        if (!positionFound) {
          return;
        }
        
        // If just grabbed, store the initial grab position and reset rotation to 0
        if (justGrabbed) {
          this.grabHandPositions.set(idx, handPosition.clone());
          // Reset stick to initial rotation
          const initialRot = this.initialRotations.get(idx);
          if (initialRot) {
            stickMesh.rotation.copy(initialRot);
            stickMesh.quaternion.setFromEuler(initialRot);
          }
        }
        
        // Get the initial grab position (where hand was when stick was first grabbed)
        const grabHandPos = this.grabHandPositions.get(idx);
        if (!grabHandPos) {
          // If no grab position stored, use current position as reference
          this.grabHandPositions.set(idx, handPosition.clone());
          return;
        }
        
        // Calculate offset from initial grab position (how much hand has moved)
        const deltaX = handPosition.x - grabHandPos.x;
        const deltaY = handPosition.y - grabHandPos.y;
        const deltaZ = handPosition.z - grabHandPos.z;
        
        // Get pivot offset and initial position/rotation
        const pivotOffset = this.pivotOffsets.get(idx) || new THREE.Vector3(0, 0, 0);
        const initialPos = this.initialPositions.get(idx);
        const initialRot = this.initialRotations.get(idx);
        if (!initialPos || !initialRot) {
          return;
        }

        // Project onto XZ plane (horizontal plane) for arcade joystick behavior
        const horizontalDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
        
        // Calculate desired translation in X and Z (constrained to maxRadius)
        let moveX = deltaX;
        let moveZ = deltaZ;
        
        // Constrain movement to circular area (maxRadius)
        if (horizontalDistance > maxRadius) {
          const scale = maxRadius / horizontalDistance;
          moveX = deltaX * scale;
          moveZ = deltaZ * scale;
        }
        
        // Calculate direction and magnitude for stick values
        const normalizedDistance = Math.min(horizontalDistance / maxRadius, 1.0);
        const tiltDirection = horizontalDistance > 0.001 ? Math.atan2(deltaZ, deltaX) : 0;

        // Move stick (ball) in X and Z directions - translation instead of rotation
        // Keep Y position fixed (stick moves horizontally, not vertically)
        const newPos = initialPos.clone();
        newPos.x += moveX;
        newPos.z += moveZ;
        
        // Apply new position
        if (stickMesh.parent) {
          const localPos = new THREE.Vector3();
          stickMesh.parent.worldToLocal(localPos.copy(newPos));
          stickMesh.position.copy(localPos);
        } else {
          stickMesh.position.copy(newPos);
        }
        
        // Keep rotation at initial (stick doesn't rotate, just translates)
        stickMesh.rotation.copy(initialRot);
        stickMesh.quaternion.setFromEuler(initialRot);

        // Calculate normalized stick values (-1 to 1)
        const stickMagnitude = Math.min(horizontalDistance / maxRadius, 1.0);
        const stickX = stickMagnitude > 0 ? (moveX / maxRadius) : 0;
        const stickY = stickMagnitude > 0 ? (moveZ / maxRadius) : 0;
        const magnitude = stickMagnitude;

        // Update stick component data
        AnalogStick.data.stickX[idx] = Math.max(-1, Math.min(1, stickX));
        AnalogStick.data.stickY[idx] = Math.max(-1, Math.min(1, stickY));
        AnalogStick.data.stickAngle[idx] = tiltDirection;
        AnalogStick.data.stickMagnitude[idx] = magnitude;
        AnalogStick.data.isActive[idx] = 1;

        // Call callback if registered
        const callback = stickCallbacks.get(idx);
        if (callback) {
          callback(
            AnalogStick.data.stickX[idx],
            AnalogStick.data.stickY[idx],
            tiltDirection,
            magnitude
          );
        }
      } else {
        // Not grabbed - return to center (lerp position back to initial)
        const initialPos = this.initialPositions.get(idx);
        const initialRot = this.initialRotations.get(idx);
        
        if (initialPos && initialRot) {
          // Get current position
          const currentPos = stickMesh.getWorldPosition(new THREE.Vector3());
          
          // Calculate distance from initial position
          const distance = currentPos.distanceTo(initialPos);
          
          if (distance > 0.001) {
            // Lerp position back to initial
            const newPos = currentPos.clone().lerp(initialPos, returnSpeed * delta);
            
            // Apply new position
            if (stickMesh.parent) {
              const localPos = new THREE.Vector3();
              stickMesh.parent.worldToLocal(localPos.copy(newPos));
              stickMesh.position.copy(localPos);
            } else {
              stickMesh.position.copy(newPos);
            }
            
            // Keep rotation at initial
            stickMesh.rotation.copy(initialRot);
            stickMesh.quaternion.setFromEuler(initialRot);
            
            // Calculate stick values based on remaining distance
            const deltaX = currentPos.x - initialPos.x;
            const deltaZ = currentPos.z - initialPos.z;
            const horizontalDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
            const magnitude = Math.min(horizontalDistance / maxRadius, 1.0);
            const angle = horizontalDistance > 0.001 ? Math.atan2(deltaZ, deltaX) : 0;
            
            AnalogStick.data.stickX[idx] = magnitude > 0 ? (deltaX / maxRadius) : 0;
            AnalogStick.data.stickY[idx] = magnitude > 0 ? (deltaZ / maxRadius) : 0;
            AnalogStick.data.stickAngle[idx] = angle;
            AnalogStick.data.stickMagnitude[idx] = magnitude;
            AnalogStick.data.isActive[idx] = magnitude > 0.01 ? 1 : 0;
          } else {
            // Already at center
            if (stickMesh.parent) {
              const localPos = new THREE.Vector3();
              stickMesh.parent.worldToLocal(localPos.copy(initialPos));
              stickMesh.position.copy(localPos);
            } else {
              stickMesh.position.copy(initialPos);
            }
            stickMesh.rotation.copy(initialRot);
            stickMesh.quaternion.setFromEuler(initialRot);
            
            AnalogStick.data.stickX[idx] = 0;
            AnalogStick.data.stickY[idx] = 0;
            AnalogStick.data.stickAngle[idx] = 0;
            AnalogStick.data.stickMagnitude[idx] = 0;
            AnalogStick.data.isActive[idx] = 0;
          }
        }
      }
    });
  }
}

// Set callback for stick updates
export function setStickCallback(stickIndex: number, callback: (x: number, y: number, angle: number, magnitude: number) => void | null) {
  stickCallbacks.set(stickIndex, callback);
}
