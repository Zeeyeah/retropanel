import * as THREE from "three";

export function createArcadeControls(scene: THREE.Scene) {
  const controls: any = {};

  // BUTTON GEOMETRY
  const btnGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.015, 32);

  const materials = {
    red: new THREE.MeshStandardMaterial({ color: 0xff3b30 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x007aff }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffcc00 }),
    black: new THREE.MeshStandardMaterial({ color: 0x222222 }),
    grey: new THREE.MeshStandardMaterial({ color: 0xcccccc })
  };

  // PANEL GROUP
  const panel = new THREE.Group();
  panel.position.set(0, 1.3, -0.8); // in front of user
  scene.add(panel);

  // ---- BUTTON CREATOR ----
  const makeButton = (mat: THREE.MeshStandardMaterial, x: number, z: number) => {
    const b = new THREE.Mesh(btnGeo, mat);
    b.rotation.x = Math.PI / 2;
    b.position.set(x, 0.02, z);
    b.userData.isPressed = false;
    b.userData.onPress = () => console.log("Button pressed:", mat.color.getHexString());
    panel.add(b);
    return b;
  };

  controls.A = makeButton(materials.red, 0.11, 0.05);
  controls.B = makeButton(materials.red, 0.23, -0.02);
  controls.X = makeButton(materials.blue, 0.11, -0.10);
  controls.Y = makeButton(materials.yellow, 0.23, -0.17);

  // ---- JOYSTICK ----
  const stickGroup = new THREE.Group();
  stickGroup.position.set(-0.15, 0.03, -0.05);

  const baseGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 32);
  const base = new THREE.Mesh(baseGeo, materials.black);
  base.rotation.x = Math.PI / 2;

  const stickGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.12, 16);
  const stick = new THREE.Mesh(stickGeo, materials.grey);
  stick.position.y = 0.06;

  const ballGeo = new THREE.SphereGeometry(0.03, 16, 16);
  const ball = new THREE.Mesh(ballGeo, materials.red);
  ball.position.y = 0.13;

  stickGroup.add(base);
  stickGroup.add(stick);
  stickGroup.add(ball);

  stickGroup.userData.direction = { x: 0, y: 0 };

  stickGroup.userData.setDirection = (x: number, y: number) => {
    stickGroup.userData.direction = { x, y };
    stick.rotation.z = x * 0.4;
    stick.rotation.x = -y * 0.4;
  };

  panel.add(stickGroup);
  controls.joystick = stickGroup;

  return controls;
}
