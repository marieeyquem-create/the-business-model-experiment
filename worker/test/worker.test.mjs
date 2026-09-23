import test from "node:test";
import assert from "node:assert/strict";

import {
  actionMap,
  chatRequestBody,
  diagnosticRequestBody,
  estimateResponseCostEur,
  extractOutputText,
  fileIsAllowed,
  sanitizeActions,
  sanitizeDiagnosticRecommendation,
  sanitizeMessages,
  usageStats,
} from "../src/index.js";
import worker from "../src/index.js";

const templates = [
  {
    id: "BM-RDV-001",
    slug: "cabinet-activite-rendez-vous",
    title: "Cabinet / activite sur rendez-vous",
  },
];
const env = { SITE_URL: "https://the-business-model-experiment.com" };

test("sanitizeMessages limite les roles, la longueur et l'historique", () => {
  const input = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 ? "assistant" : "admin",
    content: ` message ${index} `,
  }));
  const result = sanitizeMessages(input);
  assert.equal(result.length, 12);
  assert.equal(result[0].role, "user");
  assert.equal(result.at(-1).content, "message 13");
});

test("les actions inconnues et dupliquees sont supprimees", () => {
  const result = sanitizeActions(
    ["template:BM-RDV-001", "https://example.com", "template:BM-RDV-001", "contact"],
    templates,
    env,
  );
  assert.deepEqual(result.map((item) => item.id), ["template:BM-RDV-001", "contact"]);
  assert.match(result[0].url, /products\/cabinet-activite-rendez-vous\.html$/);
});

test("la carte de ressources ne contient que les URLs du site", () => {
  const map = actionMap(templates, env);
  assert.equal(map.get("coaching").url, "https://the-business-model-experiment.com/coaching.html");
});

test("le corps OpenAI utilise Luna, Responses stateless et structured outputs", () => {
  const body = chatRequestBody(
    [{ role: "user", content: "Je lance un cabinet." }],
    templates,
    "safe-id",
    "/index.html",
  );
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, "none");
  assert.equal(body.text.format.type, "json_schema");
});

test("le diagnostic donne des priorites sans livrer gratuitement le modele complet", () => {
  const body = diagnosticRequestBody({
    file: { name: "previsionnel.xlsx" },
    base64: "UEsDBA==",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    context: "Activite avec abonnement",
    templates,
    safetyIdentifier: "safe-id",
  });
  assert.equal(body.max_output_tokens, 700);
  assert.deepEqual(
    body.text.format.schema.properties.status.enum,
    ["complete", "needs_clarification"],
  );
  assert.equal(body.text.format.schema.properties.key_gaps.maxItems, 4);
  assert.deepEqual(
    body.text.format.schema.properties.recommendation_type.enum,
    ["unitary", "combination", "personalized", "none"],
  );
  assert.match(body.instructions, /ne fournis pas de tableau complet/i);
  assert.match(body.instructions, /ne recommande jamais un seul template/i);
});

test("plusieurs templates produisent une combinaison et non une fiche unique", () => {
  const catalog = [
    ...templates,
    { id: "BM-SUB-001", slug: "abonnement-simple", title: "Abonnements multi-offres" },
  ];
  const recommendation = sanitizeDiagnosticRecommendation({
    recommendation_type: "unitary",
    recommendation_title: "Combinaison recommandee",
    recommendation_copy: "Deux activites doivent etre consolidees.",
    recommended_template_ids: ["template:BM-RDV-001", "template:BM-SUB-001"],
  }, catalog, env);
  assert.equal(recommendation.type, "combination");
  assert.deepEqual(recommendation.templates.map((item) => item.id), [
    "template:BM-RDV-001",
    "template:BM-SUB-001",
  ]);
  assert.deepEqual(recommendation.actions.map((item) => item.id), ["templates-assistant", "coaching"]);
});

test("une consolidation specifique oriente vers l'accompagnement", () => {
  const recommendation = sanitizeDiagnosticRecommendation({
    recommendation_type: "personalized",
    recommendation_title: "Modele personnalise",
    recommendation_copy: "Les activites sont interdependantes.",
    recommended_template_ids: [],
  }, templates, env);
  assert.deepEqual(recommendation.actions.map((item) => item.id), ["coaching"]);
});

test("extractOutputText accepte les deux formes Responses", () => {
  assert.equal(extractOutputText({ output_text: "{\"ok\":true}" }), "{\"ok\":true}");
  assert.equal(
    extractOutputText({ output: [{ content: [{ type: "output_text", text: "hello" }] }] }),
    "hello",
  );
});

test("seuls les formats de previsionnel prevus sont acceptes", () => {
  assert.equal(fileIsAllowed({ name: "previsionnel.xlsx" }), true);
  assert.equal(fileIsAllowed({ name: "budget.CSV" }), true);
  assert.equal(fileIsAllowed({ name: "document.pdf" }), false);
});

test("le cout est estime de facon conservatrice", () => {
  const cost = estimateResponseCostEur({ input_tokens: 1000000, output_tokens: 1000 });
  assert.ok(cost > 0.25);
  assert.ok(cost < 1);
});

test("les statistiques distinguent le cout moyen des conversations et diagnostics", async () => {
  const values = new Map([
    ["usage:2026-09:chat:count", "4"],
    ["usage:2026-09:chat:cost", "0.08"],
    ["usage:2026-09:chat:input_tokens", "4000"],
    ["usage:2026-09:chat:output_tokens", "800"],
    ["usage:2026-09:diagnostic:count", "2"],
    ["usage:2026-09:diagnostic:cost", "0.60"],
    ["usage:2026-09:diagnostic:input_tokens", "12000"],
    ["usage:2026-09:diagnostic:output_tokens", "2000"],
  ]);
  const stats = await usageStats({
    MONTHLY_OPENAI_BUDGET_EUR: "15",
    USAGE_KV: { get: async (key) => values.get(key) || null },
  });
  assert.equal(stats.chat.average_cost_eur, 0.02);
  assert.equal(stats.diagnostic.average_cost_eur, 0.3);
  assert.equal(stats.total.average_cost_eur, 0.1133);
  assert.equal(stats.total.budget_used_percent, 4.5);
});

test("le Worker traite une conversation et filtre la recommandation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("templates.json")) {
      return Response.json({
        templates: [{
          id: "BM-RDV-001",
          slug: "cabinet-activite-rendez-vous",
          display_name: "Cabinet / activite sur rendez-vous",
          short_description: "Modele de rendez-vous",
          business_models: ["rendez-vous"],
          audience: ["Praticiens"],
          tags: ["kine"],
        }],
      });
    }
    return Response.json({
      output_text: JSON.stringify({
        reply: "Votre capacite de rendez-vous est un parametre important.",
        phase: "first_value",
        quick_replies: ["Je travaille seul"],
        action_ids: ["template:BM-RDV-001", "https://site-invente.test"],
        can_upload_forecast: true,
      }),
      usage: { input_tokens: 1200, output_tokens: 90 },
    });
  };
  try {
    const request = new Request("https://worker.test/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:8080" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Je suis kine." }] }),
    });
    const response = await worker.fetch(request, {
      OPENAI_API_KEY: "test",
      ALLOWED_ORIGINS: "http://localhost:8080",
      SITE_URL: "https://the-business-model-experiment.com",
      CATALOG_URL: "https://site.test/templates.json",
      SAFETY_SALT: "test-salt",
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.can_upload_forecast, true);
    assert.deepEqual(data.actions.map((item) => item.id), ["template:BM-RDV-001"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
