import * as THREE from 'three';
import { cockpitCamera, localOffsetMeters, shouldShowSurface } from '../domain/camera.js';

function createSimulatedRunway() {
  const group = new THREE.Group();
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(90, 4200), new THREE.MeshLambertMaterial({ color: 0x202428 }));
  surface.rotation.x = -Math.PI / 2; surface.position.y = 28; group.add(surface);
  const markingMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f5e9 });
  const addMarking = (width, length, x, z) => {
    const marking = new THREE.Mesh(new THREE.PlaneGeometry(width, length), markingMaterial);
    marking.rotation.x = -Math.PI / 2; marking.position.set(x, 30, z); group.add(marking);
  };
  addMarking(2, 4100, -39, 0); addMarking(2, 4100, 39, 0);
  for (let z = -1550; z <= 1550; z += 220) addMarking(3, 95, 0, z);
  for (const side of [-1, 1]) for (let index = 0; index < 4; index += 1) addMarking(6, 85, side * (13 + index * 8), -1820);
  addMarking(70, 9, 0, -1900);
  group.visible = false;
  return group;
}
export function createCockpitRenderer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6da9cb);
  scene.fog = new THREE.Fog(0x8fb8c9, 9000, 85000);
  const camera = new THREE.PerspectiveCamera(62, 1, 1, 140000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const terrainGeometry = new THREE.PlaneGeometry(160000, 160000, 80, 80);
  const positions = terrainGeometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i); const y = positions.getY(i);
    const ridge = Math.sin(x / 6200) * 720 + Math.cos(y / 8800) * 520 + Math.sin((x + y) / 3900) * 260;
    positions.setZ(i, Math.max(0, ridge));
  }
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshLambertMaterial({ color: 0x486e45 }));
  terrain.rotation.x = -Math.PI / 2;
  terrain.visible = false;
  scene.add(terrain);

  const referenceGrid = new THREE.GridHelper(150000, 150, 0x78966d, 0x587851);
  referenceGrid.position.y = 10;
  referenceGrid.material.transparent = true;
  referenceGrid.material.opacity = 0.12;
  referenceGrid.visible = false;
  scene.add(referenceGrid);
  scene.add(new THREE.HemisphereLight(0xdff6ff, 0x30492a, 2.8));
  const sun = new THREE.DirectionalLight(0xffefbd, 2.2); sun.position.set(-20000, 35000, -15000); scene.add(sun);
  const simulatedRunway = createSimulatedRunway(); scene.add(simulatedRunway);

  let frame; let aircraft; let origin; let runwayPositioned = false; let previousTime = performance.now();
  const smoothedPosition = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  function resize() {
    const width = container.clientWidth || 1; const height = container.clientHeight || 1;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function animate(time) {
    frame = requestAnimationFrame(animate); resize();
    const deltaSeconds = Math.min(0.1, Math.max(0.001, (time - previousTime) / 1000));
    previousTime = time;
    if (aircraft) {
      const model = cockpitCamera(aircraft);
      if (model) {
        origin ||= { latitude: model.position.latitude, longitude: model.position.longitude };
        const offset = localOffsetMeters(origin, model.position);
        const showSurface = shouldShowSurface(model.position.altitudeM);
        terrain.visible = showSurface;
        referenceGrid.visible = showSurface;
        simulatedRunway.visible = showSurface;
        if (simulatedRunway.visible && !runwayPositioned) {
          const runwayTrack = model.track * Math.PI / 180;
          const distanceAheadM = 18000;
          simulatedRunway.position.set(Math.sin(runwayTrack) * distanceAheadM, 0, -Math.cos(runwayTrack) * distanceAheadM);
          simulatedRunway.rotation.y = -runwayTrack;
          runwayPositioned = true;
        }
        const visualAltitude = Math.max(240, model.position.altitudeM * 0.34);
        desiredPosition.set(offset.eastM, visualAltitude, -offset.northM);
        const smoothing = 1 - Math.exp(-deltaSeconds * 2.8);
        smoothedPosition.lerp(desiredPosition, smoothing);
        camera.position.copy(smoothedPosition);
        const trackRad = model.track * Math.PI / 180;
        const climbAngle = Math.atan2(aircraft.verticalRateMps || 0, Math.max(1, aircraft.groundSpeedMps || 0));
        const lookDistance = 15000;
        lookTarget.set(
          smoothedPosition.x + Math.sin(trackRad) * lookDistance,
          smoothedPosition.y + Math.tan(climbAngle) * lookDistance,
          smoothedPosition.z - Math.cos(trackRad) * lookDistance
        );
        camera.lookAt(lookTarget);
      }
    }
    renderer.render(scene, camera);
  }
  animate(performance.now());
  return { update(next) { aircraft = next; }, destroy() { cancelAnimationFrame(frame); renderer.dispose(); terrainGeometry.dispose(); container.replaceChildren(); } };
}