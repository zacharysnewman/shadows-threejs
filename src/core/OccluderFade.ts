/**
 * Fades static geometry standing between the camera and the player (§3.2).
 *
 * §3.2 requires that nothing hides the player from their own camera, and at a 72° pitch a
 * 3 m wall on the camera side of the player does exactly that. Phase 2 recorded it as a
 * problem for the art pass. Phase 3 made it fatal rather than untidy: with the lights out
 * (§4), an occluding wall is not a wall the player can see over — it is an unlit black
 * rectangle indistinguishable from empty space, and on the example map the player spawns
 * behind one and sees nothing at all, beam included.
 *
 * The mechanism is a cylinder from the player to the camera. Fragments of static geometry
 * inside it, above floor height, are dithered away — a screen door rather than real
 * transparency, so there is no sorting to get wrong and no second render pass. Only the
 * *visible* surface is affected: the shadow pass uses Three's depth material and never
 * sees this patch, so a faded wall still blocks the beam and still casts its shadow. The
 * wall is not gone, it is being seen through.
 *
 * Applied by patching the shared prefab materials, because the map is instanced (§7) and
 * anything per-object would mean giving up instancing to solve a rendering problem.
 */

import * as THREE from 'three';

/** Radius of the see-through cylinder, in metres. Wide enough to clear the capsule. */
const RADIUS = 1.3;
/** Fragments below this height are never faded, so floors are never dithered. */
const MIN_HEIGHT = 0.5;

const VERTEX_HOOK = '#include <project_vertex>';
const FRAGMENT_HOOK = '#include <clipping_planes_fragment>';

export class OccluderFade {
  /** Shared across every patched material, so one update moves them all. */
  private readonly uniforms = {
    uOccluderNear: { value: new THREE.Vector3() },
    uOccluderFar: { value: new THREE.Vector3() },
    uOccluderRadius: { value: RADIUS },
    uOccluderEnabled: { value: 1 },
  };

  private readonly patched = new WeakSet<THREE.Material>();

  get enabled(): boolean {
    return this.uniforms.uOccluderEnabled.value === 1;
  }

  set enabled(value: boolean) {
    this.uniforms.uOccluderEnabled.value = value ? 1 : 0;
  }

  /** Patch every material under `root`. Safe to call twice; materials are patched once. */
  attach(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) this.patch(material);
    });
  }

  private patch(material: THREE.Material): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vOccluderWorld;\nvoid main() {')
        .replace(
          VERTEX_HOOK,
          `${VERTEX_HOOK}
          vec4 occluderWorld = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            occluderWorld = instanceMatrix * occluderWorld;
          #endif
          vOccluderWorld = ( modelMatrix * occluderWorld ).xyz;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `varying vec3 vOccluderWorld;
          uniform vec3 uOccluderNear;
          uniform vec3 uOccluderFar;
          uniform float uOccluderRadius;
          uniform float uOccluderEnabled;

          // Distance from a point to the segment between the player and the camera.
          float occluderDistance( vec3 p, vec3 a, vec3 b ) {
            vec3 ab = b - a;
            float t = clamp( dot( p - a, ab ) / max( dot( ab, ab ), 1e-4 ), 0.0, 1.0 );
            return length( p - ( a + ab * t ) );
          }

          // Ordered 4×4 dither. A hash would shimmer as the camera moves; an ordered
          // matrix holds still and reads as a stipple.
          float occluderDither() {
            const mat4 bayer = mat4(
               0.0,  8.0,  2.0, 10.0,
              12.0,  4.0, 14.0,  6.0,
               3.0, 11.0,  1.0,  9.0,
              15.0,  7.0, 13.0,  5.0
            ) / 16.0;
            ivec2 cell = ivec2( mod( gl_FragCoord.xy, 4.0 ) );
            return bayer[ cell.x ][ cell.y ];
          }

          void main() {`,
        )
        .replace(
          FRAGMENT_HOOK,
          `${FRAGMENT_HOOK}
          if ( uOccluderEnabled > 0.5 && vOccluderWorld.y > ${MIN_HEIGHT.toFixed(2)} ) {
            float d = occluderDistance( vOccluderWorld, uOccluderNear, uOccluderFar );
            // Solid at the rim, fully gone over the player, so the window has a soft edge
            // rather than a punched hole.
            float fade = 1.0 - smoothstep( uOccluderRadius * 0.55, uOccluderRadius, d );
            if ( fade > occluderDither() ) discard;
          }`,
        );
    };

    // Otherwise Three may hand this material a cached program compiled from the unpatched
    // source of an identically-configured material.
    material.customProgramCacheKey = () => 'occluder-fade';
    material.needsUpdate = true;
  }

  /** Called per rendered frame with the player's interpolated position (§3.2, §7). */
  update(camera: THREE.Camera, playerX: number, playerY: number, playerZ: number): void {
    this.uniforms.uOccluderNear.value.set(playerX, playerY, playerZ);
    camera.getWorldPosition(this.uniforms.uOccluderFar.value);
  }
}
