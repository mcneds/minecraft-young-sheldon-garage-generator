import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { activeSkin, activeModel, type Entry, type Manifest } from "./types";

export const templateUrl = (path: string) =>
  `${import.meta.env.BASE_URL}template/${path}`;
class AtlasCache {
  private cache = new Map<string, ImageBitmap>();
  // Keep the small, fixed set of compressed files so looping never re-fetches them.
  private compressed = new Map<string, Promise<Blob>>();
  async get(url: string) {
    if (this.cache.has(url)) {
      const image = this.cache.get(url)!;
      this.cache.delete(url);
      this.cache.set(url, image);
      return image;
    }
    if (!this.compressed.has(url)) {
      const blob = fetch(templateUrl(url))
        .then((response) => {
          if (!response.ok)
            throw new Error(
              "A scene asset could not be loaded. Reload to try again.",
            );
          return response.blob();
        })
        .catch((error) => {
          this.compressed.delete(url);
          throw error;
        });
      this.compressed.set(url, blob);
    }
    const image = await createImageBitmap(await this.compressed.get(url)!);
    this.cache.set(url, image);
    if (this.cache.size > 2) {
      const key = this.cache.keys().next().value!;
      this.cache.get(key)!.close();
      this.cache.delete(key);
    }
    return image;
  }
  dispose() {
    for (const image of this.cache.values()) image.close();
    this.cache.clear();
    this.compressed.clear();
  }
}
interface Actor {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  material: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
  key: string;
  skin: HTMLCanvasElement;
}
export class CastRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private backdrop = new AtlasCache();
  private foreground = new AtlasCache();
  private models = new Map<string, Promise<GLTF>>();
  private actors = new Map<string, Actor>();
  private revision = 0;
  private disposed = false;
  private output = document.createElement("canvas");
  private context = this.output.getContext("2d", { willReadFrequently: true })!;
  constructor(public manifest: Manifest) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!context)
      throw new Error(
        "This browser cannot use WebGL 2. Enable hardware acceleration or open this page in a current Chrome, Firefox or Safari browser.",
      );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(manifest.fov, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight(0xe2ebff, 0x8c7250, 2));
    const key = new THREE.DirectionalLight(0xffedcd, 2.5);
    key.position.set(-3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.camera.far = 30;
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.0001;
    key.shadow.radius = 3;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcbdfff, 0.8);
    fill.position.set(4, 3, 0);
    this.scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }
  private load(path: string) {
    if (!this.models.has(path)) {
      const promise = new GLTFLoader()
        .loadAsync(templateUrl(path))
        .catch((error) => {
          this.models.delete(path);
          throw error;
        });
      this.models.set(path, promise);
    }
    return this.models.get(path)!;
  }
  private remove(id: string) {
    const actor = this.actors.get(id);
    if (!actor) return;
    actor.mixer.stopAllAction();
    actor.mixer.uncacheRoot(actor.root);
    this.scene.remove(actor.root);
    actor.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
    actor.texture.dispose();
    actor.material.dispose();
    this.actors.delete(id);
  }
  async sync(entries: Entry[]) {
    const revision = ++this.revision;
    for (const id of this.actors.keys())
      if (!entries.some((e) => e.id === id && activeSkin(e))) this.remove(id);
    for (const entry of entries) {
      const skin = activeSkin(entry);
      if (!skin) continue;
      const model = activeModel(entry),
        key = `${entry.slot}/${model}`;
      const old = this.actors.get(entry.id);
      if (old?.key === key && old.skin === skin.canvas) continue;
      const slot = this.manifest.slots.find((s) => s.id === entry.slot)!;
      const gltf = await this.load(slot.models[model]);
      if (revision !== this.revision || this.disposed) return;
      this.remove(entry.id);
      const root = clone(gltf.scene);
      const texture = new THREE.CanvasTexture(skin.canvas);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        metalness: 0,
        alphaTest: 0.5,
      });
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.material = material;
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      const mixer = new THREE.AnimationMixer(root);
      const actions = gltf.animations.map((clip) => {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        return action;
      });
      this.actors.set(entry.id, {
        root,
        mixer,
        actions,
        texture,
        material,
        key,
        skin: skin.canvas,
      });
      this.scene.add(root);
    }
  }
  async render(frame: number, size: number) {
    const layers = await Promise.all(
      (["backdrop", "foreground"] as const).map(async (layer) => {
        const atlas = this.manifest.atlases[layer].find(
          (a) => frame >= a.start && frame < a.start + a.count,
        )!;
        return { atlas, image: await this[layer].get(atlas.url) };
      }),
    );
    if (this.disposed) throw new Error("Renderer has been closed.");
    if (this.output.width !== size) {
      this.output.width = this.output.height = size;
      this.renderer.setSize(size, size, false);
    }
    const camera = this.manifest.cameras[frame];
    this.camera.position.fromArray(camera.position);
    this.camera.quaternion.fromArray(camera.quaternion);
    // Reset clamped actions so sampling backwards after the final frame works too.
    for (const actor of this.actors.values()) {
      for (const action of actor.actions) action.reset().play();
      actor.mixer.setTime(frame / this.manifest.animationFps);
    }
    this.renderer.render(this.scene, this.camera);
    const ctx = this.context;
    ctx.clearRect(0, 0, size, size);
    const draw = (layer: (typeof layers)[number]) => {
      const tile = frame - layer.atlas.start,
        w = this.manifest.width,
        h = this.manifest.height;
      ctx.drawImage(
        layer.image,
        (tile % this.manifest.atlasColumns) * w,
        Math.floor(tile / this.manifest.atlasColumns) * h,
        w,
        h,
        0,
        0,
        size,
        size,
      );
    };
    draw(layers[0]);
    ctx.drawImage(this.renderer.domElement, 0, 0);
    draw(layers[1]);
    return this.output;
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    for (const id of this.actors.keys()) this.remove(id);
    this.backdrop.dispose();
    this.foreground.dispose();
    for (const model of this.models.values())
      void model.then((g) =>
        g.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => m.dispose());
          }
        }),
      );
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (!Array.isArray(o.material)) o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
