import "./style.css";
import { CastRenderer, templateUrl } from "./renderer";
import { activeSkin, activeModel, type Entry, type Manifest } from "./types";
import { freeSlot, moveEntry, frameAt, frameStart } from "./state";
import { decodeSkin, faceUrl, lookupSkin } from "./skins";
import { exportGif } from "./export";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const app = $("#app");
app.innerHTML = `<header><h1>Minecraft GIF Maker</h1></header>
<main>
<div id="notice" class="notice" role="alert" hidden></div>
<div class="workspace">
<section class="panel players-panel">
  <div class="panel-heading"><h2>Players</h2><span id="count">0/12</span></div>
  <fieldset id="editor" disabled><div class="cast-content">
    <label class="form-label" for="names">Usernames</label>
    <form id="add-form" class="add-form"><input id="names" autocomplete="off" spellcheck="false" placeholder="Username, Username" aria-describedby="names-hint"><button id="add">Add</button></form>
    <p id="names-hint" class="hint">Separate with commas or spaces.</p>
    <button id="add-upload" class="quiet add-upload" type="button">Add skin</button>
    <p id="global-status" class="hint" role="status"></p>
    <div id="cards" class="cards"></div>
  </div></fieldset>
  <details class="positions"><summary>Positions</summary><div id="diagram" class="diagram" aria-label="Scene positions, viewed from the camera"></div><div id="legend" class="legend"></div><p class="hint">Choosing an occupied position swaps players.</p></details>
</section>
<section class="panel preview-panel">
  <div class="panel-heading"><h2>Preview</h2></div>
  <div class="preview-stage"><canvas id="preview" width="498" height="498" aria-label="Animated cast preview"></canvas></div>
  <fieldset id="playback" disabled><div class="controls"><button id="play" aria-label="Pause preview">Ⅱ</button><input id="timeline" type="range" min="0" max="84" value="0" aria-label="Animation frame"><span id="time" class="time">0.00 / 2.83</span></div></fieldset>
  <div class="export-area">
    <label class="size-label" for="size">Size <select id="size" aria-label="Export size"><option value="256">256 × 256</option><option value="498">498 × 498</option></select></label>
    <div class="export-buttons"><button id="generate" class="primary" disabled>Generate GIF</button><button id="png" disabled>Save PNG</button><button id="cancel" hidden>Cancel</button><a id="download" class="button primary" hidden download="minecraft.gif">Download GIF</a></div>
    <div id="export-status" class="hint" role="status">Loading scene…</div><progress id="progress" max="1" value="0" hidden aria-label="Export progress"></progress>
  </div>
</section>
</div></main>`;
let manifest: Manifest, renderer: CastRenderer;
let entries: Entry[] = [];
let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let seekVersion = 0;
let renderedFrame = -1,
  renderedVersion = -1;
let currentFrame = 0,
  origin = performance.now(),
  drawing: Promise<void> | undefined;
let syncTask: Promise<void> = Promise.resolve(),
  syncVersion = 0,
  ready = false,
  busy = false,
  renderError = false,
  gifUrl: string | undefined;
let exportController: AbortController | undefined;
const lookups = new Map<string, AbortController>();
const preview = $<HTMLCanvasElement>("#preview"),
  previewContext = preview.getContext("2d")!;
const status = $("#export-status");
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function say(message: string, error = false) {
  $("#global-status").textContent = message;
  $("#global-status").classList.toggle("error", error);
}
function invalidate() {
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = undefined;
  $("#download").hidden = true;
  $("#download").removeAttribute("href");
  status.textContent = "";
}
function updateButtons() {
  const hasPlayers = entries.length > 0 && entries.every(activeSkin),
    loading = entries.some((e) => e.loading);
  $<HTMLButtonElement>("#generate").disabled =
    !ready || busy || renderError || !hasPlayers || loading;
  $<HTMLButtonElement>("#png").disabled =
    !ready || busy || renderError || !hasPlayers || loading;
  $<HTMLButtonElement>("#add").disabled = entries.length >= 12;
  $<HTMLButtonElement>("#add-upload").disabled = entries.length >= 12;
  $<HTMLSelectElement>("#size").disabled = busy;
  $<HTMLFieldSetElement>("#editor").disabled = !ready || busy;
  $<HTMLFieldSetElement>("#playback").disabled = !ready || busy;
  $("#play").textContent = playing ? "Ⅱ" : "▶";
  $("#play").setAttribute(
    "aria-label",
    playing ? "Pause preview" : "Play preview",
  );
  $("#count").textContent = `${entries.length}/12`;
  $("#cancel").hidden = !busy;
}
function showCards() {
  const cards = $("#cards");
  cards.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "player";
    card.dataset.id = entry.id;
    // User-controlled names are assigned using DOM properties, never interpolated into HTML.
    card.innerHTML = `<div class="player-top"><div class="face"></div><form class="name-form"><input aria-label="Player username" spellcheck="false" placeholder="Custom skin"><button title="Look up username">Load</button></form><button class="remove" aria-label="Remove player">×</button></div><div class="player-options"><label>Position<select class="position" aria-label="Player position"></select></label><label>Arm width<select class="model" aria-label="Arm width"><option value="auto">Auto</option><option value="classic">Classic</option><option value="slim">Slim</option></select></label></div><div class="skin-actions"><button class="quiet upload">Upload PNG</button><button class="quiet find-player">Find in scene</button><button class="quiet clear" hidden>Use fetched skin</button></div><p class="player-status" role="status"></p>`;
    const skin = activeSkin(entry),
      face = card.querySelector(".face")!;
    if (skin) {
      const img = new Image();
      img.src = faceUrl(skin);
      img.alt = "";
      img.className = "face";
      face.replaceWith(img);
    } else
      face.textContent = String(
        manifest.slots.findIndex((s) => s.id === entry.slot) + 1,
      ).padStart(2, "0");
    const name = card.querySelector("input")!;
    name.value = entry.name;
    card.querySelector("form")!.onsubmit = (event) => {
      event.preventDefault();
      entry.name = name.value.trim();
      entry.fetched = undefined;
      invalidate();
      void loadEntry(entry);
    };
    card.querySelector<HTMLButtonElement>(".remove")!.onclick = () => {
      lookups.get(entry.id)?.abort();
      lookups.delete(entry.id);
      entries = entries.filter((e) => e.id !== entry.id);
      changed();
    };
    const positions = card.querySelector<HTMLSelectElement>(".position")!;
    for (const [index, slot] of manifest.slots.entries()) {
      const occupant = entries.find(
        (e) => e.slot === slot.id && e.id !== entry.id,
      );
      positions.add(
        new Option(
          `${String(index + 1).padStart(2, "0")} · ${slot.label}${occupant ? " ↔" : ""}`,
          slot.id,
        ),
      );
    }
    positions.value = entry.slot;
    positions.onchange = () => {
      entries = moveEntry(entries, entry.id, positions.value);
      changed();
    };
    const model = card.querySelector<HTMLSelectElement>(".model")!;
    model.options[0].textContent = `Auto (${activeModel({ ...entry, model: "auto" }) === "slim" ? "Slim" : "Classic"})`;
    model.value = entry.model;
    model.onchange = () => {
      entry.model = model.value as Entry["model"];
      changed();
    };
    card.querySelector<HTMLButtonElement>(".upload")!.onclick = () =>
      pickSkin(entry.id);
    const findPlayer = card.querySelector<HTMLButtonElement>(".find-player")!;
    findPlayer.disabled = !skin;
    findPlayer.onclick = () => {
      const window = manifest.slots.find(
        (slot) => slot.id === entry.slot,
      )?.appearance;
      if (!window) return;
      currentFrame = Math.floor((window.start_frame + window.end_frame) / 2);
      seekVersion++;
      playing = false;
      updateButtons();
      preview.scrollIntoView({ block: "center" });
    };
    const clear = card.querySelector<HTMLButtonElement>(".clear")!;
    clear.hidden = !entry.uploaded;
    clear.textContent = entry.fetched ? "Use account skin" : "Remove upload";
    clear.onclick = () => {
      entry.uploaded = undefined;
      changed();
    };
    const message = card.querySelector(".player-status")!;
    message.textContent = entry.error || (entry.loading ? "Loading skin…" : "");
    card.querySelector<HTMLButtonElement>(".upload")!.title = entry.uploaded
      ? `${entry.uploaded.label}${entry.uploaded.legacy ? " · Legacy skin converted" : ""}`
      : "Upload a 64×64 or 64×32 PNG skin";
    message.classList.toggle("error", !!entry.error);
    cards.append(card);
  }
  const diagram = $("#diagram");
  diagram.replaceChildren();
  const legend = $("#legend");
  legend.replaceChildren();
  for (const [index, slot] of manifest.slots.entries()) {
    const actor = entries.find((e) => e.slot === slot.id);
    const dot = document.createElement("span");
    dot.className = `slot-dot${actor ? " occupied" : ""}`;
    dot.textContent = String(index + 1).padStart(2, "0");
    dot.style.left = `${50 + slot.position[0] * 12}%`;
    dot.style.top = `${80 - slot.position[1] * 14}%`;
    dot.title =
      slot.label + (actor ? `: ${actor.name || "Custom skin"}` : " (empty)");
    diagram.append(dot);
    const item = document.createElement("span");
    const number = document.createElement("strong");
    number.textContent = dot.textContent;
    item.append(number, slot.label);
    legend.append(item);
  }
  updateButtons();
}
function changed() {
  invalidate();
  showCards();
  const version = ++syncVersion;
  ready = false;
  renderError = false;
  updateButtons();
  const snapshot = entries.map((e) => ({ ...e }));
  syncTask = renderer
    .sync(snapshot)
    .then(() => {
      if (version === syncVersion) {
        ready = true;
        updateButtons();
        status.textContent = entries.some(
          (entry) => !entry.loading && !activeSkin(entry),
        )
          ? "Load or remove players with missing skins."
          : "";
      }
    })
    .catch((error) => {
      if (version === syncVersion) {
        ready = true;
        renderError = true;
        updateButtons();
        say(`Could not load player models: ${errorMessage(error)}`, true);
        $<HTMLButtonElement>("#generate").disabled = true;
      }
    });
}
async function loadEntry(entry: Entry) {
  lookups.get(entry.id)?.abort();
  const controller = new AbortController();
  lookups.set(entry.id, controller);
  entry.loading = true;
  entry.error = undefined;
  changed();
  try {
    const skin = await lookupSkin(entry.name, controller.signal);
    const current = entries.find((e) => e.id === entry.id);
    if (!controller.signal.aborted && current) current.fetched = skin;
  } catch (error) {
    const current = entries.find((e) => e.id === entry.id);
    if (!controller.signal.aborted && current)
      current.error = errorMessage(error);
  } finally {
    if (lookups.get(entry.id) === controller) {
      lookups.delete(entry.id);
      const current = entries.find((e) => e.id === entry.id);
      if (current) {
        current.loading = false;
        changed();
      }
    }
  }
}
async function addNames(names: string[]) {
  if (entries.length + names.length > 12) {
    say(
      `There are ${12 - entries.length} positions left. Add fewer names.`,
      true,
    );
    return;
  }
  if (names.some((name) => !/^[A-Za-z0-9_]{1,16}$/.test(name))) {
    say("Use Java usernames: 1–16 letters, numbers or underscores.", true);
    return;
  }
  const added: Entry[] = [];
  for (const name of names) {
    const slot = freeSlot(entries, manifest.slots)!;
    const entry: Entry = {
      id: crypto.randomUUID(),
      name,
      slot,
      model: "auto",
      loading: true,
    };
    entries.push(entry);
    added.push(entry);
  }
  changed();
  say("");
  // Avoid sending twelve simultaneous requests to a shared public service.
  for (const entry of added) {
    const current = entries.find((e) => e.id === entry.id);
    if (current) await loadEntry(current);
  }
}
function pickSkin(id?: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,.png";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const existing = entries.find((e) => e.id === id);
      const skin = await decodeSkin(
        file,
        existing?.fetched?.model || "classic",
        file.name,
      );
      if (id && !existing) return;
      if (existing) {
        existing.uploaded = skin;
        existing.error = undefined;
      } else {
        const slot = freeSlot(entries, manifest.slots);
        if (!slot) {
          say("All 12 positions are occupied.", true);
          return;
        }
        entries.push({
          id: crypto.randomUUID(),
          name: "",
          slot,
          model: "auto",
          uploaded: skin,
        });
      }
      say("");
      changed();
    } catch (error) {
      say(errorMessage(error), true);
    }
  };
  input.click();
}
$("#add-form").onsubmit = (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>("#names");
  const names = input.value
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (names.length) {
    void addNames(names);
    input.value = "";
  }
};
$("#add-upload").onclick = () => pickSkin();
$("#size").onchange = () => invalidate();
$("#play").onclick = () => {
  seekVersion++;
  playing = !playing;
  origin = performance.now() - frameStart(currentFrame, manifest.durations);
  updateButtons();
};
$("#timeline").oninput = () => {
  seekVersion++;
  playing = false;
  currentFrame = Number($<HTMLInputElement>("#timeline").value);
  updateButtons();
};
async function draw() {
  if (!ready || busy) return;
  const frame = playing
    ? frameAt(performance.now() - origin, manifest.durations)
    : currentFrame;
  if (frame === renderedFrame && syncVersion === renderedVersion) return;
  const version = syncVersion,
    seek = seekVersion;
  const canvas = await renderer.render(frame, 498);
  if (busy || version !== syncVersion || seek !== seekVersion) return;
  previewContext.drawImage(canvas, 0, 0, 498, 498);
  currentFrame = frame;
  renderedFrame = frame;
  renderedVersion = version;
  $<HTMLInputElement>("#timeline").value = String(frame);
  $("#time").textContent =
    `${(frameStart(frame, manifest.durations) / 1000).toFixed(2)} / 2.83`;
}
function tick() {
  if (ready && !busy && !drawing) {
    drawing = draw()
      .catch((error) => {
        ready = false;
        $("#notice").hidden = false;
        $("#notice").textContent = errorMessage(error);
        updateButtons();
      })
      .finally(() => {
        drawing = undefined;
      });
  }
  requestAnimationFrame(tick);
}
function setBusy(value: boolean) {
  busy = value;
  document.body.classList.toggle("busy", value);
  updateButtons();
}
$("#generate").onclick = async () => {
  invalidate();
  const controller = new AbortController();
  exportController = controller;
  setBusy(true);
  await drawing;
  await syncTask;
  $("#progress").hidden = false;
  try {
    const blob = await exportGif(
      renderer,
      Number($<HTMLSelectElement>("#size").value),
      controller.signal,
      (value, label) => {
        $<HTMLProgressElement>("#progress").value = value;
        status.textContent = label;
      },
    );
    controller.signal.throwIfAborted();
    gifUrl = URL.createObjectURL(blob);
    $<HTMLAnchorElement>("#download").href = gifUrl;
    $("#download").hidden = false;
    status.textContent = `GIF ready · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
  } catch (error) {
    status.textContent = controller.signal.aborted
      ? "Export cancelled."
      : `Export failed: ${errorMessage(error)}`;
  } finally {
    exportController = undefined;
    $("#progress").hidden = true;
    origin = performance.now() - frameStart(currentFrame, manifest.durations);
    setBusy(false);
  }
};
$("#cancel").onclick = () => exportController?.abort();
$("#png").onclick = async () => {
  setBusy(true);
  await drawing;
  await syncTask;
  try {
    const canvas = await renderer.render(
      currentFrame,
      Number($<HTMLSelectElement>("#size").value),
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("PNG encoding failed.")),
        "image/png",
      ),
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `cast-frame-${String(currentFrame).padStart(2, "0")}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    status.textContent = errorMessage(error);
  } finally {
    setBusy(false);
  }
};
async function start() {
  try {
    const response = await fetch(templateUrl("manifest.json"));
    if (!response.ok)
      throw new Error(
        "The animation template is missing. Reload to try again.",
      );
    manifest = await response.json();
    if (manifest.version !== 1 || !manifest.validated)
      throw new Error(
        "This scene template has not passed validation. Rebuild the prepared assets.",
      );
    renderer = new CastRenderer(manifest);
    await renderer.sync([]);
    ready = true;
    showCards();
    await draw();
    status.textContent = "";
    tick();
  } catch (error) {
    $("#notice").hidden = false;
    $("#notice").textContent = errorMessage(error);
    status.textContent = "Preview unavailable.";
  }
}
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  exportController?.abort();
  for (const controller of lookups.values()) controller.abort();
  renderer?.dispose();
  invalidate();
});
void start();
