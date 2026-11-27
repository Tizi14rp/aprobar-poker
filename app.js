"use strict";

const API = "https://api.github.com";
const STORE = "aprobar-poker";
const $ = (id) => document.getElementById(id);

let cfg = loadCfg();
const blobUrls = [];

function loadCfg() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "null");
  } catch {
    return null;
  }
}

function saveCfg(c) {
  cfg = c;
  try {
    if (c) localStorage.setItem(STORE, JSON.stringify(c));
    else localStorage.removeItem(STORE);
  } catch {
    /* almacenamiento bloqueado: queda solo en memoria */
  }
}

// ---------- GitHub API ----------

async function gh(path, { method = "GET", body, raw = false, ok404 = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 404 && ok404) return null;
  if (res.status === 401) {
    const e = new Error("El token no es válido o venció. Conectá de nuevo.");
    e.auth = true;
    throw e;
  }
  if (!res.ok) {
    let msg = `GitHub respondió ${res.status}`;
    try {
      const j = await res.json();
      if (j.message) msg += `: ${j.message}`;
    } catch {
      /* sin cuerpo */
    }
    throw new Error(msg);
  }
  if (raw === "blob") return res.blob();
  if (raw) return res.text();
  return res.status === 204 ? null : res.json();
}

const repoPath = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

// ---------- UI helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

function ask(title, text, { input = false, placeholder = "", okLabel = "Confirmar", required = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $("dlg");
    $("dlg-title").textContent = title;
    $("dlg-text").textContent = text;
    const inp = $("dlg-input");
    inp.hidden = !input;
    inp.value = "";
    inp.placeholder = placeholder;
    inp.required = required;
    $("dlg-ok").textContent = okLabel;
    dlg.onclose = () => resolve(dlg.returnValue === "ok" ? (input ? inp.value.trim() : true) : null);
    dlg.showModal();
    if (input) inp.focus();
  });
}

function show(view) {
  for (const v of ["setup", "main", "settings"]) $(`view-${v}`).hidden = v !== view;
}

function handleError(err) {
  if (err.auth) {
    saveCfg(null);
    show("setup");
  }
  toast(err.message || String(err));
}

// ---------- pendientes ----------

// claude/post-2026-11-27 y las alternativas tras un rechazo: claude/post-2026-11-27-b, -c…
const dateFromRef = (ref) => (ref.match(/^claude\/post-(\d{4}-\d{2}-\d{2})(?:-[a-z0-9]+)?$/) || [])[1];

async function loadPending() {
  const panel = $("tab-pending");
  panel.replaceChildren(el("div", { class: "spinner", text: "Cargando posts…" }));
  blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));

  const prs = await gh(`${repoPath()}/pulls?state=open&per_page=30&sort=created&direction=asc`);
  const posts = prs.filter((p) => dateFromRef(p.head.ref) && p.head.repo && p.head.repo.full_name === p.base.repo.full_name);
  $("count-pending").textContent = String(posts.length);
  if (!posts.length) {
    panel.replaceChildren(el("div", { class: "card empty", text: "No hay posts para revisar. Claude arma uno nuevo cada mañana." }));
    return;
  }
  panel.replaceChildren();
  for (const pr of posts) panel.append(await renderPr(pr));
}

async function renderPr(pr) {
  const date = dateFromRef(pr.head.ref);
  const sha = pr.head.sha;
  const card = el("article", { class: "card" });
  card.append(el("div", { class: "post-head" }, el("h2", { text: pr.title }), el("span", { class: "post-date", text: date })));

  let plan = null;
  let caption = "";
  try {
    plan = JSON.parse(await gh(`${repoPath()}/contents/posts/${date}/plan.json?ref=${sha}`, { raw: true }));
    caption = await gh(`${repoPath()}/contents/posts/${date}/caption.md?ref=${sha}`, { raw: true, ok404: true }) || plan.caption;
  } catch (err) {
    if (err.auth) throw err;
    card.append(el("div", { class: "status err", text: `No pude leer el plan: ${err.message}` }));
  }

  const media = await gh(`${repoPath()}/contents/posts/${date}/media?ref=${sha}`, { ok404: true });
  const images = (Array.isArray(media) ? media : [])
    .filter((f) => /^slide-\d+\.jpg$/.test(f.name))
    .sort((a, b) => parseInt(a.name.slice(6), 10) - parseInt(b.name.slice(6), 10));
  const isReel = plan && plan.format === "reel";
  const files = Array.isArray(media) ? media : [];
  const reelFile = files.find((f) => f.name === "reel.mp4");
  const coverFile = files.find((f) => f.name === "cover.jpg");
  const expected = plan ? plan.slides.length : 0;
  const ready = isReel ? Boolean(reelFile && coverFile) : plan && images.length === expected;

  if (isReel && reelFile) {
    const video = el("video", { class: "reel", controls: "", playsinline: "", preload: "metadata" });
    card.append(video);
    if (coverFile) {
      gh(`${repoPath()}/contents/${coverFile.path}?ref=${sha}`, { raw: "blob" })
        .then((b) => { const u = URL.createObjectURL(b); blobUrls.push(u); video.poster = u; })
        .catch(() => {});
    }
    gh(`${repoPath()}/contents/${reelFile.path}?ref=${sha}`, { raw: "blob" })
      .then((b) => { const u = URL.createObjectURL(b); blobUrls.push(u); video.src = u; })
      .catch(() => card.append(el("div", { class: "status err", text: "No se pudo cargar el video." })));
    card.append(el("p", { class: "slide-count", text: `Reel · ${expected} escenas${plan.narration === false ? "" : " · con voz (sintética)"}` }));
  } else if (images.length) {
    const strip = el("div", { class: "slides" });
    card.append(strip);
    card.append(el("p", { class: "slide-count", text: `${images.length} imagen(es) · deslizá para ver todas` }));
    for (const img of images) {
      const tag = el("img", { alt: `${img.name} del post ${date}`, loading: "lazy" });
      strip.append(tag);
      gh(`${repoPath()}/contents/${img.path}?ref=${sha}`, { raw: "blob" })
        .then((b) => {
          const u = URL.createObjectURL(b);
          blobUrls.push(u);
          tag.src = u;
        })
        .catch(() => (tag.alt = "No se pudo cargar la imagen"));
    }
  }

  if (!ready) {
    const checks = await gh(`${repoPath()}/commits/${sha}/check-runs`).catch(() => ({ check_runs: [] }));
    const failed = (checks.check_runs || []).some((c) => c.conclusion === "failure");
    card.append(el("div", {
      class: `status ${failed ? "err" : "warn"}`,
      text: failed
        ? "El render falló (texto que no entra o plan inválido). Pedí cambios o revisá el PR en GitHub."
        : isReel ? "Generando el video… tarda unos minutos, actualizá después." : "Generando las imágenes… actualizá en un minuto.",
    }));
  }

  if (caption) card.append(el("div", { class: "caption", text: caption }));
  if (plan && plan.riskFlags && plan.riskFlags.length) {
    card.append(el("div", { class: "flags" }, ...plan.riskFlags.map((f) => el("span", { class: "flag", text: `⚠ ${f}` }))));
  }

  const approve = el("button", { class: "btn primary", type: "button", text: "✓ Aprobar" });
  approve.disabled = !ready;
  approve.addEventListener("click", () => doApprove(pr, sha, approve));
  const changes = el("button", { class: "btn", type: "button", text: "Pedir cambios", onclick: () => doChanges(pr) });
  const reject = el("button", { class: "btn danger", type: "button", text: "Rechazar", onclick: () => doReject(pr) });
  card.append(el("div", { class: "actions" }, approve, changes, reject));
  return card;
}

async function doApprove(pr, sha, btn) {
  const ok = await ask("¿Aprobar este post?", "Se publica en Instagram en la próxima ventana (11:15 a 12:30).", { okLabel: "Aprobar" });
  if (!ok) return;
  btn.disabled = true;
  try {
    // Se fija el sha que viste: si el PR cambió después, GitHub rechaza el merge.
    await gh(`${repoPath()}/pulls/${pr.number}/merge`, {
      method: "PUT",
      body: { merge_method: "squash", sha, commit_title: `Aprobado: ${pr.title} (#${pr.number})` },
    });
    toast("Aprobado ✓ Sale en la ventana de 11:15 a 12:30.");
    await refresh();
  } catch (err) {
    btn.disabled = false;
    handleError(err.message && err.message.includes("409") ? new Error("El post cambió mientras lo mirabas. Actualizá y revisalo de nuevo.") : err);
  }
}

async function doChanges(pr) {
  const text = await ask("Pedir cambios", "Claude los aplica en su próxima ejecución (a la mañana).", {
    input: true,
    placeholder: "Ej.: cambiá el título del primer slide por algo más corto",
    okLabel: "Enviar",
    required: true,
  });
  if (!text) return;
  try {
    await gh(`${repoPath()}/issues/${pr.number}/comments`, { method: "POST", body: { body: `Pedido de cambios: ${text}` } });
    toast("Pedido enviado.");
  } catch (err) {
    handleError(err);
  }
}

async function doReject(pr) {
  const reason = await ask("Rechazar el post", "No se publica. Podés dejar el motivo para que Claude lo tenga en cuenta (opcional).", {
    input: true,
    placeholder: "Motivo (opcional)",
    okLabel: "Rechazar",
  });
  if (reason === null) return;
  try {
    if (reason) await gh(`${repoPath()}/issues/${pr.number}/comments`, { method: "POST", body: { body: `Rechazado: ${reason}` } });
    await gh(`${repoPath()}/pulls/${pr.number}`, { method: "PATCH", body: { state: "closed" } });
    toast("Rechazado. No se va a publicar.");
    await refresh();
  } catch (err) {
    handleError(err);
  }
}

// ---------- aprobados ----------

async function loadDone() {
  const panel = $("tab-done");
  panel.replaceChildren(el("div", { class: "spinner", text: "Cargando…" }));
  const [dirs, historyText] = await Promise.all([
    gh(`${repoPath()}/contents/posts`, { ok404: true }),
    gh(`${repoPath()}/contents/history/index.json`, { raw: true, ok404: true }),
  ]);
  let history = [];
  try {
    history = JSON.parse(historyText || "[]");
  } catch {
    history = [];
  }
  const published = new Map(history.map((h) => [h.date, h]));
  const recent = (Array.isArray(dirs) ? dirs : [])
    .filter((d) => d.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, 14);

  const card = el("div", { class: "card" });
  if (!recent.length) card.append(el("p", { class: "empty", text: "Todavía no hay posts aprobados." }));
  for (const date of recent) {
    const pub = published.get(date);
    let state;
    if (pub && pub.permalink) {
      state = el("a", { href: pub.permalink, target: "_blank", rel: "noopener noreferrer", text: "Ver en Instagram ↗" });
    } else {
      const approved = await gh(`${repoPath()}/contents/posts/${date}/approved.json`, { ok404: true });
      state = el("span", { class: approved ? "pill ok" : "pill", text: approved ? "En cola · 11:15-12:30" : "Sin aprobar" });
    }
    card.append(el("div", { class: "done-row" }, el("span", { text: `${date}${pub ? ` · ${pub.topic}` : ""}` }), state));
  }
  panel.replaceChildren(card);
}

// ---------- navegación ----------

let currentTab = "pending";

async function refresh() {
  if (!cfg) return show("setup");
  show("main");
  try {
    if (currentTab === "pending") await loadPending();
    else await loadDone();
  } catch (err) {
    handleError(err);
  }
}

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    $("tab-pending").hidden = currentTab !== "pending";
    $("tab-done").hidden = currentTab !== "done";
    refresh();
  }),
);

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("setup-error").textContent = "";
  const candidate = { owner: $("in-owner").value.trim(), repo: $("in-repo").value.trim(), token: $("in-token").value.trim() };
  cfg = candidate;
  try {
    const info = await gh(repoPath());
    if (!info.permissions || !info.permissions.push) throw new Error("El token no tiene permiso de escritura en ese repo.");
    saveCfg(candidate);
    $("in-token").value = "";
    toast("Conectado ✓");
    refresh();
  } catch (err) {
    cfg = null;
    $("setup-error").textContent = err.auth ? "Token inválido." : err.message;
  }
});

$("btn-refresh").addEventListener("click", refresh);
$("btn-settings").addEventListener("click", () => {
  if (!cfg) return;
  $("settings-repo").textContent = `${cfg.owner}/${cfg.repo}`;
  show("settings");
});
$("btn-back").addEventListener("click", refresh);
$("btn-logout").addEventListener("click", async () => {
  if (!(await ask("Olvidar el token", "Vas a tener que pegarlo de nuevo para usar la app en este dispositivo.", { okLabel: "Olvidar" }))) return;
  saveCfg(null);
  show("setup");
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
refresh();
