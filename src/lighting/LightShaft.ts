/**
 * The beam you can see in the air (§4).
 *
 * A `SpotLight` lights the surfaces it reaches and nothing in between, so a torch in a dark
 * room is a pool on the floor with no visible connection to the hand holding it. This draws
 * the connection: the haze inside the cone, raymarched per fragment and sampled against the
 * light's own shadow map, so the shaft is cut by whatever the light is already cutting the
 * floor shadows with.
 *
 * **It is presentation and nothing else.** §4.1's illumination query never sees it, no
 * light-reactive enemy responds to it, and it cannot make a dark corner readable — it adds
 * a little glow to the air along a beam that was already there.
 *
 * Sampling the shadow map rather than fading a cone mesh is what makes it honest. An
 * unshadowed shaft passes straight through a wall and glows on the far side, which reads as
 * the beam shining through solid geometry and contradicts §4's rule that a shadow on the
 * ground means a light is on something. It is also why only a *shadow-casting* light gets a
 * shaft: without a shadow map there is nothing to cut it with, and §7's budget decides which
 * lights have one.
 *
 * The march is bounded three ways, and each bound is doing real work:
 *
 * - **It starts at the proxy's front face.** The mesh is the light's own cone, drawn front
 *   faces only. A cone is convex, so a ray that enters it crosses a front face on the way
 *   in — which means the rasterised fragment *is* the entry point, and no ray-cone
 *   intersection has to be solved in the shader.
 * - **It stops at the floor.** The floor receives shadows but does not cast them (§7), so
 *   the shadow map cannot tell the march that the ground is there. Most of the flashlight's
 *   cone is underground — the axis is declined onto the floor a couple of metres ahead
 *   (§4.1) — so without this the beam would glow through the ground it is lighting.
 * - **It stops at the light's range**, which is the same slant range §4.1 gives the beam.
 *
 * The samples are offset by a screen-space dither. Without it a march this short bands into
 * visible shells; with it the banding becomes noise the eye reads as haze. It is not
 * simulation randomness and does not come from the run's `Rng` (Cross-Cutting) — nothing
 * about the world depends on it, and a replayed run is identical whatever it draws.
 */

import * as THREE from 'three';
import { LIGHT_SHAFT } from '../config';

export interface LightShaftOptions {
  /** Raymarch steps. A compile-time constant: GLSL cannot loop a uniform bound. */
  steps: number;
  /** Haze added per metre of lit beam. The one knob that decides how thick the air is. */
  density: number;
}

export class LightShaft {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;
  private geometry: THREE.ConeGeometry;

  constructor(
    private readonly light: THREE.SpotLight,
    options: LightShaftOptions,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uApex: { value: new THREE.Vector3() },
          uAxis: { value: new THREE.Vector3(0, -1, 0) },
          uColour: { value: new THREE.Color(1, 1, 1) },
          uCosOuter: { value: 0 },
          uCosInner: { value: 0 },
          uRange: { value: 1 },
          uIntensity: { value: 0 },
          uDensity: { value: options.density },
          uFloor: { value: 0 },
          uShadowMap: { value: null },
          uShadowMatrix: { value: new THREE.Matrix4() },
          uShadowBias: { value: 0 },
          uShadowed: { value: 0 },
        },
      ]),
      defines: { SHAFT_STEPS: Math.max(1, Math.round(options.steps)) },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      // Additive, because light adds: the haze brightens what is behind it and never
      // darkens it. Depth-tested so geometry between the camera and the beam still hides
      // it, but never written, so the shaft occludes nothing.
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      fog: true,
    });

    this.geometry = buildProxy(light);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `${light.name || 'Light'}:Shaft`;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // After the opaque pass, so the depth buffer it tests against is complete.
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;

    this.refresh();
  }

  /** Haze per metre — the debug tuner moves this (§8.3). */
  get density(): number {
    return this.material.uniforms.uDensity!.value as number;
  }

  set density(value: number) {
    this.material.uniforms.uDensity!.value = value;
  }

  /**
   * Re-derive the proxy cone from the light's current shape.
   *
   * Called when the beam's angle or range moves — construction, and the debug tuner (§8.3).
   * The proxy is the *only* thing that decides which pixels are considered, so it has to
   * circumscribe the true cone rather than inscribe it: a polygonal cone built the usual way
   * sits inside the shape it approximates, and the sliver it misses is the shaft's own edge.
   */
  refresh(): void {
    const next = buildProxy(this.light);
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;

    const uniforms = this.material.uniforms;
    uniforms.uCosOuter!.value = Math.cos(this.light.angle);
    uniforms.uCosInner!.value = Math.cos(this.light.angle * (1 - this.light.penumbra));
    uniforms.uRange!.value = this.light.distance;
    (uniforms.uColour!.value as THREE.Color).copy(this.light.color);
  }

  /**
   * Place the shaft and set how much of it there is, per rendered frame.
   *
   * `intensity` is 0–1 and is the *rendered* strength of the light it belongs to — the
   * battery's falloff and §5.2's interference for the flashlight, a lamp's flicker for an
   * environmental light. At zero the mesh is hidden outright rather than drawn black: a
   * transparent draw still costs the raymarch.
   */
  update(intensity: number): void {
    const shadow = this.light.shadow;
    const map = shadow.map;
    // §4 — no shadow map, no shaft. An unshadowed one shines through walls, and there is no
    // cheaper way to find out what is in the way than the depth the light already drew.
    // Whether the light *should* be casting is the caller's question, not this one: a lamp
    // handing its shadow slot on (§7) keeps drawing a fading shaft off the map it last
    // rendered, which is a frame or two of slightly stale shadow against a visible pop.
    const visible = intensity > 0 && this.light.visible && map !== null;
    this.mesh.visible = visible;
    if (!visible || !map) return;

    const apex = this.light.getWorldPosition(_apex);
    const axis = this.light.target.getWorldPosition(_axis).sub(apex);
    if (axis.lengthSq() < 1e-8) {
      this.mesh.visible = false;
      return;
    }
    axis.normalize();

    this.mesh.position.copy(apex);
    // The proxy is built with its apex at the origin opening along -Y, so this is the turn
    // from that to the beam's axis.
    this.mesh.quaternion.setFromUnitVectors(_down, axis);
    this.mesh.updateMatrixWorld();

    const uniforms = this.material.uniforms;
    (uniforms.uApex!.value as THREE.Vector3).copy(apex);
    (uniforms.uAxis!.value as THREE.Vector3).copy(axis);
    uniforms.uIntensity!.value = intensity;
    uniforms.uShadowMap!.value = map.texture;
    (uniforms.uShadowMatrix!.value as THREE.Matrix4).copy(shadow.matrix);
    // The light's own bias, plus a little: a marched sample sits in mid-air rather than on
    // the surface the bias was tuned for, and acne in the haze reads as the beam fizzing.
    uniforms.uShadowBias!.value = shadow.bias + LIGHT_SHAFT.shadowBias;
    uniforms.uShadowed!.value = 1;
    uniforms.uFloor!.value = LIGHT_SHAFT.floorHeight;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The proxy cone: apex at the origin, opening along -Y, one radial ring of segments.
 *
 * Circumscribed rather than inscribed — see `refresh`. Open-ended, because the only cap a
 * spotlight cone has is at its far end, and for the flashlight that end is entirely below
 * the floor the march stops at.
 */
function buildProxy(light: THREE.SpotLight): THREE.ConeGeometry {
  const segments = LIGHT_SHAFT.proxySegments;
  const height = Math.max(light.distance, 0.01);
  const inscribed = height * Math.tan(Math.min(light.angle, Math.PI / 2 - 1e-3));
  const radius = (inscribed / Math.cos(Math.PI / segments)) * LIGHT_SHAFT.proxyMargin;

  const geometry = new THREE.ConeGeometry(radius, height, segments, 1, true);
  // `ConeGeometry` puts its apex at +height/2; the shaft is placed by its apex.
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

const _apex = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

varying vec3 vEntry;

void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vEntry = world.xyz;

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>

uniform vec3 uApex;
uniform vec3 uAxis;
uniform vec3 uColour;
uniform float uCosOuter;
uniform float uCosInner;
uniform float uRange;
uniform float uIntensity;
uniform float uDensity;
uniform float uFloor;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowBias;
uniform float uShadowed;

varying vec3 vEntry;

/**
 * Is this point lit, by the same map the floor shadows come from? Three packs a spotlight's
 * shadow depth into RGBA, and the shadow matrix carries world space
 * straight to that map's clip space.
 */
float litAt( vec3 p ) {
  if ( uShadowed < 0.5 ) return 1.0;

  vec4 coord = uShadowMatrix * vec4( p, 1.0 );
  coord.xyz /= coord.w;
  coord.z += uShadowBias;

  bool inside = coord.x >= 0.0 && coord.x <= 1.0 && coord.y >= 0.0 && coord.y <= 1.0 && coord.z <= 1.0;
  if ( ! inside ) return 0.0;

  float depth = unpackRGBAToDepth( texture2D( uShadowMap, coord.xy ) );
  return step( coord.z, depth );
}

/** Interleaved gradient noise: one stable value per pixel, and no texture to feed it. */
float dither( vec2 pixel ) {
  return fract( 52.9829189 * fract( dot( pixel, vec2( 0.06711056, 0.00583715 ) ) ) );
}

void main() {
  vec3 origin = cameraPosition;
  vec3 ray = vEntry - origin;
  float entry = length( ray );
  if ( entry < 1e-4 ) discard;
  ray /= entry;

  // The far end: whichever of the light's reach and the floor comes first.
  vec3 toApex = origin - uApex;
  float b = dot( toApex, ray );
  float c = dot( toApex, toApex ) - uRange * uRange;
  float discriminant = b * b - c;
  if ( discriminant <= 0.0 ) discard;
  float exit = -b + sqrt( discriminant );

  if ( ray.y < -1e-5 ) {
    exit = min( exit, ( uFloor - origin.y ) / ray.y );
  }
  if ( exit <= entry ) discard;

  float span = exit - entry;
  float stride = span / float( SHAFT_STEPS );
  float offset = dither( gl_FragCoord.xy );

  float haze = 0.0;
  for ( int i = 0; i < SHAFT_STEPS; i ++ ) {
    vec3 p = origin + ray * ( entry + ( float( i ) + offset ) * stride );

    vec3 fromApex = p - uApex;
    float distance = length( fromApex );
    if ( distance > uRange ) continue;

    float alignment = dot( fromApex, uAxis ) / max( distance, 1e-4 );
    if ( alignment < uCosOuter ) continue;

    // The same two terms the spotlight itself falls off by: §4.1's penumbra across the
    // cone, and a window that reaches zero at the range rather than being cut off at it.
    float cone = smoothstep( uCosOuter, uCosInner, alignment );
    float reach = pow2( saturate( 1.0 - pow4( distance / uRange ) ) );

    haze += cone * reach * litAt( p ) * stride;
  }

  gl_FragColor = vec4( uColour * haze * uDensity * uIntensity, 1.0 );

  #ifdef USE_FOG
    // Additive light fades towards *nothing* with distance, not towards the fog's colour:
    // mixing in fog colour here would add light to the far side of the map (§7).
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
