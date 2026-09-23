# Assistant IA commercial - note d'implementation

## Architecture detectee

- Site statique en HTML, CSS et JavaScript, sans framework ni CMS.
- Hebergement par GitHub Pages sur `the-business-model-experiment.com`.
- Catalogue de 24 templates dans `data/templates.json`, avec une fiche HTML par produit.
- Paiement par liens Stripe, prise de rendez-vous par Calendly et automatisations existantes via Make.
- Formulaire de contact avec repli vers un email pre-rempli ; aucun outil d'analytics n'est actuellement charge par le site.
- Charte existante : fond clair, violet `#7c3aed`, violet fonce `#5b21b6`, vert canard `#0f766e`, composants sobres a faible rayon de bordure.

## Solution retenue

L'assistant est compose de deux parties :

1. un widget JavaScript leger, ajoute sur toutes les pages du site ;
2. une API Cloudflare Worker qui appelle directement la Responses API OpenAI avec `gpt-6-luna`.

Cette architecture conserve GitHub Pages, protege la cle OpenAI cote serveur et n'ajoute ni SaaS de chatbot, ni base vectorielle, ni base de donnees. La conversation reste dans la session du navigateur et seules les dernieres interventions utiles sont envoyees a l'API.

Le parcours propose d'abord le depot du previsionnel, sans questionnaire prealable. L'assistant cherche a reconnaitre les activites et mecanismes de revenus a partir du fichier. Il conclut directement lorsque les indices sont suffisants ; sinon, il pose une seule question simple avant de rendre son diagnostic. Sans fichier, il conduit un echange progressif. Il peut ensuite proposer au maximum deux actions provenant du site : fiche template, combinaison de templates, formation, coaching ou contact. Il peut aussi conclure qu'aucune offre n'est pertinente.

La page Templates ne contient plus l'ancien questionnaire a cases. Elle conserve la bibliotheque pour les achats directs et utilise l'assistant comme parcours principal d'orientation, avec deux entrees explicites : analyse d'un fichier ou conversation sans fichier.

Le point d'entree principal est `Diagnostic de mon modele et de mon previsionnel`. Si le visiteur possede un fichier Excel ou CSV, il peut l'envoyer immediatement. S'il n'en possede pas, la conversation caracterise son activite et aboutit a une recommandation de structure, de templates ou d'accompagnement.

Quand un fichier est fourni, le diagnostic porte uniquement sur son architecture : organisation des feuilles, circulation des hypotheses, couverture des mecanismes du business model, saisies dupliquees, formules visibles, controles et indicateurs utiles. Il verifie notamment que l'utilisateur peut modifier les leviers propres a son activite : departs de clients pour un abonnement, capacite pour une activite sur rendez-vous, stocks pour la vente de produits, delais d'encaissement, taux de conversion, retours ou impayes lorsque ces mecanismes sont pertinents. Chaque manque retenu est explique avec des mots simples et sa consequence concrete sur le previsionnel. Il n'evalue pas la performance economique, ne juge pas si les montants sont realistes et ne valide pas les chiffres. Il est presente comme une premiere revue pedagogique et non comme un audit comptable.

Cette premiere lecture doit creer un declic sans remplacer l'offre payante. Elle resume le constat en deux phrases, selectionne au maximum quatre manques et formule une priorite. Elle indique la direction a suivre, mais ne fournit ni modele complet, ni formules Excel, ni architecture detaillee feuille par feuille, ni mode d'emploi cellule par cellule.

La recommandation est affichee dans un bloc distinct et choisit entre quatre sorties : template unitaire, combinaison standard avec consolidation, parcours personnalise ou aucune offre. Plusieurs business units ne peuvent jamais conduire a un template unique. La combinaison est retenue seulement si chaque modele est couvert par la bibliotheque et si les activites peuvent etre consolidees sans logique sur mesure. Les interdependances, hypotheses partagees difficiles a repartir, consolidations specifiques ou modeles absents du catalogue orientent vers l'accompagnement personnalise.

## Maitrise des couts

- Modele : `gpt-6-luna` via `POST /v1/responses`.
- Raisonnement desactive, reponse courte et structuree, huit messages utilisateur maximum par session.
- Historique borne, taille des messages limitee et catalogue compact.
- Aucune recherche web, aucun outil OpenAI payant et aucun stockage de conversation.
- Limitation cote API par adresse IP et par periode ; liste stricte des domaines autorises.
- Possibilite de definir un plafond quotidien de requetes dans la configuration du Worker.
- Quota mensuel distinct pour les diagnostics de fichiers, plus couteux que la conversation seule.
- Fichiers limites a 5 Mo et un seul diagnostic par session navigateur.
- Coupe-circuit applicatif fixe a 15 EUR estimes par mois : une marge est reservee avant chaque appel, puis le cout est comptabilise a partir des tokens reellement consommes avec un coefficient de securite.
- Alerte Make facultative a 80 % puis au blocage. Le webhook peut envoyer un email a Marie et ne recoit que le niveau de depense estime, jamais les conversations ni les fichiers.
- Resume hebdomadaire Make : nombre et cout estime total/moyen des conversations et des diagnostics, tokens consommes et pourcentage du plafond. Une route `/stats` protegee permet aussi une consultation a la demande.

Avec 200 visiteurs mensuels, 20 % d'utilisation et quatre echanges par conversation, l'ordre de grandeur attendu reste de quelques centimes a quelques dizaines de centimes par mois. Meme une utilisation beaucoup plus forte reste normalement sous l'objectif de 2 EUR, sous reserve des tarifs OpenAI en vigueur et du respect des plafonds configures.

## Fichiers concernes

- `assistant-widget.js` : interface, etat de conversation, accessibilite et appels API.
- `assistant-widget.css` : presentation responsive selon la charte existante.
- `worker/src/index.js` : API securisee, prompt, catalogue compact, controles et appel OpenAI.
- `worker/wrangler.toml` : configuration de deploiement Cloudflare.
- `worker/package.json` : commandes de test et de deploiement.
- `worker/test/worker.test.mjs` : tests unitaires sans appel payant a OpenAI.
- pages HTML : chargement du widget sur les pages principales et les fiches produit.
- `README.md` : procedure de configuration et de deploiement.

## Choix techniques et limites

- La cle `OPENAI_API_KEY` est un secret Cloudflare et ne doit jamais etre placee dans le depot ou dans le navigateur.
- Le widget fonctionne uniquement apres deploiement du Worker et renseignement de son URL publique dans `assistant-widget.js`.
- La limitation en memoire du Worker constitue une premiere barriere economique. Pour une garantie plus forte en cas d'attaque distribuee, il faudra activer Cloudflare Turnstile ou une regle de limitation Cloudflare ; ces options peuvent rester gratuites mais demandent une configuration dans le compte Cloudflare.
- En production, un espace KV Cloudflare est recommande pour appliquer les plafonds de requetes entre toutes les instances du Worker.
- Le projet OpenAI dedie a cet assistant doit aussi recevoir un plafond de depenses strict a 15 USD lorsqu'il est disponible dans les reglages du compte. Cette seconde barriere reste independante du coupe-circuit du Worker.
- Le plafond applicatif se modifie dans la variable Cloudflare `MONTHLY_OPENAI_BUDGET_EUR`, sans changement du site. Une nouvelle valeur prend effet au prochain deploiement ou apres modification directe dans les variables du Worker.
- Le visiteur doit consentir explicitement avant l'envoi d'un fichier. Le site precise que les donnees sont transmises a OpenAI pour produire le diagnostic et peuvent apparaitre dans les journaux de controle d'abus pendant la duree prevue par les conditions de l'API.
- L'analyse native d'un tableur ne restitue pas les graphiques et images integres. Le diagnostic ne doit donc pas affirmer les avoir examines.
- Les instructions interdisent au modele de donner un avis sur le niveau des prix, volumes, couts, marges ou resultats. Il peut uniquement signaler qu'une hypothese manque, qu'une unite est incoherente, qu'une formule semble fragile ou qu'un mecanisme du modele n'est pas represente.
- Le site ne disposant pas encore d'analytics, le widget emet des evenements JavaScript (`bm-assistant:*`) sans envoyer de donnees a un tiers. Ils pourront etre raccordes plus tard a un outil d'analytics choisi.

## Cout potentiel

- GitHub Pages : 0 EUR dans l'architecture actuelle.
- Cloudflare Workers : 0 EUR attendu dans la limite du forfait gratuit.
- OpenAI : facturation aux tokens de `gpt-6-luna`; objectif technique inferieur a 2 EUR par mois pour environ 200 visiteurs, avec plafond d'usage configure.
- Aucun autre service payant requis.
