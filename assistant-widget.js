(() => {
  const script = document.currentScript;
  const assetBase = script?.src ? new URL(".", script.src) : new URL(".", window.location.href);
  const localEndpoint = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8787"
    : "";
  const endpoint = String(
    window.BM_ASSISTANT_ENDPOINT || script?.dataset.endpoint || localEndpoint,
  ).replace(/\/$/, "");
  const storageKey = "bm-experiment-assistant-v1";
  const maxUserTurns = 8;

  const state = loadState();
  let busy = false;
  let typingNode = null;
  let pendingDiagnosticFile = null;

  const launcher = element("button", "bm-assistant-launcher", {
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "bm-assistant-panel",
  });
  const launcherLogo = element("img", "", {
    src: new URL("assets/baradozig-monogram.svg", assetBase).href,
    alt: "",
  });
  launcher.append(launcherLogo, document.createTextNode("Tester mon Excel"));

  const panel = element("section", "bm-assistant-panel", {
    id: "bm-assistant-panel",
    role: "dialog",
    "aria-label": "Assistant The Business Model Experiment",
    hidden: "",
  });
  const header = element("header", "bm-assistant-header");
  const headerLogo = launcherLogo.cloneNode();
  const title = element("div", "bm-assistant-title");
  title.append(
    textElement("strong", "Diagnostic business model"),
    textElement("span", "Une première lecture, sans jargon"),
  );
  const close = element("button", "bm-assistant-close", {
    type: "button",
    "aria-label": "Fermer l'assistant",
  });
  const reset = element("button", "bm-assistant-reset", {
    type: "button",
    "aria-label": "Recommencer le diagnostic",
    title: "Recommencer",
  });
  reset.textContent = "↻";
  close.textContent = "×";
  header.append(headerLogo, title, reset, close);

  const log = element("div", "bm-assistant-log", {
    role: "log",
    "aria-live": "polite",
    "aria-relevant": "additions",
  });
  const composer = element("form", "bm-assistant-composer");
  const input = element("textarea", "", {
    rows: "1",
    maxlength: "1600",
    placeholder: "Décrivez votre activité ou votre question…",
    "aria-label": "Votre message",
  });
  const send = element("button", "", { type: "submit" });
  send.textContent = "Envoyer";
  composer.append(input, send);
  panel.append(header, log, composer);
  document.body.append(launcher, panel);

  launcher.addEventListener("click", openPanel);
  close.addEventListener("click", closePanel);
  reset.addEventListener("click", resetAssistant);
  document.querySelectorAll("[data-bm-assistant-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openPanel();
      if (trigger.hasAttribute("data-bm-assistant-no-file")) {
        startWithoutFile();
      } else if (!state.mode) {
        startMode("diagnostic");
      }
    });
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMessage(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage(input.value);
    }
  });

  renderConversation();
  const requestedFromLink = new URLSearchParams(window.location.search).get("assistant") === "1";
  if (!state.mode && (["/", "/index.html"].includes(window.location.pathname) || requestedFromLink)) {
    openPanel();
    startMode("diagnostic");
  }

  function loadState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.messages)) {
        return {
          mode: saved.mode || null,
          messages: saved.messages.slice(-16),
          userTurns: Number(saved.userTurns || 0),
          diagnosticUsed: Boolean(saved.diagnosticUsed),
          diagnosticClarifications: Number(saved.diagnosticClarifications || 0),
          awaitingDiagnosticClarification: false,
          fileSkipped: Boolean(saved.fileSkipped),
        };
      }
    } catch (_) {
      // A fresh session is safer than blocking the widget on malformed storage.
    }
    return {
      mode: null,
      messages: [],
      userTurns: 0,
      diagnosticUsed: false,
      diagnosticClarifications: 0,
      awaitingDiagnosticClarification: false,
      fileSkipped: false,
    };
  }

  function saveState() {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        mode: state.mode,
        messages: state.messages.slice(-16),
        userTurns: state.userTurns,
        diagnosticUsed: state.diagnosticUsed,
        diagnosticClarifications: state.diagnosticClarifications,
        fileSkipped: state.fileSkipped,
      }),
    );
  }

  function element(tag, className = "", attributes = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === "hidden") node.hidden = true;
      else node.setAttribute(name, value);
    });
    return node;
  }

  function textElement(tag, text, className = "") {
    const node = element(tag, className);
    node.textContent = text;
    return node;
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`bm-assistant:${name}`, { detail }));
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: `bm_assistant_${name}`, ...detail });
    }
  }

  function openPanel() {
    panel.hidden = false;
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
    emit("opened", { page: window.location.pathname });
  }

  function closePanel() {
    panel.hidden = true;
    launcher.hidden = false;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function resetAssistant() {
    sessionStorage.removeItem(storageKey);
    window.location.reload();
  }

  function renderConversation() {
    log.replaceChildren();
    if (state.mode === "diagnostic" && !state.diagnosticUsed) {
      panel.classList.add("bm-assistant-panel-prominent");
      showUploadForm();
      return;
    }
    if (!state.messages.length) {
      addBubble(
        "assistant",
        "Bonjour. Si vous avez déjà un prévisionnel, déposez-le : je commencerai par sa structure et je ne vous poserai une question que si votre activité reste ambiguë. Sans fichier, je peux aussi vous aider à identifier le bon modèle.",
        false,
      );
      const starters = element("div", "bm-assistant-starters");
      starters.append(
        choiceButton("Commencer mon diagnostic", () => startMode("diagnostic")),
        choiceButton("J'ai une question précise", () => startMode("question")),
      );
      log.append(starters);
      return;
    }
    state.messages.forEach((message) => addBubble(message.role, message.content, false));
    scrollToBottom();
  }

  function startMode(mode) {
    state.mode = mode;
    log.replaceChildren();
    if (mode === "diagnostic") {
      panel.classList.add("bm-assistant-panel-prominent");
      saveState();
      showUploadForm();
      return;
    }
    panel.classList.remove("bm-assistant-panel-prominent");
    addAssistantMessage("Quelle question vous posez-vous aujourd'hui sur votre activité ou vos chiffres ?");
    saveState();
    input.focus();
    emit("mode_selected", { mode });
  }

  function startWithoutFile() {
    state.mode = "diagnostic";
    state.fileSkipped = true;
    state.diagnosticUsed = false;
    panel.classList.remove("bm-assistant-panel-prominent", "bm-assistant-awaiting-upload");
    log.replaceChildren();
    state.messages = [];
    state.userTurns = 0;
    saveState();
    submitMessage("Je n'ai pas encore de prévisionnel. Aidez-moi à identifier mon ou mes modèles économiques et la ressource adaptée.");
  }

  function addBubble(role, content, persist = true) {
    const bubble = textElement("p", content, `bm-assistant-message ${role}`);
    log.append(bubble);
    if (persist) {
      state.messages.push({ role, content });
      saveState();
    }
    scrollToBottom();
    return bubble;
  }

  function addAssistantMessage(content) {
    return addBubble("assistant", content);
  }

  function addError(content) {
    addBubble("error", content, false);
  }

  function choiceButton(label, callback) {
    const button = textElement("button", label, "bm-assistant-choice");
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
  }

  function showQuickReplies(items) {
    if (!Array.isArray(items) || !items.length) return;
    const group = element("div", "bm-assistant-quick-replies");
    items.slice(0, 3).forEach((label) => {
      group.append(choiceButton(label, () => {
        group.remove();
        submitMessage(label);
      }));
    });
    log.append(group);
    scrollToBottom();
  }

  function showActions(actions) {
    if (!Array.isArray(actions) || !actions.length) return;
    const group = element("div", "bm-assistant-actions");
    actions.slice(0, 2).forEach((action) => {
      const link = textElement("a", action.label, "bm-assistant-action");
      link.href = action.url;
      link.addEventListener("click", () => emit("action_clicked", { id: action.id }));
      group.append(link);
    });
    log.append(group);
    scrollToBottom();
  }

  function setBusy(value, label = "Marie IA réfléchit…") {
    busy = value;
    send.disabled = value;
    input.disabled = value;
    if (value) {
      typingNode = textElement("span", label, "bm-assistant-typing");
      log.append(typingNode);
    } else if (typingNode) {
      typingNode.remove();
      typingNode = null;
    }
    scrollToBottom();
  }

  async function submitMessage(rawValue) {
    const content = String(rawValue || "").trim();
    if (!content || busy) return;
    if (!state.mode) state.mode = "question";
    if (state.userTurns >= maxUserTurns) {
      addError("La conversation a atteint sa limite. Vous pouvez utiliser les liens proposés ou contacter Marie.");
      return;
    }
    input.value = "";
    addBubble("user", content);
    state.userTurns += 1;
    saveState();
    if (state.awaitingDiagnosticClarification && pendingDiagnosticFile) {
      state.awaitingDiagnosticClarification = false;
      saveState();
      await submitDiagnostic(pendingDiagnosticFile, null, true);
      return;
    }
    setBusy(true);
    emit("message_sent", { mode: state.mode, turn: state.userTurns });
    try {
      if (!endpoint) throw new Error("missing_endpoint");
      const response = await fetch(`${endpoint}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: state.mode,
          messages: state.messages,
          page_context: `${document.title} | ${window.location.pathname}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "request_failed");
      setBusy(false);
      addAssistantMessage(data.reply);
      showQuickReplies(data.quick_replies);
      showActions(data.actions);
      if (state.mode === "diagnostic" && data.can_upload_forecast && !state.diagnosticUsed && !state.fileSkipped) {
        showUploadForm();
      }
      if (data.actions?.length) emit("recommendation_shown", { ids: data.actions.map((item) => item.id) });
    } catch (error) {
      setBusy(false);
      const message = error.message === "missing_endpoint"
        ? "Le diagnostic IA est prêt mais son accès sécurisé n'est pas encore activé. Vous pouvez utiliser le formulaire Contact en attendant."
        : error.message || "L'assistant est momentanément indisponible.";
      addError(message);
    }
  }

  function showUploadForm() {
    panel.classList.add("bm-assistant-awaiting-upload");
    const form = element("form", "bm-assistant-upload");
    const heading = textElement("h3", "Testez votre Excel");
    const lead = textElement(
      "p",
      "Votre prévisionnel traduit-il vraiment votre business model ?",
      "bm-assistant-upload-lead",
    );
    const copy = textElement(
      "p",
      "Déposez votre fichier. L'assistant identifiera vos activités et vérifiera rapidement si les mécanismes importants sont bien représentés, sans juger vos chiffres.",
    );
    const file = element("input", "", {
      type: "file",
      accept: ".xlsx,.xls,.csv",
      "aria-label": "Prévisionnel Excel ou CSV",
    });
    const consentLabel = element("label", "bm-assistant-consent");
    const consent = element("input", "", { type: "checkbox" });
    consentLabel.append(
      consent,
      document.createTextNode(
        "J'accepte que ce fichier soit transmis à OpenAI pour ce diagnostic. Il n'est pas conservé par le site ; les journaux de sécurité de l'API peuvent être gardés jusqu'à 30 jours.",
      ),
    );
    const submit = textElement("button", "Analyser la structure");
    submit.type = "submit";
    const skip = textElement("button", "Je n'ai pas encore de fichier", "bm-assistant-skip");
    skip.type = "button";
    form.append(heading, lead, copy, file, consentLabel, submit, skip);
    log.append(form);
    scrollToBottom();

    skip.addEventListener("click", () => {
      panel.classList.remove("bm-assistant-awaiting-upload");
      state.fileSkipped = true;
      saveState();
      form.remove();
      submitMessage("Je n'ai pas encore de prévisionnel. Aidez-moi à identifier la structure et les ressources adaptées.");
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!file.files?.[0]) {
        file.setCustomValidity("Choisissez un fichier Excel ou CSV.");
        file.reportValidity();
        return;
      }
      file.setCustomValidity("");
      if (!consent.checked) {
        consent.setCustomValidity("Votre accord est nécessaire pour envoyer le fichier.");
        consent.reportValidity();
        return;
      }
      consent.setCustomValidity("");
      panel.classList.remove("bm-assistant-awaiting-upload");
      await submitDiagnostic(file.files[0], form);
    });
  }

  async function submitDiagnostic(file, form = null, isClarification = false) {
    if (busy || state.diagnosticUsed) return;
    const limit = 5 * 1024 * 1024;
    if (file.size > limit) {
      addError("Le fichier dépasse 5 Mo. Allégez-le ou utilisez un export CSV de la partie principale.");
      return;
    }
    pendingDiagnosticFile = file;
    setBusy(true, "Analyse de la structure du fichier…");
    form?.querySelectorAll("button,input").forEach((node) => { node.disabled = true; });
    emit(isClarification ? "diagnostic_clarification_submitted" : "diagnostic_started", {
      extension: file.name.split(".").pop()?.toLowerCase(),
    });
    try {
      if (!endpoint) throw new Error("missing_endpoint");
      const body = new FormData();
      body.set("file", file);
      body.set("consent", "yes");
      body.set(
        "context",
        `Nombre de clarifications deja demandees : ${state.diagnosticClarifications}\n${state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n")}`,
      );
      const response = await fetch(`${endpoint}/diagnostic`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "diagnostic_failed");
      setBusy(false);
      form?.remove();
      if (data.status === "needs_clarification") {
        state.diagnosticClarifications += 1;
        state.awaitingDiagnosticClarification = true;
        saveState();
        const models = Array.isArray(data.identified_models) && data.identified_models.length
          ? `J'identifie pour l'instant : ${data.identified_models.join(", ")}. `
          : "";
        addAssistantMessage(`${models}${data.clarification_question || "Pouvez-vous préciser comment votre activité gagne de l'argent ?"}`);
        input.focus();
        return;
      }
      state.diagnosticUsed = true;
      state.awaitingDiagnosticClarification = false;
      pendingDiagnosticFile = null;
      saveState();
      renderDiagnostic(data);
      renderRecommendation(data.recommendation);
      showActions(data.actions);
      showRestartButton();
      emit("diagnostic_completed", { recommendations: data.actions?.map((item) => item.id) || [] });
    } catch (error) {
      setBusy(false);
      form?.querySelectorAll("button,input").forEach((node) => { node.disabled = false; });
      const message = error.message === "missing_endpoint"
        ? "L'analyse sécurisée du fichier n'est pas encore activée. Votre fichier n'a pas été envoyé."
        : error.message || "Le diagnostic n'a pas pu être produit.";
      addError(message);
    }
  }

  function renderDiagnostic(data) {
    const box = element("article", "bm-assistant-diagnostic");
    box.append(textElement("h3", "Ce que votre prévisionnel doit mieux couvrir"));
    if (Array.isArray(data.identified_models) && data.identified_models.length) {
      box.append(textElement(
        "p",
        `Modèle${data.identified_models.length > 1 ? "s" : ""} identifié${data.identified_models.length > 1 ? "s" : ""} : ${data.identified_models.join(", ")}.`,
        "bm-assistant-models",
      ));
    }
    box.append(textElement("p", data.summary));
    appendDiagnosticList(box, "Manques repérés", data.key_gaps);
    if (data.priority) {
      const priority = element("section", "bm-assistant-priority");
      priority.append(textElement("h4", "À traiter en premier"));
      priority.append(textElement("p", data.priority));
      box.append(priority);
    }
    if (data.limitations) box.append(textElement("p", data.limitations, "bm-assistant-limit"));
    log.append(box);
    scrollToBottom();
  }

  function renderRecommendation(recommendation) {
    if (!recommendation?.title && !recommendation?.copy) return;
    const box = element("article", "bm-assistant-recommendation");
    box.append(textElement("span", "Notre recommandation", "bm-assistant-eyebrow"));
    if (recommendation.title) box.append(textElement("h3", recommendation.title));
    if (recommendation.copy) box.append(textElement("p", recommendation.copy));
    if (Array.isArray(recommendation.templates) && recommendation.templates.length) {
      const section = element("section");
      section.append(textElement("h4", recommendation.templates.length > 1
        ? "Combinaison proposée"
        : "Template proposé"));
      const list = element("ul");
      recommendation.templates.forEach((item) => list.append(textElement("li", item.label)));
      section.append(list);
      box.append(section);
    }
    log.append(box);
    scrollToBottom();
  }

  function showRestartButton() {
    const button = textElement("button", "Recommencer un diagnostic", "bm-assistant-restart");
    button.type = "button";
    button.addEventListener("click", resetAssistant);
    log.append(button);
    scrollToBottom();
  }

  function appendDiagnosticList(parent, heading, items) {
    if (!Array.isArray(items) || !items.length) return;
    const section = element("section");
    section.append(textElement("h4", heading));
    const list = element("ul");
    items.forEach((item) => list.append(textElement("li", item)));
    section.append(list);
    parent.append(section);
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }
})();
