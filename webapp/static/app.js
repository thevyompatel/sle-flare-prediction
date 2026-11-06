/* TAGT Flare Predictor - front-end logic (no external dependencies). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
  const f3 = v => v.toFixed(3);
  const NS = "http://www.w3.org/2000/svg";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let INFO = null;
  let SAMPLES = [];
  let mode = "sample";

  /* ---------------- theme ---------------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const savedTheme = store.get("tagt-theme");
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $("#themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("tagt-theme", next);
  });

  /* ---------------- tabs (hash routing) ---------------- */
  function showTab() {
    const id = (location.hash || "#overview").slice(1);
    const valid = $$("[data-panel]").some(p => p.dataset.panel === id) ? id : "overview";
    $$("[data-panel]").forEach(p => { p.hidden = p.dataset.panel !== valid; });
    $$(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === valid));
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", showTab);
  showTab();

  /* ---------------- tooltip ---------------- */
  const tip = $("#tooltip");
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---------------- data loading ---------------- */
  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  async function init() {
    try {
      [INFO, SAMPLES] = await Promise.all([api("/api/info"), api("/api/samples")]);
    } catch (e) {
      document.querySelector("main").insertAdjacentHTML("afterbegin",
        `<div class="card error">Could not reach the prediction server: ${esc(e.message)}. Start it with <code>python webapp/app.py</code>.</div>`);
      return;
    }
    renderOverview();
    renderTeam();
    renderResults();
    renderSamples();
  }

  /* ---------------- overview ---------------- */
  function renderOverview() {
    const d = INFO.metrics.dataset;
    const tagt = INFO.metrics.models["TAGT (ours)"];
    $("#datasetStats").innerHTML = [
      [d.n_patients, "patients (simulated visits)"],
      [d.n_samples, "visit pairs"],
      [d.n_genes.toLocaleString(), "gene-expression probes"],
      [f3(tagt.auc), "TAGT AUC-ROC (patient-grouped CV)"],
    ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
    $$("[data-k]").forEach(s => {
      const k = s.dataset.k;
      s.textContent = k === "flare_rate" ? pct(d[k]) : d[k];
    });
  }

  function renderTeam() {
    const palette = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "#6250d6"];
    $("#teamGrid").innerHTML = INFO.project.team.map((m, i) => {
      const initials = m.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
      return `<article class="card member">
        <div class="avatar" style="background:${palette[i % palette.length]}">${esc(initials)}</div>
        <h3>${esc(m.name)}</h3>
        <div class="id">${esc(m.enrollment)}</div>
      </article>`;
    }).join("");
    $("#footerTeam").textContent = INFO.project.team.map(m => m.name).join(" · ");
  }

  /* ---------------- results ---------------- */
  const ROC_SERIES = [
    { key: "TAGT (ours)", label: "TAGT (ours)", color: "var(--series-1)" },
    { key: "Logistic Regression (clinical)", label: "LogReg · clinical", color: "var(--series-2)" },
    { key: "Logistic Regression (genes + clinical)", label: "LogReg · genes + clinical", color: "var(--series-3)" },
  ];

  function renderResults() {
    const M = INFO.metrics;
    $("#protocolText").textContent =
      `${M.protocol}. Every model is scored on patients it never saw during training. Trained ${M.trained_at}.`;

    const tbody = $("#metricsTable tbody");
    tbody.innerHTML = Object.entries(M.models).map(([name, r]) => `
      <tr class="${name.startsWith("TAGT") ? "ours" : ""}">
        <td>${esc(name)}</td><td>${f3(r.auc)}</td>
        <td>${f3(r.auc_fold_mean)} ± ${f3(r.auc_fold_std)}</td>
        <td>${pct(r.accuracy)}</td><td>${pct(r.sensitivity)}</td><td>${pct(r.specificity)}</td>
        <td>${f3(r.f1)}</td><td>${r.threshold.toFixed(2)}</td>
      </tr>`).join("");

    $("#rocLegend").innerHTML = ROC_SERIES.map(s =>
      `<span><i class="sw sw-line" style="background:${s.color}"></i>${esc(s.label)}</span>`).join("");
    drawRoc($("#rocChart"), M.models);
    drawAucBars($("#aucChart"), M.models);

    const t = M.models["TAGT (ours)"], b = M.models["Logistic Regression (clinical)"];
    const g = M.models["Logistic Regression (genes + clinical)"];
    $("#findings").innerHTML = [
      `TAGT reaches an out-of-fold AUC of <b>${f3(t.auc)}</b> (fold mean ${f3(t.auc_fold_mean)} ± ${f3(t.auc_fold_std)}) on unseen patients, with specificity ${pct(t.specificity)}.`,
      b.auc > t.auc
        ? `The simple <b>clinical-only</b> logistic regression scores higher, at AUC <b>${f3(b.auc)}</b>. Most of the predictive signal in this cohort comes from the current SLEDAI score.`
        : `TAGT outperforms the clinical-only logistic regression (AUC ${f3(b.auc)}).`,
      g.auc < b.auc
        ? `Adding 1,000 raw gene probes to a linear model <em>lowers</em> its AUC (${f3(b.auc)} → ${f3(g.auc)}). The expression data is high-dimensional and noisy relative to the cohort size${t.auc > g.auc ? `. TAGT's regularised encoder copes with it better than the genes + clinical baselines` : ""}.`
        : `Gene expression adds signal over clinical features alone in the linear model (AUC ${f3(g.auc)}).`,
      `Fold-to-fold variation is large (±${f3(t.auc_fold_std)}) because each test fold contains only about 20 patients. A larger cohort is needed before drawing firm conclusions.`,
    ].map(s => `<li>${s}</li>`).join("");
  }

  function drawRoc(host, models) {
    host.innerHTML = "";
    const W = 460, H = 380, m = { t: 12, r: 14, b: 44, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "ROC curves for three models" }, host);
    const x = v => m.l + v * iw, y = v => m.t + (1 - v) * ih;
    const grid = el("g", { class: "grid" }, svg);
    for (let i = 0; i <= 5; i++) {
      const v = i / 5;
      el("line", { x1: x(0), x2: x(1), y1: y(v), y2: y(v) }, grid);
      el("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v.toFixed(1);
      el("text", { x: x(v), y: H - m.b + 18, "text-anchor": "middle" }, svg).textContent = v.toFixed(1);
    }
    el("line", { x1: x(0), y1: y(0), x2: x(1), y2: y(0), class: "baseline" }, svg);
    el("line", { x1: x(0), y1: y(0), x2: x(1), y2: y(1), class: "chance" }, svg);
    el("text", { x: m.l + iw / 2, y: H - 6, "text-anchor": "middle", class: "axis-label" }, svg).textContent = "False positive rate (1 − specificity)";
    el("text", { x: 12, y: m.t + ih / 2, "text-anchor": "middle", class: "axis-label", transform: `rotate(-90 12 ${m.t + ih / 2})` }, svg).textContent = "True positive rate (sensitivity)";

    // Draw TAGT last so it sits on top.
    [...ROC_SERIES].reverse().forEach(s => {
      const r = models[s.key].roc;
      const d = r.fpr.map((f, i) => `${i ? "L" : "M"}${x(f).toFixed(1)},${y(r.tpr[i]).toFixed(1)}`).join("");
      el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    });

    const cross = el("line", { y1: y(1), y2: y(0), stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" }, svg);
    const dots = ROC_SERIES.map(s => el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg));
    const hit = el("rect", { x: x(0), y: y(1), width: iw, height: ih, class: "hit" }, svg);
    const tprAt = (r, f) => { let t = 0; for (let i = 0; i < r.fpr.length; i++) if (r.fpr[i] <= f) t = Math.max(t, r.tpr[i]); return t; };
    hit.addEventListener("pointermove", ev => {
      const pt = svg.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, ((ev.clientX - pt.left) * (W / pt.width) - m.l) / iw));
      cross.setAttribute("x1", x(fx)); cross.setAttribute("x2", x(fx)); cross.setAttribute("visibility", "visible");
      const rows = ROC_SERIES.map((s, i) => {
        const t = tprAt(models[s.key].roc, fx);
        dots[i].setAttribute("cx", x(fx)); dots[i].setAttribute("cy", y(t)); dots[i].setAttribute("visibility", "visible");
        return `<div><i class="sw sw-line" style="background:${s.color};display:inline-block;vertical-align:middle;margin-right:6px"></i>${esc(s.label)}: <b>${pct(t, 0)}</b></div>`;
      });
      showTip(`<div style="margin-bottom:4px">At FPR <b>${pct(fx, 0)}</b>, sensitivity is:</div>${rows.join("")}`, ev);
    });
    hit.addEventListener("pointerleave", () => {
      hideTip(); cross.setAttribute("visibility", "hidden"); dots.forEach(d => d.setAttribute("visibility", "hidden"));
    });
  }

  function drawAucBars(host, models) {
    host.innerHTML = "";
    const rows = Object.entries(models).map(([k, r]) => ({ k, ...r })).sort((a, b) => b.auc - a.auc);
    const W = 460, rowH = 54, m = { t: 8, r: 54, b: 34, l: 12 };
    const H = m.t + rows.length * rowH + m.b, iw = W - m.l - m.r;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "AUC-ROC by model" }, host);
    const x = v => m.l + v * iw;
    const grid = el("g", { class: "grid" }, svg);
    for (let i = 0; i <= 5; i++) {
      const v = i / 5;
      el("line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b }, grid);
      el("text", { x: x(v), y: H - m.b + 18, "text-anchor": "middle" }, svg).textContent = v.toFixed(1);
    }
    el("line", { x1: x(0.5), x2: x(0.5), y1: m.t - 4, y2: H - m.b, class: "chance" }, svg);
    rows.forEach((r, i) => {
      const y0 = m.t + i * rowH;
      const label = el("text", { x: m.l, y: y0 + 14 }, svg);
      label.textContent = r.k;
      if (r.k.startsWith("TAGT")) label.setAttribute("style", "fill:var(--ink);font-weight:700");
      const by = y0 + 22, bh = 16, w = x(r.auc) - x(0);
      const path = `M${x(0)},${by}H${x(0) + w - 4}a4,4 0 0 1 4,4v${bh - 8}a4,4 0 0 1 -4,4H${x(0)}Z`;
      el("path", { d: path, fill: "var(--series-1)", opacity: r.k.startsWith("TAGT") ? 1 : 0.55 }, svg);
      const lo = x(Math.max(0, r.auc_fold_mean - r.auc_fold_std)), hi = x(Math.min(1, r.auc_fold_mean + r.auc_fold_std));
      const cy = by + bh / 2;
      el("line", { x1: lo, x2: hi, y1: cy, y2: cy, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
      el("line", { x1: lo, x2: lo, y1: cy - 5, y2: cy + 5, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
      el("line", { x1: hi, x2: hi, y1: cy - 5, y2: cy + 5, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
      const v = el("text", { x: Math.max(hi, x(r.auc)) + 6, y: cy + 4 }, svg);
      v.textContent = f3(r.auc);
      v.setAttribute("style", "fill:var(--ink);font-weight:600");
      const hit = el("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" }, svg);
      hit.addEventListener("pointermove", ev => showTip(
        `<b>${esc(r.k)}</b><br>Pooled AUC: <b>${f3(r.auc)}</b><br>Fold AUCs: ${r.fold_aucs.map(f3).join(", ")}<br>Mean ± SD: ${f3(r.auc_fold_mean)} ± ${f3(r.auc_fold_std)}`, ev));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  /* ---------------- samples ---------------- */
  function renderSamples() {
    const sel = $("#sampleSelect");
    sel.innerHTML = SAMPLES.map(s =>
      `<option value="${s.index}">${esc(s.patient_id)} · visit ${s.visit_from}→${s.visit_to} · SLEDAI ${s.current_sledai.toFixed(1)}</option>`).join("");
    const meta = () => {
      const s = SAMPLES[+sel.value];
      $("#sampleMeta").textContent =
        `Current SLEDAI-2K ${s.current_sledai.toFixed(1)}, ${s.current_flare ? "flaring" : "not flaring"} now. The true next-visit outcome is revealed after you predict.`;
    };
    sel.addEventListener("change", meta);
    meta();
  }

  $("#randomSample").addEventListener("click", () => {
    const sel = $("#sampleSelect");
    sel.value = String(Math.floor(Math.random() * SAMPLES.length));
    sel.dispatchEvent(new Event("change"));
    runPredict({ sample_index: +sel.value });
  });

  /* ---------------- mode switch ---------------- */
  $$(".seg-btn").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    $$(".seg-btn").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
    $$("[data-mode-panel]").forEach(p => { p.hidden = p.dataset.modePanel !== mode; });
  }));

  const sledai = $("#sledai");
  sledai.addEventListener("input", () => { $("#sledaiOut").textContent = sledai.value; });

  /* ---------------- CSV upload ---------------- */
  let uploaded = null;
  $("#exprFile").addEventListener("change", async ev => {
    const file = ev.target.files[0];
    uploaded = null;
    if (!file) { $("#fileStatus").textContent = ""; return; }
    const text = await file.text();
    const expr = {};
    let bad = 0;
    text.split(/\r?\n/).forEach((line, i) => {
      const [p, v] = line.split(/[,;\t]/).map(s => s && s.trim().replace(/^"|"$/g, ""));
      if (!p || v === undefined || v === "") return;
      const num = Number(v);
      if (Number.isFinite(num)) expr[p] = num; else if (i > 0) bad++;
    });
    uploaded = expr;
    const n = Object.keys(expr).length;
    $("#fileStatus").textContent = `Loaded ${n} probe values from ${file.name}${bad ? ` (${bad} unreadable rows skipped)` : ""}.`;
  });

  /* ---------------- predict ---------------- */
  $("#sampleForm").addEventListener("submit", ev => { ev.preventDefault(); $("#sampleSelect").dispatchEvent(new Event("change")); runPredict({ sample_index: +$("#sampleSelect").value }); });
  $("#customForm").addEventListener("submit", ev => {
    ev.preventDefault();
    runPredict({
      current_sledai: +sledai.value,
      current_flare: +$("input[name=flareNow]:checked").value,
      expression: uploaded || undefined,
    });
  });

  async function runPredict(body) {
    const card = $("#resultCard");
    $$("button[type=submit]").forEach(b => { b.disabled = true; });
    try {
      const r = await api("/api/predict", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      renderResult(r);
    } catch (e) {
      card.innerHTML = `<p class="error">Prediction failed: ${esc(e.message)}</p>`;
    } finally {
      $$("button[type=submit]").forEach(b => { b.disabled = false; });
    }
  }

  function renderResult(r) {
    const t = r.tagt, b = r.baseline;
    let truth = "";
    if (r.actual_next_flare !== undefined) {
      const ok = t.predicted_flare === !!r.actual_next_flare;
      truth = `<div class="truth">Actual outcome at next visit: <b>${r.actual_next_flare ? "Flare" : "No flare"}</b>. TAGT was <b class="${ok ? "ok" : "miss"}">${ok ? "✓ correct" : "✗ incorrect"}</b> at its decision threshold.</div>`;
    }
    $("#resultCard").innerHTML = `
      <div class="result-source">${esc(r.source)}</div>
      <h3>TAGT next-visit flare probability</h3>
      <div class="risk-hero">
        <div class="risk-num">${(t.probability * 100).toFixed(1)}<small>%</small></div>
        <span class="badge ${t.risk}"><i></i>${t.risk} risk</span>
      </div>
      <div class="meter" role="img" aria-label="Probability ${pct(t.probability)}, decision threshold ${pct(t.threshold)}">
        <div class="fill" style="width:${(t.probability * 100).toFixed(1)}%"></div>
        <div class="thr" style="left:calc(${(t.threshold * 100).toFixed(1)}% - 1px)" title="Decision threshold"></div>
      </div>
      <div class="meter-labels"><span>0%</span><span>decision threshold ${pct(t.threshold, 0)}</span><span>100%</span></div>
      <div class="compare">
        <div><div class="k">TAGT prediction</div><div class="v">${t.predicted_flare ? "Flare likely" : "Flare unlikely"}</div></div>
        <div><div class="k">Clinical baseline (LogReg)</div><div class="v">${pct(b.probability)} · ${b.risk}</div></div>
      </div>
      ${truth}`;
    $("#explainCard").hidden = false;
    const genes = r.top_genes.filter(g => Math.abs(g.contribution) > 1e-6);
    if (genes.length) {
      drawExplain($("#explainChart"), genes);
    } else {
      $("#explainChart").innerHTML = `<p class="muted">No gene-level attributions for this input. Every probe is at the cohort average, so the prediction comes from the clinical inputs only. Upload an expression CSV to see which probes push the risk up or down.</p>`;
    }
  }

  function drawExplain(host, genes) {
    host.innerHTML = "";
    const W = 760, rowH = 26, m = { t: 6, r: 70, b: 26, l: 120 };
    const H = m.t + genes.length * rowH + m.b, iw = W - m.l - m.r;
    const maxAbs = Math.max(...genes.map(g => Math.abs(g.contribution)), 1e-6);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Top probe contributions" }, host);
    const labelRoom = 56; // keep value labels clear of probe ids and the edge
    const x = v => m.l + iw / 2 + (v / maxAbs) * (iw / 2 - labelRoom);
    el("line", { x1: x(0), x2: x(0), y1: m.t, y2: H - m.b, class: "baseline" }, svg);
    el("text", { x: m.l + 4, y: H - 6, class: "axis-label" }, svg).textContent = "← lowers risk";
    el("text", { x: W - m.r - 4, y: H - 6, "text-anchor": "end", class: "axis-label" }, svg).textContent = "raises risk →";
    genes.forEach((g, i) => {
      const y0 = m.t + i * rowH, by = y0 + 5, bh = rowH - 10;
      el("text", { x: m.l - 10, y: y0 + rowH / 2 + 4, "text-anchor": "end", style: "font-family:ui-monospace,Consolas,monospace" }, svg).textContent = g.probe;
      const up = g.contribution >= 0;
      const x0 = x(0), x1 = x(g.contribution), w = Math.max(Math.abs(x1 - x0), 2);
      const r = Math.min(4, w / 2);
      const d = up
        ? `M${x0},${by}H${x0 + w - r}a${r},${r} 0 0 1 ${r},${r}v${bh - 2 * r}a${r},${r} 0 0 1 -${r},${r}H${x0}Z`
        : `M${x0},${by}H${x0 - w + r}a${r},${r} 0 0 0 -${r},${r}v${bh - 2 * r}a${r},${r} 0 0 0 ${r},${r}H${x0}Z`;
      el("path", { d, fill: up ? "var(--up)" : "var(--down)" }, svg);
      el("text", { x: up ? x0 + w + 6 : x0 - w - 6, y: y0 + rowH / 2 + 4, "text-anchor": up ? "start" : "end" }, svg)
        .textContent = (up ? "+" : "") + g.contribution.toFixed(3);
      const hit = el("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" }, svg);
      hit.addEventListener("pointermove", ev => showTip(
        `<b>${esc(g.probe)}</b><br>Contribution: <b>${g.contribution.toFixed(4)}</b> (${up ? "raises" : "lowers"} risk)<br>Expression: ${g.expression.toFixed(2)} log₂ · z = ${g.z_score.toFixed(2)}`, ev));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  init();
})();
