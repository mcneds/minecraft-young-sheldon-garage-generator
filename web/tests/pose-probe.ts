import { AnimationMixer, Box3, LoopOnce, SkinnedMesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export async function comparePoses() {
  const manifest = await (await fetch("/template/manifest.json")).json();
  const rows = await (await fetch("/template/pose-bounds.json")).json();
  let worst = 0;
  let checked = 0;
  const failures: string[] = [];
  for (const slot of manifest.slots)
    for (const model of ["classic", "slim"]) {
      const gltf = await new GLTFLoader().loadAsync(
        "/template/" + slot.models[model],
      );
      const mixer = new AnimationMixer(gltf.scene);
      const actions = gltf.animations.map((clip) => {
        const action = mixer.clipAction(clip);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        return action;
      });
      // Include reverse sampling to catch actions stuck at their clamped endpoint.
      for (const frame of [84, 44, 19, 0]) {
        for (const action of actions) action.reset().play();
        mixer.setTime(frame / 30);
        gltf.scene.updateMatrixWorld(true);
        const reference = rows.find(
          (r: { slot: string; model: string; frame: number }) =>
            r.slot === slot.id && r.model === model && r.frame === frame,
        );
        gltf.scene.traverse((object) => {
          if (!(object instanceof SkinnedMesh)) return;
          object.skeleton.update();
          object.computeBoundingBox();
          const bounds = new Box3()
            .copy(object.boundingBox!)
            .applyMatrix4(object.matrixWorld);
          const name = Object.keys(reference.parts).find((part) =>
            object.name.endsWith(part),
          );
          if (!name) throw new Error("Unrecognized mesh: " + object.name);
          const actual = [...bounds.min.toArray(), ...bounds.max.toArray()];
          const expected = reference.parts[name];
          if (!expected) throw new Error("Missing reference for " + name);
          const error = Math.max(
            ...actual.map((v, i) => Math.abs(v - expected[i])),
          );
          worst = Math.max(worst, error);
          checked++;
          if (error > 0.0001)
            failures.push(`${slot.id}/${model}/${frame}/${name}: ${error}`);
        });
      }
      gltf.scene.traverse((object) => {
        if (object instanceof SkinnedMesh) {
          object.geometry.dispose();
          object.skeleton.dispose();
        }
      });
    }
  return { worst, checked, failures };
}
