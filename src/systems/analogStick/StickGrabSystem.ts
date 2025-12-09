import { createSystem, createComponent } from '@iwsdk/core';
import { XRInputManager, XRHandVisualAdapter } from '@iwsdk/xr-input';
import * as THREE from 'three';

// XRInputSource type for WebXR
type XRInputSource = any;

// Simple grab component for the stick
export const StickGrab = createComponent("StickGrab", {
  attached: { type: 'Boolean', default: false },
  justAttached: { type: 'Boolean', default: false },
  justDetached: { type: 'Boolean', default: false },
});

// Helper to convert boolean to number for component data (if needed)
const boolToNum = (b: boolean): number => b ? 1 : 0;

// Store attached hand references (can't store objects in component data)
export const attachedHands = new Map<number, XRHandVisualAdapter>();

// Custom grab system similar to Meta's example, but for hand tracking
export class StickGrabSystem extends createSystem({
  sticks: { required: [StickGrab] },
}) {
  private xrInput?: XRInputManager;
  private vec3 = new THREE.Vector3();
  private vec32 = new THREE.Vector3();
  private attachMap = new Map<number, XRHandVisualAdapter>();
  private previousButtonStates = new Map<string, boolean>(); // Track button states per hand

  init() {
    // Try to get xrInput from world context
    if ((this.world as any).xrInput) {
      this.xrInput = (this.world as any).xrInput;
    }
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

    // Clear attach map and check for new grabs
    this.attachMap.clear();

    // Get XR session to access input sources for button detection
    const xrSession = (this.world as any).renderer?.xr?.getSession?.();
    
    if (!xrSession) {
      return;
    }
    
    // Check each hand for potential grabs
    hands.forEach((hand) => {
      const side = hand.handedness;
      
      // Get hand position using gripSpace (like Meta example uses targetRaySpace)
      let handPosition = new THREE.Vector3();
      let positionFound = false;
      
      // Try gripSpace first (like Meta example)
      if ((hand as any).gripSpace && (hand as any).gripSpace instanceof THREE.Object3D) {
        (hand as any).gripSpace.getWorldPosition(handPosition);
        positionFound = true;
      }
      
      // Fallback to index finger tip if gripSpace not available
    //   if (!positionFound) {
    //     const indexTip = hand.jointSpaces[17];
    //     if (indexTip) {
    //       const jointAny = indexTip as any;
    //       if (indexTip instanceof THREE.Object3D) {
    //         indexTip.getWorldPosition(handPosition);
    //         positionFound = true;
    //       } else if (jointAny.matrixWorld && jointAny.matrixWorld instanceof THREE.Matrix4) {
    //         handPosition.setFromMatrixPosition(jointAny.matrixWorld);
    //         positionFound = true;
    //       }
    //     }
    //   }
      
    //   // Fallback to raySpace if still not found
    //   if (!positionFound && hand.raySpace && hand.raySpace instanceof THREE.Object3D) {
    //     hand.raySpace.getWorldPosition(handPosition);
    //     positionFound = true;
    //   }

      if (!positionFound) {

        return;
      }

      // Check for button press (like Meta example uses justStartedSelecting)
      let justStartedSelecting = false;
      let justStoppedSelecting = false;
      let isPressed = false;
      let inputSource: XRInputSource | null = null;
      
      if (xrSession) {
        // Find input source for this hand
        inputSource = Array.from(xrSession.inputSources).find(
          (source: any) => source.handedness === side && source.hand
        ) as XRInputSource | null;
        
        if (inputSource) {
          // Debug: log input source properties
          
          if (inputSource.gamepad) {
            // Check primary button (button 0) - trigger/select button
            const primaryButton = inputSource.gamepad.buttons[0];
            isPressed = primaryButton?.pressed || false;
            
            const previousState = this.previousButtonStates.get(side) || false;
            justStartedSelecting = isPressed && !previousState;
            justStoppedSelecting = !isPressed && previousState;
            
            this.previousButtonStates.set(side, isPressed);
          }
        }
      }
      

      // Find closest stick that's not already attached (similar to Meta example)
      const availableSticks = Array.from(this.queries.sticks.entities)
        .filter((entity) => {
          const idx = entity.index;
          return !StickGrab.data.attached[idx] || StickGrab.data.attached[idx] === 0;
        })
        .map((entity) => {
          const object3D = entity.object3D;
          if (!object3D) return null;
          
          // Get distance (like Meta example)
          const distance = object3D.getWorldPosition(this.vec32).distanceTo(handPosition);
          
          return {
            entity,
            object3D,
            distance,
          };
        })
        .filter((item) => item !== null)
        .sort((a, b) => a!.distance - b!.distance);

      // Button-based grab
      if (availableSticks.length > 0 && (justStartedSelecting || isPressed)) {
        const closest = availableSticks[0]!;
        if (closest.distance < 0.10) {
          this.attachMap.set(closest.entity.index, hand);
        }
      }
      
      // Store selection state for next frame
      (hand as any).justStartedSelecting = justStartedSelecting;
      (hand as any).justStoppedSelecting = justStoppedSelecting;
    });

    // Process each stick
    this.queries.sticks.entities.forEach((entity) => {
      const idx = entity.index;
      const stickMesh = entity.object3D;
      if (!stickMesh) return;

      StickGrab.data.justAttached[idx] = 0;
      StickGrab.data.justDetached[idx] = 0;

      if (!StickGrab.data.attached[idx] || StickGrab.data.attached[idx] === 0) {
        // Check if this stick should be grabbed (like Meta example checks justStartedSelecting)
        const hand = this.attachMap.get(idx);
        if (hand && (hand as any).justStartedSelecting) {
          // Attach stick to hand (like Meta example)
          StickGrab.data.attached[idx] = 1;
          StickGrab.data.justAttached[idx] = 1;
          attachedHands.set(idx, hand);
          
        }
      } else {
        // Check if hand is still selecting (button still pressed or still squeezing)
        const attachedHand = attachedHands.get(idx);
        if (attachedHand) {
          let stillSelecting = false;
          
          // Check button state first (like Meta example)
          if (xrSession) {
            const side = attachedHand.handedness;
            const inputSource = Array.from(xrSession.inputSources).find(
              (source: any) => source.handedness === side && source.hand
            ) as XRInputSource | null;
            
            if (inputSource && inputSource.gamepad) {
              const primaryButton = inputSource.gamepad.buttons[0];
              stillSelecting = primaryButton?.pressed || false;
            }
          }
          
          // Check if button was just released (like Meta example checks justStoppedSelecting)
          const justStopped = (attachedHand as any).justStoppedSelecting;
          
          if (!stillSelecting || justStopped) {
            // Detach stick (like Meta example)
            StickGrab.data.attached[idx] = 0;
            StickGrab.data.justDetached[idx] = 1;
            attachedHands.delete(idx);
          }
        }
      }
    });
  }
}

