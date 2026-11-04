import * as THREE from 'three';
import type { Team } from '../sim/sim';
import { inVision, type Vision } from '../sim/systems/visibility';

/** A fog cell eases from clear to fogged (or back) over this long (s), so edges glide instead of popping. */
const EASE_SECONDS = 0.25;

/** Shared by every material `patchFog` touches: the viewer's vision as a texture over the map rectangle. */
const uniforms = {
  fogMap: { value: null as THREE.Texture | null },
  /** minX, minY, width, height (sim metres). */
  fogRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** Share of brightness fogged ground loses; 0 until the first vision arrives. */
  fogDark: { value: 0 },
};

/** Darkens a material's colour where the viewer's team can't see (D-010 "fogged ground is drawn darker"). Its geometry must be in world space. */
export function patchFog(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 fogRect;\nvarying vec2 vFogUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogUv = vec2((position.x - fogRect.x) / fogRect.z, (-position.z - fogRect.y) / fogRect.w);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D fogMap;\nuniform float fogDark;\nvarying vec2 vFogUv;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (fogDark > 0.0) diffuseColor.rgb *= mix(1.0 - fogDark, 1.0, texture2D(fogMap, vFogUv).r);');
  };
}

/** The viewer's fog of war for render: the ground texture, eased each frame, and `sees` for effects. */
export class Fog {
  private vision: Vision | undefined;
  private texture: THREE.DataTexture | undefined;
  private data = new Uint8Array(0);

  constructor(private readonly viewer: Team) {}

  /** Call after every sim tick with the snapshot's vision; `dark` is `fog.darkPct` as a fraction. */
  capture(vision: Vision, dark: number) {
    this.vision = vision;
    const n = vision.cols * vision.rows;
    if (!this.texture || this.data.length !== n) {
      this.texture?.dispose();
      this.data = new Uint8Array(n).fill(255);
      this.texture = new THREE.DataTexture(this.data, vision.cols, vision.rows, THREE.RedFormat, THREE.UnsignedByteType);
      this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
      this.texture.unpackAlignment = 1;
      this.texture.needsUpdate = true;
      uniforms.fogMap.value = this.texture;
      uniforms.fogRect.value.set(vision.minX, vision.minY, vision.cols * vision.cell, vision.rows * vision.cell);
    }
    uniforms.fogDark.value = dark;
  }

  /** Eases every cell towards the latest vision. */
  update(dt: number) {
    const v = this.vision;
    if (!v || !this.texture) return;
    const seen = v.teams[this.viewer]!;
    const step = Math.max(1, Math.round((255 * dt) / EASE_SECONDS));
    let changed = false;
    for (let k = 0; k < this.data.length; k++) {
      const want = seen[k] ? 255 : 0;
      const has = this.data[k]!;
      if (has === want) continue;
      this.data[k] = want > has ? Math.min(want, has + step) : Math.max(want, has - step);
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  /** Does the viewer's team see (x, y)? True before the first vision arrives. */
  sees(x: number, y: number): boolean {
    return !this.vision || inVision(this.vision, this.viewer, x, y);
  }
}
