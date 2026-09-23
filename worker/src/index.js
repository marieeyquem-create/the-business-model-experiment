const MODEL = "gpt-6-luna";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const FALLBACK_SITE_URL = "https://the-business-model-experiment.com";
const memoryCounters = new Map();
let catalogCache = { expiresAt: 0, templates: [] };

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    phase: {
      type: "string",
      enum: ["understand", "clarify", "first_value", "recommend", "no_fit"],
    },
    quick_replies: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
    action_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 2,
    },
    can_upload_forecast: { type: "boolean" },
  },
  required: ["reply", "phase", "quick_replies", "action_ids", "can_upload_forecast"],
  additionalProperties: false,
};

const DIAGNOSTIC_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["complete", "needs_clarification"],
    },
    identified_models: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    clarification_question: { type: "string" },
    summary: { type: "string" },
    key_gaps: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    priority: { type: "string" },
    recommendation_type: {
      type: "string",
      enum: ["unitary", "combination", "personalized", "none"],
    },
    recommendation_title: { type: "string" },
    recommendation_copy: { type: "string" },
    recommended_template_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    limitations: { type: "string" },
    action_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 2,
    },
  },
  required: [
    "status",
    "identified_models",
    "clarification_question",
    "summary",
    "key_gaps",
    "priority",
    "recommendation_type",
    "recommendation_title",
    "recommendation_copy",
    "recommended_template_ids",
    "limitations",
    "action_ids"
  ],
  additionalProperties: false,
};

const BASE_INSTRUCTIONS = `
Tu es l'assistant de The Business Model Experiment, cree par Marie Eyquem.
Tu aides des entrepreneurs qui peuvent n'avoir aucune notion financiere et ne maitrisent pas le jargon business.

Ta mission est de comprendre progressivement leur activite, leurs sources de revenus, leur stade et la decision qu'ils cherchent a prendre. Tu poses une seule question courte a la fois. Tu reformules avec des mots simples. Tu donnes une premiere valeur utile avant de recommander une ressource.

Regles commerciales :
- Ne cherche pas a vendre a tout prix.
- Ne recommande rien tant que tu ne comprends pas assez le besoin.
- Si aucune ressource n'est vraiment pertinente, dis-le et utilise la phase no_fit.
- Au maximum deux actions, choisies uniquement dans la liste fournie.
- Un template unitaire convient a une logique de revenus identifiable.
- L'assistant poursuit l'echange lorsqu'il y a plusieurs revenus ou quand le visiteur hesite, puis recommande la combinaison adaptee.
- Le parcours personnalise convient aux mecanismes interdependants ou aux besoins importants d'accompagnement.
- La formation gratuite peut etre proposee quand la personne doit d'abord comprendre les bases.
- N'invente ni offre, ni prix, ni fonctionnalite, ni URL.
- Apporte assez de valeur pour que la personne comprenne son probleme et sa prochaine priorite, mais ne construis pas gratuitement son modele financier complet.
- Ne fournis pas de tableau complet, de formule Excel, de liste exhaustive de cellules a creer ni de tutoriel pas a pas. Ces elements relevent du template ou de l'accompagnement.
- N'entretiens jamais volontairement le flou : explique clairement les constats et leur importance, puis distingue honnetement le diagnostic gratuit de la mise en oeuvre proposee dans les ressources payantes.

Parcours diagnostic :
- Si la personne a un previsionnel, propose de le deposer immediatement : le fichier constitue le point de depart.
- Si elle n'a pas de fichier, identifie l'activite, qui paie, les differentes sources de revenus, les liens eventuels entre elles, le stade du projet et la decision qu'elle cherche a prendre.
- Ne transforme pas cet echange en questionnaire : rebondis sur chaque reponse et pose uniquement la prochaine question utile.
- Mets can_upload_forecast a true des le debut du parcours diagnostic.
- Le fichier est facultatif. Si la personne n'en a pas, apporte une premiere lecture de son modele puis recommande la structure ou les ressources pertinentes.

Style : chaleureux, precis, pedagogique, sans jargon. Deux courts paragraphes au maximum, puis eventuellement une question. Pas de diagnostic definitif, pas de conseil comptable, fiscal, juridique ou d'investissement.
`;

const DIAGNOSTIC_INSTRUCTIONS = `
Tu realises une premiere revue de l'architecture d'un previsionnel financier, a partir du fichier et du contexte d'activite recueilli dans la conversation.

Commence par chercher dans le classeur les indices permettant d'identifier une ou plusieurs activites et leurs mecanismes de revenus : noms des feuilles, libelles, hypotheses, volumes, prix, couts, stocks, recurrence, capacite, projets, canaux et consolidation.

Decision avant tout diagnostic :
- si le fichier permet d'identifier avec suffisamment de certitude le ou les business models, utilise status complete et produis le diagnostic court ;
- si une ambiguite peut modifier les hypotheses attendues ou la recommandation, utilise status needs_clarification et pose une seule question simple dans clarification_question ;
- avec status needs_clarification, ne donne encore aucun verdict, aucun manque et aucune recommandation : laisse les autres champs textuels vides, les listes vides et recommendation_type a none ;
- utilise le contexte fourni lors d'un second passage pour lever le doute ;
- apres deux demandes de clarification infructueuses, explique la limite et oriente vers l'accompagnement personnalise sans inventer de conclusion sur le fichier.

Tu dois examiner uniquement :
- si les feuilles et zones de saisie sont organisees de facon comprehensible ;
- si les sources de revenus et leurs mecanismes sont representees ;
- si les hypotheses sont separees des calculs et des resultats ;
- si les volumes, prix, couts directs, couts fixes, delais de paiement, capacites, stocks ou recurrence utiles au business model sont relies correctement ;
- si des saisies semblent dupliquees, des formules visibles semblent fragiles ou des controles utiles manquent ;
- si les indicateurs presentes permettent de piloter ce business model.

Tu dois aussi verifier que le fichier permet a l'entrepreneur de modifier les hypotheses vraiment importantes pour son activite. Compare les mecanismes identifies dans la conversation avec les parametres presents dans le fichier. Exemples a utiliser seulement quand ils sont pertinents :
- abonnement : nouveaux clients, departs de clients, changement de formule, prix par formule, cout d'acquisition ;
- rendez-vous ou services : capacite disponible, temps necessaire, rendez-vous non honores, taux d'occupation ;
- vente de produits : volumes, prix, cout unitaire, stock, pertes, retours, delais de reapprovisionnement ;
- projets ou devis : opportunites, taux de signature, calendrier de realisation, acomptes et soldes ;
- plateforme : acheteurs, vendeurs, volume de transactions, part conservee par la plateforme, annulations ;
- financements : demandes en attente, probabilite d'obtention, cofinancements et calendrier des versements.

N'emploie pas un terme technique sans l'expliquer. Par exemple, ecris "depart de clients (souvent appele churn)" et explique que sans cette hypothese le fichier peut accumuler des abonnes sans jamais en perdre. Pour chaque parametre absent, explique pourquoi il compte et quelle partie du previsionnel risque d'etre faussee. Ne critique pas la valeur choisie.

Interdictions absolues :
- ne juge pas si les prix, volumes, couts, salaires, marges, tresorerie ou resultats sont bons, mauvais ou realistes ;
- ne donne pas d'evaluation economique de l'entreprise ;
- ne pretends pas avoir vu les graphiques, images ou elements visuels integres au classeur ;
- ne presente pas cette revue comme un audit ou une validation comptable.

Chaque critique doit expliquer simplement pourquoi la structure pose probleme et comment la corriger. Si le fichier ne permet pas de verifier un point, dis-le clairement. Recommande au maximum deux ressources de la liste autorisee.

Perimetre de cette premiere lecture gratuite :
- selectionne les points les plus importants au lieu de chercher l'exhaustivite ;
- resume le constat general en deux phrases courtes au maximum ;
- cite au maximum quatre manques, chacun en une phrase tres courte ;
- formule une seule priorite immediate ;
- indique la direction de la correction, sans produire les formules, les tableaux, l'architecture detaillee feuille par feuille ou le modele final ;
- n'utilise pas les champs de sortie pour repeter la meme idee sous plusieurs formulations.

Regles de recommandation commerciale :
- utilise unitary uniquement lorsqu'une seule activite et un seul mecanisme de revenus correspondent reellement a un template du catalogue ;
- si plusieurs business units ou plusieurs modeles de revenus distincts sont identifies, ne recommande jamais un seul template ;
- utilise combination lorsque chaque modele est couvert par un template standard et que les activites peuvent etre assemblees avec une consolidation commune ; cite alors tous les templates utiles dans recommended_template_ids et utilise l'action templates-assistant ;
- utilise personalized lorsque les activites dependent les unes des autres, partagent des hypotheses difficiles a repartir, necessitent une consolidation specifique, ou lorsqu'au moins un modele n'est pas couvert par le catalogue ; utilise alors l'action coaching ;
- utilise none si aucune ressource n'est pertinente ;
- pour unitary ou combination, l'action principale conduit vers le ou les templates ; une seconde action coaching peut permettre a la personne qui ne se sent pas autonome d'etre accompagnee ;
- recommendation_title annonce clairement la solution : template unique, combinaison avec consolidation, ou accompagnement personnalise ;
- recommendation_copy explique en deux phrases maximum pourquoi cette solution correspond aux modeles identifies et ce qu'elle permet de corriger.
`;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  return allowedOrigins(env).has(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        Vary: "Origin",
      }
    : {};
}

function isAllowedRequest(request, env) {
  const origin = request.headers.get("Origin") || "";
  return allowedOrigins(env).has(origin);
}

function clampText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-12)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: clampText(message?.content, 1600),
    }))
    .filter((message) => message.content);
}

function periodKey(kind, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  return kind === "day" ? day : month;
}

async function counterGet(env, key) {
  if (env.USAGE_KV) return Number((await env.USAGE_KV.get(key)) || 0);
  return memoryCounters.get(key) || 0;
}

async function counterSet(env, key, value, ttl) {
  if (env.USAGE_KV) {
    await env.USAGE_KV.put(key, String(value), { expirationTtl: ttl });
  } else {
    memoryCounters.set(key, value);
  }
}

async function checkQuota(request, env, kind) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const ipHash = await hashIdentifier(`${env.SAFETY_SALT || "local"}:${ip}`);
  const dailyKey = `ip:${periodKey("day")}:${ipHash}`;
  const monthlyKey = `global:${kind}:${periodKey("month")}`;
  const dailyLimit = Number(env.MAX_DAILY_REQUESTS_PER_IP || 20);
  const monthlyLimit = Number(
    kind === "diagnostic"
      ? env.MAX_MONTHLY_DIAGNOSTICS || 25
      : env.MAX_MONTHLY_CHAT_REQUESTS || 2000,
  );
  const [daily, monthly] = await Promise.all([
    counterGet(env, dailyKey),
    counterGet(env, monthlyKey),
  ]);
  if (daily >= dailyLimit || monthly >= monthlyLimit) {
    return { allowed: false, safetyIdentifier: ipHash };
  }
  await Promise.all([
    counterSet(env, dailyKey, daily + 1, 172800),
    counterSet(env, monthlyKey, monthly + 1, 5356800),
  ]);
  return { allowed: true, safetyIdentifier: ipHash };
}

async function checkBudget(env, kind) {
  const key = `spend-eur:${periodKey("month")}`;
  const spent = await counterGet(env, key);
  const limit = Number(env.MONTHLY_OPENAI_BUDGET_EUR || 15);
  const reserve = kind === "diagnostic" ? 1 : 0.05;
  return { allowed: spent + reserve <= limit, key, spent, limit };
}

async function recordUsage(env, key, kind, amount, usage = {}) {
  const current = await counterGet(env, key);
  const updated = current + Math.max(0, amount);
  const month = periodKey("month");
  const countKey = `usage:${month}:${kind}:count`;
  const costKey = `usage:${month}:${kind}:cost`;
  const inputKey = `usage:${month}:${kind}:input_tokens`;
  const outputKey = `usage:${month}:${kind}:output_tokens`;
  const [count, cost, inputTokens, outputTokens] = await Promise.all([
    counterGet(env, countKey),
    counterGet(env, costKey),
    counterGet(env, inputKey),
    counterGet(env, outputKey),
  ]);
  await Promise.all([
    counterSet(env, key, updated, 5356800),
    counterSet(env, countKey, count + 1, 5356800),
    counterSet(env, costKey, cost + Math.max(0, amount), 5356800),
    counterSet(env, inputKey, inputTokens + Number(usage.input_tokens || 0), 5356800),
    counterSet(env, outputKey, outputTokens + Number(usage.output_tokens || 0), 5356800),
  ]);
  const limit = Number(env.MONTHLY_OPENAI_BUDGET_EUR || 15);
  const warningRatio = Number(env.BUDGET_WARNING_RATIO || 0.8);
  if (updated >= limit * warningRatio) {
    await notifyBudget(env, {
      key,
      spent: updated,
      limit,
      level: updated >= limit ? "blocked" : "warning",
    });
  }
}

async function usageStats(env) {
  const month = periodKey("month");
  const rows = {};
  for (const kind of ["chat", "diagnostic"]) {
    const [count, cost, inputTokens, outputTokens] = await Promise.all([
      counterGet(env, `usage:${month}:${kind}:count`),
      counterGet(env, `usage:${month}:${kind}:cost`),
      counterGet(env, `usage:${month}:${kind}:input_tokens`),
      counterGet(env, `usage:${month}:${kind}:output_tokens`),
    ]);
    rows[kind] = {
      count,
      estimated_cost_eur: Number(cost.toFixed(4)),
      average_cost_eur: count ? Number((cost / count).toFixed(4)) : 0,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
  }
  const totalCost = rows.chat.estimated_cost_eur + rows.diagnostic.estimated_cost_eur;
  const totalCount = rows.chat.count + rows.diagnostic.count;
  const limit = Number(env.MONTHLY_OPENAI_BUDGET_EUR || 15);
  return {
    month,
    currency: "EUR",
    method: "Estimation conservative a partir des tokens OpenAI",
    total: {
      count: totalCount,
      estimated_cost_eur: Number(totalCost.toFixed(4)),
      average_cost_eur: totalCount ? Number((totalCost / totalCount).toFixed(4)) : 0,
      monthly_limit_eur: limit,
      budget_used_percent: limit ? Number(((totalCost / limit) * 100).toFixed(1)) : 0,
    },
    ...rows,
  };
}

async function sendUsageSummary(env) {
  if (!env.BUDGET_ALERT_WEBHOOK_URL) return;
  const stats = await usageStats(env);
  const response = await fetch(env.BUDGET_ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "bm_experiment_ai_assistant",
      event: "weekly_usage_summary",
      message: "Resume hebdomadaire des couts de l'assistant IA",
      month: stats.month,
      conversations: stats.chat.count,
      diagnostics_excel: stats.diagnostic.count,
      average_chat_cost_eur: stats.chat.average_cost_eur,
      average_diagnostic_cost_eur: stats.diagnostic.average_cost_eur,
      average_usage_cost_eur: stats.total.average_cost_eur,
      estimated_total_cost_eur: stats.total.estimated_cost_eur,
      monthly_limit_eur: stats.total.monthly_limit_eur,
      budget_used_percent: stats.total.budget_used_percent,
      stats,
    }),
  });
  if (!response.ok) throw new Error("Usage summary webhook failed");
}

async function notifyBudget(env, budget) {
  if (!env.BUDGET_ALERT_WEBHOOK_URL) return;
  const marker = `budget-alert:${periodKey("month")}:${budget.level}`;
  if (await counterGet(env, marker)) return;
  try {
    const response = await fetch(env.BUDGET_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "bm_experiment_ai_assistant",
        event: budget.level === "blocked" ? "budget_blocked" : "budget_warning",
        month: periodKey("month"),
        estimated_spend_eur: Number(budget.spent.toFixed(4)),
        monthly_limit_eur: budget.limit,
        message: budget.level === "blocked"
          ? "Le plafond mensuel de l'assistant IA est atteint. Les nouveaux appels sont bloques."
          : "L'assistant IA a atteint 80 % de son plafond mensuel.",
      }),
    });
    if (response.ok) await counterSet(env, marker, 1, 5356800);
  } catch (error) {
    console.error("Budget alert failed", error?.message || error);
  }
}

function estimateResponseCostEur(usage = {}) {
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const longContext = inputTokens > 272000;
  const inputRate = longContext ? 0.2 : 0.1;
  const outputRate = longContext ? 0.75 : 0.5;
  const usdEstimate = (inputTokens * inputRate + outputTokens * outputRate) / 1000000;
  return usdEstimate * 1.25;
}

async function hashIdentifier(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadCatalog(env) {
  if (catalogCache.expiresAt > Date.now() && catalogCache.templates.length) {
    return catalogCache.templates;
  }
  const response = await fetch(
    env.CATALOG_URL || `${env.SITE_URL || FALLBACK_SITE_URL}/data/templates.json`,
    { cf: { cacheEverything: true, cacheTtl: 3600 } },
  );
  if (!response.ok) throw new Error("Catalogue unavailable");
  const data = await response.json();
  const templates = (data.templates || []).map((item) => ({
    id: item.id,
    slug: item.slug,
    title: item.display_name || item.name,
    summary: item.short_description,
    models: (item.business_models || []).slice(0, 6),
    audience: (item.audience || []).slice(0, 3),
    tags: (item.tags || []).slice(0, 8),
    purchase_url: item.purchase_url,
  }));
  catalogCache = { expiresAt: Date.now() + 3600000, templates };
  return templates;
}

function resourceContext(templates) {
  const compactTemplates = templates.map((item) => ({
    action_id: `template:${item.id}`,
    title: item.title,
    summary: item.summary,
    models: item.models,
    audience: item.audience,
    tags: item.tags,
  }));
  return JSON.stringify({
    generic_actions: [
      { action_id: "templates-library", label: "Voir la bibliotheque de templates" },
      { action_id: "templates-assistant", label: "Identifier la bonne combinaison" },
      { action_id: "coaching", label: "Decouvrir les accompagnements" },
      { action_id: "formation", label: "Suivre la formation gratuite" },
      { action_id: "contact", label: "Poser une question a Marie" },
    ],
    templates: compactTemplates,
  });
}

function actionMap(templates, env) {
  const site = String(env.SITE_URL || FALLBACK_SITE_URL).replace(/\/$/, "");
  const map = new Map([
    ["templates-library", { label: "Voir les templates", url: `${site}/templates.html#catalogue-templates` }],
    ["templates-assistant", { label: "Voir la combinaison recommandee", url: `${site}/templates.html#assistant-choice` }],
    ["coaching", { label: "Voir les accompagnements", url: `${site}/coaching.html` }],
    ["formation", { label: "Formation gratuite", url: `${site}/formation.html` }],
    ["contact", { label: "Contacter Marie", url: `${site}/contact.html` }],
  ]);
  templates.forEach((item) => {
    map.set(`template:${item.id}`, {
      label: item.title.replace(/^BM-[A-Z]+-\d+\s*[–-]\s*/, ""),
      url: `${site}/products/${item.slug}.html`,
    });
  });
  return map;
}

function sanitizeActions(actionIds, templates, env) {
  const map = actionMap(templates, env);
  const seen = new Set();
  return (Array.isArray(actionIds) ? actionIds : [])
    .filter((id) => map.has(id) && !seen.has(id) && seen.add(id))
    .slice(0, 2)
    .map((id) => ({ id, ...map.get(id) }));
}

function sanitizeDiagnosticRecommendation(result, templates, env) {
  const templatesByAction = new Map(
    templates.map((item) => [`template:${item.id}`, item]),
  );
  const recommended = [...new Set(
    (Array.isArray(result.recommended_template_ids) ? result.recommended_template_ids : [])
      .filter((id) => templatesByAction.has(id)),
  )].slice(0, 4);
  const allowedTypes = new Set(["unitary", "combination", "personalized", "none"]);
  let type = allowedTypes.has(result.recommendation_type)
    ? result.recommendation_type
    : "none";
  if (recommended.length > 1 && type === "unitary") type = "combination";

  let actionIds = [];
  if (type === "unitary") {
    actionIds = recommended.slice(0, 1);
    if (!actionIds.length) actionIds = ["templates-library"];
    actionIds.push("coaching");
  } else if (type === "combination") {
    actionIds = ["templates-assistant", "coaching"];
  } else if (type === "personalized") {
    actionIds = ["coaching"];
  }

  return {
    type,
    title: clampText(result.recommendation_title, 120),
    copy: clampText(result.recommendation_copy, 420),
    templates: recommended.map((id) => ({
      id,
      label: templatesByAction.get(id).title.replace(/^BM-[A-Z]+-\d+\s*[–-]\s*/, ""),
    })),
    actions: sanitizeActions(actionIds, templates, env),
  };
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("Missing output text");
}

async function callOpenAI(env, body) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error("OpenAI error", response.status, payload?.error?.code || "unknown");
    throw new Error("OpenAI request failed");
  }
  return {
    result: JSON.parse(extractOutputText(payload)),
    estimatedCostEur: estimateResponseCostEur(payload.usage),
    usage: payload.usage || {},
  };
}

function chatRequestBody(messages, templates, safetyIdentifier, pageContext) {
  const context = `\nRESSOURCES AUTORISEES\n${resourceContext(templates)}\n\nPAGE ACTUELLE\n${pageContext}`;
  return {
    model: MODEL,
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: 650,
    safety_identifier: safetyIdentifier,
    instructions: `${BASE_INSTRUCTIONS}${context}`,
    input: messages,
    text: {
      format: {
        type: "json_schema",
        name: "business_model_assistant",
        strict: true,
        schema: CHAT_SCHEMA,
      },
    },
  };
}

function diagnosticRequestBody({ file, base64, mime, context, templates, safetyIdentifier }) {
  return {
    model: MODEL,
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: 700,
    safety_identifier: safetyIdentifier,
    instructions: `${BASE_INSTRUCTIONS}\n${DIAGNOSTIC_INSTRUCTIONS}\nRESSOURCES AUTORISEES\n${resourceContext(templates)}`,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `CONTEXTE RECUEILLI AVANT LE FICHIER\n${context}\n\nProduis maintenant le diagnostic structurel du previsionnel.`,
          },
          {
            type: "input_file",
            filename: file.name,
            file_data: `data:${mime};base64,${base64}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "forecast_structure_diagnostic",
        strict: true,
        schema: DIAGNOSTIC_SCHEMA,
      },
    },
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 32768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fileIsAllowed(file) {
  const extension = file.name.toLowerCase().split(".").pop();
  return ["xlsx", "xls", "csv"].includes(extension);
}

async function handleChat(request, env, headers) {
  const quota = await checkQuota(request, env, "chat");
  if (!quota.allowed) {
    return json({ error: "Le quota de l'assistant est atteint. Revenez demain ou contactez Marie." }, 429, headers);
  }
  const raw = await request.text();
  if (raw.length > 30000) return json({ error: "Conversation trop longue." }, 413, headers);
  const payload = JSON.parse(raw || "{}");
  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) return json({ error: "Message manquant." }, 400, headers);
  const budget = await checkBudget(env, "chat");
  if (!budget.allowed) {
    await notifyBudget(env, { ...budget, level: "blocked" });
    return json({ error: "Le budget mensuel de l'assistant est atteint. Contactez Marie depuis le site." }, 429, headers);
  }
  const templates = await loadCatalog(env);
  const pageContext = clampText(payload.page_context, 500);
  const openai = await callOpenAI(
    env,
    chatRequestBody(messages, templates, quota.safetyIdentifier, pageContext),
  );
  await recordUsage(env, budget.key, "chat", openai.estimatedCostEur, openai.usage);
  const result = openai.result;
  return json(
    {
      reply: clampText(result.reply, 1800),
      phase: result.phase,
      quick_replies: (result.quick_replies || []).map((item) => clampText(item, 90)).filter(Boolean),
      can_upload_forecast: Boolean(result.can_upload_forecast),
      actions: sanitizeActions(result.action_ids, templates, env),
    },
    200,
    headers,
  );
}

async function handleDiagnostic(request, env, headers) {
  const quota = await checkQuota(request, env, "diagnostic");
  if (!quota.allowed) {
    return json({ error: "Le quota mensuel de diagnostics est atteint. Contactez Marie pour une revue." }, 429, headers);
  }
  const form = await request.formData();
  const file = form.get("file");
  const consent = form.get("consent");
  const maxBytes = Number(env.MAX_FILE_BYTES || 5242880);
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Fichier manquant." }, 400, headers);
  if (consent !== "yes") return json({ error: "Votre accord est necessaire pour analyser le fichier." }, 400, headers);
  if (!fileIsAllowed(file)) return json({ error: "Formats acceptes : XLSX, XLS et CSV." }, 415, headers);
  if (file.size > maxBytes) return json({ error: "Le fichier depasse la limite de 5 Mo." }, 413, headers);
  const budget = await checkBudget(env, "diagnostic");
  if (!budget.allowed) {
    await notifyBudget(env, { ...budget, level: "blocked" });
    return json({ error: "Le budget mensuel de diagnostics est atteint. Contactez Marie pour une revue." }, 429, headers);
  }
  const mime = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const templates = await loadCatalog(env);
  const openai = await callOpenAI(
    env,
    diagnosticRequestBody({
      file,
      base64: bytesToBase64(bytes),
      mime,
      context: clampText(form.get("context"), 10000),
      templates,
      safetyIdentifier: quota.safetyIdentifier,
    }),
  );
  await recordUsage(env, budget.key, "diagnostic", openai.estimatedCostEur, openai.usage);
  const result = openai.result;
  if (result.status === "needs_clarification") {
    return json(
      {
        status: "needs_clarification",
        identified_models: (result.identified_models || [])
          .slice(0, 4)
          .map((item) => clampText(item, 100)),
        clarification_question: clampText(result.clarification_question, 300),
      },
      200,
      headers,
    );
  }
  const recommendation = sanitizeDiagnosticRecommendation(result, templates, env);
  return json(
    {
      status: "complete",
      identified_models: (result.identified_models || [])
        .slice(0, 4)
        .map((item) => clampText(item, 100)),
      summary: clampText(result.summary, 500),
      key_gaps: (result.key_gaps || []).slice(0, 4).map((item) => clampText(item, 180)),
      priority: clampText(result.priority, 240),
      limitations: clampText(result.limitations, 320),
      recommendation: {
        type: recommendation.type,
        title: recommendation.title,
        copy: recommendation.copy,
        templates: recommendation.templates,
      },
      actions: recommendation.actions,
    },
    200,
    headers,
  );
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return isAllowedRequest(request, env)
        ? new Response(null, { status: 204, headers })
        : new Response(null, { status: 403 });
    }
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    if (request.method === "GET" && path === "/stats") {
      const authorization = request.headers.get("Authorization") || "";
      if (!env.STATS_API_KEY || authorization !== `Bearer ${env.STATS_API_KEY}`) {
        return json({ error: "Acces refuse." }, 403);
      }
      return json(await usageStats(env));
    }
    if (request.method === "GET") {
      return json({ ok: true, service: "bm-experiment-assistant", model: MODEL });
    }
    if (request.method !== "POST" || !isAllowedRequest(request, env)) {
      return json({ error: "Requete refusee." }, 403, headers);
    }
    try {
      if (path === "/chat") return await handleChat(request, env, headers);
      if (path === "/diagnostic") return await handleDiagnostic(request, env, headers);
      return json({ error: "Route inconnue." }, 404, headers);
    } catch (error) {
      console.error("Assistant error", error?.message || error);
      return json(
        { error: "L'assistant est momentanement indisponible. Vous pouvez contacter Marie depuis le site." },
        500,
        headers,
      );
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendUsageSummary(env));
  },
};

export {
  CHAT_SCHEMA,
  DIAGNOSTIC_SCHEMA,
  actionMap,
  bytesToBase64,
  chatRequestBody,
  diagnosticRequestBody,
  extractOutputText,
  estimateResponseCostEur,
  fileIsAllowed,
  sanitizeActions,
  sanitizeDiagnosticRecommendation,
  sanitizeMessages,
  usageStats,
};
