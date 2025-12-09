import { Entity, createSystem, createComponent } from '@iwsdk/core';
import { XRInputManager, XRHandVisualAdapter } from '@iwsdk/xr-input';
import * as THREE from 'three';

// Button states: resting, pressed, fully_pressed, recovering
export type ButtonState = 'resting' | 'pressed' | 'fully_pressed' | 'recovering';

// Button component with state tracking and press configuration
export const Button = createComponent("Button", {
  currState: { type: 'String', default: 'resting' },
  prevState: { type: 'String', default: 'resting' },
  restingY: { type: 'Float32', default: -1 }, // -1 means not initialized
  surfaceY: { type: 'Float32', default: 0.05 },
  recoverySpeed: { type: 'Float32', default: 0.4 },
  fullPressDistance: { type: 'Float32', default: 0.02 },
  actionTriggered: { type: 'Boolean', default: false },
});

// Tag component to mark buttons as pressable by hands
export const HandPressable = createComponent("HandPressable", {});

// Store button actions separately (can't store functions in component data)
const buttonActions = new Map<number, (() => void) | null>();

// System to handle hand-based button pressing (inspired by three.js example)
export class ButtonSystem extends createSystem({
  pressable: { required: [Button, HandPressable] },
}) {
  private xrInput?: XRInputManager;
  private box3 = new THREE.Box3();
  private vec3 = new THREE.Vector3();
  private keyJoints = [13, 17, 21]; // Thumb tip, Index tip, Middle tip

  init() {
    if ((this.world as any).xrInput) {
      this.xrInput = (this.world as any).xrInput;
    }

    // Initialize button resting positions and surfaceY (matching three.js example)
    this.queries.pressable.subscribe("qualify", (entity) => {
      const obj3D = entity.object3D;
      if (obj3D && Button.data.restingY[entity.index] < 0) {
        Button.data.restingY[entity.index] = obj3D.position.y;
        
        // Calculate surfaceY from geometry if not already set (for GLB buttons)
        // In three.js example, surfaceY is the top surface Y coordinate in local space
        if (obj3D instanceof THREE.Mesh && obj3D.geometry) {
          obj3D.geometry.computeBoundingBox();
          if (obj3D.geometry.boundingBox && Button.data.surfaceY[entity.index] === 0.05) {
            Button.data.surfaceY[entity.index] = obj3D.geometry.boundingBox.max.y;
          }
        }
      }
    });
  }

  update(delta: number) {
    if (!this.xrInput) {
      if ((this.world as any).xrInput) {
        this.xrInput = (this.world as any).xrInput;
      } else {
        return;
      }
    }

    // Only check hands if we're in an XR session
    const xrSession = (this.world as any).renderer?.xr?.getSession?.();
    if (!xrSession) {
      return; // Not in XR session
    }

    // Get hand adapters
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

    if (hands.length === 0) {

      return; // No hands found
    }
    
    // Log hand detection occasionally

    // Process each pressable button
    if (this.queries.pressable.entities.size === 0) {
      // Only log occasionally to avoid spam

      return;
    }
    
    // Log button count occasionally
    
    this.queries.pressable.entities.forEach(entity => {
      const buttonMesh = entity.object3D;
      const idx = entity.index;
      
      if (!buttonMesh) {
        return;
      }
      
      if (Button.data.restingY[idx] < 0) {
        Button.data.restingY[idx] = buttonMesh.position.y;
      }

      // Preserve prevState, clear currState (will be set by collision detection)
      Button.data.prevState[idx] = Button.data.currState[idx];
      Button.data.currState[idx] = 'resting';

      // Check for hand collisions - following three.js example approach
      const pressingDistances: number[] = [];
      
      // Get button bounding box in world space for intersection check
      // Important: setFromObject accounts for all parent transforms automatically
      this.box3.setFromObject(buttonMesh);
      
      // Log button size occasionally for debugging
      if (Math.random() < 0.01) {
  
      }
      
      // Don't expand - use exact bounding box for accurate collisions
      // Only expand slightly (2mm) to account for finger tip size
      this.box3.expandByScalar(0.06);
      
      hands.forEach(hand => {
        const side = hand.handedness;
        
        // Use index finger tip (joint 17) as the pointer position - matching three.js example
        // The three.js example uses hand.getPointerPosition() which typically uses index finger
        const indexTipJoint = hand.jointSpaces[17]; // Index finger tip
        if (!indexTipJoint) {
          // Log occasionally if joint not found
          return;
        }
        
        // Get pointer position in world space
        // Try to access the joint as Object3D first (most common case in iwsdk)
        let pointerPosition = new THREE.Vector3();
        let positionFound = false;
        const jointAny = indexTipJoint as any;
        
        // Method 1: Direct Object3D access (most likely)
        if (indexTipJoint instanceof THREE.Object3D) {
          indexTipJoint.getWorldPosition(pointerPosition);
          positionFound = true;
        }
        // Method 2: Check matrixWorld (updated transform matrix)
        else if (jointAny.matrixWorld && jointAny.matrixWorld instanceof THREE.Matrix4) {
          pointerPosition.setFromMatrixPosition(jointAny.matrixWorld);
          positionFound = true;
        }
        // Method 3: Access through hand's scene graph - joints might be children of hand model
        else if ((hand as any).object3D) {
          const handObj3D = (hand as any).object3D;
          if (handObj3D instanceof THREE.Object3D) {
            // Try to find the joint in the hand's children
            handObj3D.traverse((child) => {
              if ((child as any).jointIndex === 17 || child === (indexTipJoint as any)) {
                if (child instanceof THREE.Object3D) {
                  child.getWorldPosition(pointerPosition);
                  positionFound = true;
                }
              }
            });
          }
        }
        // Method 4: Use XRFrame API if available (WebXR native)
        // XRJointSpace is likely an XRSpace that needs to be queried via XRFrame
        else if ((this.world as any).renderer?.xr?.getFrame) {
          try {
            const xrFrame = (this.world as any).renderer.xr.getFrame();
            if (xrFrame) {
              // Try to get reference space (usually 'local' or 'viewer')
              const referenceSpace = (this.world as any).renderer.xr.getReferenceSpace() || 
                                     (this.world as any).renderer.xr.getReferenceSpace('local');
              
              if (referenceSpace && indexTipJoint) {
                // indexTipJoint should be an XRSpace - get its pose
                const pose = xrFrame.getPose(indexTipJoint as any, referenceSpace);
                if (pose && pose.transform && pose.transform.position) {
                  pointerPosition.set(
                    pose.transform.position.x,
                    pose.transform.position.y,
                    pose.transform.position.z
                  );
                  positionFound = true;
 
                }
              }
            }
          } catch (e) {
            // XRFrame API not available or failed
          }
        }
        if (!positionFound) {
          return;
        }
        
        // Check if hand intersects button (similar to hand.intersectBoxObject())
        // Use exact bounding box check for accurate collisions
        const isInside = this.box3.containsPoint(pointerPosition);
        
        // Calculate distance for debugging
        const distanceToBox = this.box3.distanceToPoint(pointerPosition);
        
        
        if (isInside) {
          // Convert pointer position to button's local space (matching three.js: object.worldToLocal(pressingPosition))
          const localPos = new THREE.Vector3();
          buttonMesh.worldToLocal(localPos.copy(pointerPosition));
          
          // Get the actual button surface Y in local space
          // surfaceY should be the top of the button in local coordinates
          let buttonSurfaceY = Button.data.surfaceY[idx];
          
          // If surfaceY seems wrong, recalculate from geometry
          if (buttonMesh instanceof THREE.Mesh && buttonMesh.geometry) {
            buttonMesh.geometry.computeBoundingBox();
            if (buttonMesh.geometry.boundingBox) {
              const geometryTopY = buttonMesh.geometry.boundingBox.max.y;
              // Use geometry top if it's more reasonable (positive and not too large)
              if (geometryTopY > 0 && geometryTopY < 1.0) {
                buttonSurfaceY = geometryTopY;
              }
            }
          }
          
          // Calculate pressing distance: surfaceY - localPos.y (matching three.js example)
          // If positive, finger is below the surface (pressing)
          const pressingDistance = buttonSurfaceY - localPos.y;
          
          // Allow small negative values (finger slightly above surface) to account for tracking inaccuracy
          // But require finger to be at or below surface for actual pressing
          if (pressingDistance > -0.0016) { // Allow 55mm tolerance above surface (more forgiving)
            const actualPressDistance = Math.max(0, pressingDistance);
            pressingDistances.push(actualPressDistance);

          }
        }
      });

      const restingY = Button.data.restingY[idx];
      const recoverySpeed = Button.data.recoverySpeed[idx];
      const fullPressDistance = Button.data.fullPressDistance[idx];

      // Handle button state based on collisions - matching three.js example logic
      if (pressingDistances.length === 0) {
        // Not pressed this frame - recover (matching three.js example)
        if (buttonMesh.position.y < restingY) {
          buttonMesh.position.y += recoverySpeed * delta;
          Button.data.currState[idx] = 'recovering';
        } else {
          buttonMesh.position.y = restingY;
          Button.data.currState[idx] = 'resting';
        }
      } else {
        // Pressed - move button down (matching three.js example)
        Button.data.currState[idx] = 'pressed';
        const maxPressingDistance = Math.max(...pressingDistances);
        
        if (maxPressingDistance > 0) {
          // Move button down by the pressing distance
          // Note: position.y is in local space if button is a child of retropanelScene
          const newY = restingY - maxPressingDistance;
          
          // Clamp to maximum press distance
          const minY = restingY - fullPressDistance;
          buttonMesh.position.y = Math.max(newY, minY);
        }

        // Check if fully pressed (matching three.js example)
        if (buttonMesh.position.y <= restingY - fullPressDistance) {
          Button.data.currState[idx] = 'fully_pressed';
          buttonMesh.position.y = restingY - fullPressDistance;
        }
      }

      // Trigger action on fully_pressed state transition
      if (Button.data.currState[idx] === 'fully_pressed' && Button.data.prevState[idx] !== 'fully_pressed') {
        const action = buttonActions.get(idx);
        const actionTriggered = Button.data.actionTriggered[idx] !== 0;
        if (action && !actionTriggered) {
          action();
          Button.data.actionTriggered[idx] = 1;
        }
      } else if (Button.data.currState[idx] !== 'fully_pressed') {
        // Reset action trigger when button is released
        Button.data.actionTriggered[idx] = 0; // Boolean stored as 0/1
      }
    });
  }

  // Call this from index.ts to provide XRInputManager reference
  public setXRInput(xrInput: XRInputManager) {
    this.xrInput = xrInput;
  }

  // Static method to set button action
  public static setButtonAction(entityIndex: number, action: (() => void) | null) {
    buttonActions.set(entityIndex, action);
  }
}
