# The Business Model Experiment

Site statique pour présenter la formation, les templates Google Sheets et les offres de coaching autour du business model et de la modélisation financière simple.

## Structure

- `index.html` : accueil
- `formation.html` : parcours gratuit
- `templates.html` : page de vente des templates
- `coaching.html` : offres de coaching
- `styles.css` : design responsive

## Tester localement

Ouvrir `index.html` dans un navigateur.

Pour GitHub Pages, déposer tout le contenu du dossier dans un dépôt GitHub puis activer Pages sur la branche principale.

## Assistant IA et diagnostic de prévisionnel

Le site inclut un assistant qui propose d'abord de déposer le prévisionnel, sans questionnaire préalable. Il cherche dans le fichier les indices permettant d'identifier une ou plusieurs activités et leurs mécanismes de revenus. S'il peut les reconnaître avec assez de certitude, il produit directement le diagnostic court. Si une ambiguïté change l'analyse attendue, il pose une seule question simple avant de conclure. Sans fichier, il poursuit la caractérisation conversationnelle du business model. Le visiteur peut ainsi :

- recevoir une première lecture de son modèle économique ;
- être orienté vers un template, le guide, une formation ou un accompagnement ;
- transmettre facultativement un fichier XLSX, XLS ou CSV pour examiner l'architecture de son prévisionnel.

Le diagnostic du fichier porte sur la structure, les hypothèses modifiables, les formules visibles, les doubles saisies, les contrôles et les indicateurs utiles. Il ne juge pas les montants et ne constitue pas une validation comptable. Cette première lecture gratuite résume le constat en deux phrases, cite au maximum quatre manques et donne une seule priorité. Elle ne livre ni modèle complet, ni formules Excel, ni procédure de correction cellule par cellule.

La recommandation distingue ensuite un template unique, une combinaison de templates avec consolidation, ou un accompagnement personnalisé. Plusieurs business units ne peuvent pas conduire à la recommandation d'un seul template : la combinaison standard est proposée lorsque les activités sont indépendantes et couvertes par la bibliothèque ; le parcours personnalisé est proposé lorsqu'elles sont interdépendantes, que la consolidation est spécifique ou qu'un modèle manque au catalogue. Lorsqu'un template standard convient, un second accès à l'accompagnement reste visible pour les personnes qui ne souhaitent pas avancer seules.

La partie visible est dans `assistant-widget.js` et `assistant-widget.css`. La clé OpenAI reste dans le Worker Cloudflare situé dans `worker/` ; elle ne doit jamais être ajoutée au HTML ou au JavaScript public.

### Faire un test local avec un vrai Excel

1. Créer un projet dédié dans la plateforme OpenAI et une clé API de test.
2. Dans `worker/`, dupliquer `.dev.vars.example` sous le nom `.dev.vars`.
3. Remplacer la valeur de `OPENAI_API_KEY` dans `.dev.vars`. Ce fichier est ignoré par Git.
4. Installer puis lancer l'API locale :

   ```bash
   cd worker
   npm install
   npm run dev
   ```

5. Dans un second terminal, lancer le site depuis la racine du dépôt :

   ```bash
   python3 -m http.server 8080
   ```

6. Ouvrir `http://localhost:8080`, cliquer sur `Faire mon diagnostic gratuit`, répondre aux questions, puis choisir un fichier de moins de 5 Mo.

En local, le widget détecte automatiquement l'API sur `http://localhost:8787`. Le fichier est transmis directement à la Responses API avec `store: false`. Il n'est pas écrit sur le disque par le Worker.

### Maîtrise du budget

Les variables principales sont dans `worker/wrangler.toml` :

- `MONTHLY_OPENAI_BUDGET_EUR` : plafond applicatif mensuel, 15 EUR par défaut ;
- `BUDGET_WARNING_RATIO` : alerte à 80 % par défaut ;
- `MAX_MONTHLY_CHAT_REQUESTS` : plafond mensuel des échanges ;
- `MAX_MONTHLY_DIAGNOSTICS` : plafond mensuel des analyses de fichiers ;
- `MAX_FILE_BYTES` : taille maximale d'un fichier.

Pour recevoir les alertes, créer un webhook Make qui envoie un email, puis enregistrer son URL dans le secret `BUDGET_ALERT_WEBHOOK_URL`. Le webhook reçoit uniquement le niveau de dépense estimé et le plafond, jamais les conversations ou les fichiers.

Le même webhook reçoit chaque lundi un résumé : nombre de conversations, nombre de diagnostics, coût estimé total, coût moyen d'une conversation, coût moyen d'un diagnostic Excel, coût moyen global par usage, tokens et pourcentage du plafond. Les champs directs utiles dans Make sont `average_chat_cost_eur`, `average_diagnostic_cost_eur`, `average_usage_cost_eur`, `estimated_total_cost_eur` et `budget_used_percent`. Les coûts sont des estimations conservatrices calculées à partir des tokens ; la facture OpenAI reste la référence définitive.

Une route privée `/stats` permet aussi de consulter les chiffres du mois. Elle exige le secret `STATS_API_KEY` dans l'en-tête `Authorization`.

Créer aussi un projet OpenAI réservé au site et activer, si le compte le propose, un plafond de dépenses strict. Le plafond OpenAI et le coupe-circuit du Worker constituent deux protections indépendantes.

### Déployer l'API

Depuis `worker/` :

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SAFETY_SALT
npx wrangler secret put BUDGET_ALERT_WEBHOOK_URL
npx wrangler secret put STATS_API_KEY
npm run deploy
```

Créer un espace KV Cloudflare pour fiabiliser les quotas entre toutes les instances du Worker, renseigner son identifiant dans `wrangler.toml`, puis déployer. Enfin, reporter l'URL `workers.dev` obtenue dans la constante d'endpoint de `assistant-widget.js` avant la publication GitHub Pages.
