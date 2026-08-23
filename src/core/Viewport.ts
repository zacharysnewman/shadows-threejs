/**
 * Renderer, scene and camera setup with resize handling (§1, §3.2, §7).
 *
 * The camera is the pitched top-down rig the spec specifies; Phase 2 attaches it to the
 * player, and until then the debug free camera drives it. Shadow settings are configured
 * here because §7 treats the shadow pipeline as a design constraint rather than a polish
 * pass — the map should be viewed under the settings the game will actually ship with.
 */

import * as THREE from 'three';
import { CAMERA, RENDER } from '../config';

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly onResize = () => this.resize();

  constructor(parent: HTMLElement = document.body) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    // §7 — PCF soft shadows.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parent.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Place the camera looking at a world point from the spec's pitch and distance (§3.2).
   * No yaw: the map's north stays screen-up.
   */
  frame(targetX: number, targetZ: number, distance: number = CAMERA.distance): void {
    const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDegrees);
    // "Above and behind" along the pitch vector: height from the sine, pull-back along +Z
    // from the cosine.
    this.camera.position.set(
      targetX,
      Math.sin(pitch) * distance,
      targetZ + Math.cos(pitch) * distance,
    );
    this.camera.lookAt(targetX, 0, targetZ);
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.camera.aspect = height === 0 ? 1 : width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
