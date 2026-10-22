# FlaskGPT — conversations, sources et analyse des données

Version complète à partir des trois fichiers fournis. Les originaux dans Téléchargements restent intacts.

## Lancer sous Windows

Python 3.11 ou plus récent est nécessaire. Ouvrir PowerShell dans ce dossier :

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Renseigner `GROQ_API_KEY` dans `.env`, puis :

```powershell
.\.venv\Scripts\python.exe app.py
```

Ouvrir http://127.0.0.1:5000. Le modèle initial reste `openai/gpt-oss-20b`, comme dans votre application. Sa disponibilité dépend du compte Groq ; modifier `AI_MODEL` si nécessaire. Pour un autre fournisseur compatible Chat Completions, configurer `AI_BASE_URL`, `AI_MODEL` et la clé correspondante (la variable `OPENAI_API_KEY` est également acceptée). Le fournisseur doit accepter `stream_options.include_usage` ; les tokens absents restent marqués « n.d. ».

## Fonctionnalités

1. **Conversations** : création, historique persistant et suppression définitive de la conversation courante. « Nouvelle conversation » conserve l’ancienne ; « Effacer et recommencer » supprime ses messages, sources, mesures et notes.
2. **Domaines** : généraliste, informatique, finance, analyse de données et spécialité libre. Cliquer sur « Appliquer le domaine » ; le domaine s’applique aux prochaines réponses.
3. **SQLite** : conversations, messages avec rôles explicites, sources, rapports, évaluations et requêtes stockés dans `instance/chat.sqlite3`.
4. **Erreurs** : clé absente/invalide, quota, délai dépassé, connexion, refus fournisseur, fichier invalide. Les erreurs de flux s’affichent dans un bandeau et ne polluent pas l’historique. Le texte saisi reste disponible pour réessayer.
5. **Résumé PDF** : résumé généré par le modèle à partir de la conversation, avec sa consommation enregistrée séparément.
6. **Exports** : TXT, PDF et JSON. Les exports comprennent les messages, les passages transmis, les notes et les mesures ; JSON comprend également les rapports. Les fichiers sources complets ne sont pas inclus dans les exports.
7. **Données** : import SQLite ou CSV UTF-8 ; comptage des manquants, doublons exacts, complétude, unicité, types numériques mixtes et anomalies IQR. SQLite : vérification des clés étrangères et contraintes NOT NULL déclarées. Règles métier configurables par colonne : `required`, `min`, `max`, `allowed`. Une colonne absente est signalée pour chaque table. Une valeur facultative vide est ignorée par les bornes et la liste autorisée.
8. **Performances** : temps total, délai du premier fragment, tokens d’entrée/sortie/total et modèle par requête, moyenne des requêtes réussies, total des tokens connus. Les échecs et résumés sont également suivis. Les tokens non communiqués ne sont jamais estimés comme zéro.
9. **Évaluations** : notes utilisateur persistantes 1/3 rouge, 2/3 ambre et 3/3 vert, avec libellés accessibles. Ces notes permettent un suivi ; elles ne réentraînent pas automatiquement le modèle.
10. **Sources** : import TXT/Markdown en plus des données, cases à cocher, nombre et unité des passages. Classement simple par mots communs à la question. Les citations reconnues renvoient aux passages exacts archivés avec la réponse. Les passages transmis sont distingués des citations effectivement écrites par le modèle. Aucun moteur de recherche Web n’est intégré ; les références inventées ne reçoivent pas de lien vérifiable.

## Données et limites de l’analyse

- Fichier : 10 Mo maximum. CSV : en-têtes uniques, 100 colonnes, 10 000 lignes maximum. SQLite : tables ordinaires uniquement, 20 tables, 100 colonnes/table, 10 000 lignes/table, 20 000 lignes au total ; délai d’inspection limité à 8 secondes. Les imports dépassant ces seuils sont rejetés, sans produire un rapport présenté comme complet.
- Lecture SQLite en mode immuable, sans modification du fichier importé. Les valeurs BLOB sont représentées en hexadécimal. Les fichiers SQLite doivent être autonomes : effectuer un checkpoint avant export si le fichier utilise un journal WAL.
- Complétude = cellules non vides / cellules. Unicité = lignes distinctes / lignes. Les cellules vides ou composées d’espaces comptent comme manquantes. Les doublons sont calculés sur les lignes entières, sans normalisation métier.
- Types mixtes : valeurs non numériques dans une colonne dont au moins 80 % des valeurs renseignées sont numériques. Anomalies : valeurs hors de l’intervalle Q1 − 1,5 IQR / Q3 + 1,5 IQR ; si IQR = 0, les valeurs différentes de Q1 sont signalées. Ce sont des alertes à examiner, pas des erreurs certaines.
- Les détails fournissent jusqu’à 20 exemples de numéros de lignes par anomalie/colonne et pour les doublons. Ces numéros correspondent aux lignes de données de chaque table dans l’ordre lu (en-tête CSV exclu), pas à une clé primaire métier.
- La conformité réglementaire, la sémantique métier et la sensibilité des données nécessitent un référentiel et une revue humaine. Les contrôles fournis couvrent les contraintes déclarées et les règles configurées, sans certification réglementaire.
- Les sources sélectionnées et leurs indicateurs sont transmis au fournisseur IA. Désélectionner une source empêche son ajout au prochain contexte ; les réponses historiques peuvent déjà en contenir des informations. Créer une nouvelle conversation pour repartir sans cet historique.
- Au plus 8 sources par question, 1 à 10 passages/source, 1 500 caractères/passage et 30 000 caractères de passages ; rapports limités par le contexte serveur. Les textes trop longs sont tronqués au niveau du passage, et affichés exactement tels qu’envoyés. Le modèle ne reçoit pas automatiquement toute la base.
- Les paragraphes sont séparés par des lignes vides ; pour SQLite et CSV, choisir plutôt lignes ou extraits. La recherche par mots communs n’est pas une recherche sémantique.
- Les limites de contexte varient selon le fournisseur. La conversation est plafonnée à 100 000 caractères ; le fournisseur peut refuser une requête en dessous de cette limite selon son modèle.
- Les réponses s’affichent en texte brut sécurisé, avec liens internes vers les citations reconnues. Les balises HTML importées ne sont jamais exécutées.
- Le PDF utilise Arial sous Windows. Sur un autre système, le repli Helvetica couvre le français mais certains alphabets et emojis peuvent manquer.

## Exploitation locale

Le serveur écoute uniquement sur `127.0.0.1`, sans mode debug. Cette version est prévue pour un usage personnel local, dans un seul processus. L’historique est isolé par session navigateur signée, avec contrôle CSRF. Il ne s’agit pas d’un système de comptes : effacer les cookies fait perdre l’accès aux anciennes conversations depuis l’interface (elles restent en base). Conserver ensemble la base et `instance/session.key`. La base n’est pas chiffrée.

Après un arrêt brutal pendant une réponse, relancer avec `python app.py` libère les conversations bloquées. Une déconnexion du navigateur peut interrompre une réponse ; aucune réponse partielle n’est ajoutée à l’historique. Le fournisseur peut néanmoins avoir consommé des tokens non communiqués. Ne pas exposer ce serveur local directement sur Internet : un déploiement partagé nécessite authentification, politique de conservation, HTTPS et serveur de production.

## Vérification

Tests avec fournisseur simulé (aucun appel payant) :

```powershell
.\.venv\Scripts\python.exe -m pip install pypdf
.\.venv\Scripts\python.exe -m unittest -v
```

Ils couvrent sessions, CSRF, domaines, flux, persistance, tokens, notes, imports CSV/SQLite, clés étrangères, règles métier, sélection des passages, erreurs, verrouillage, exports et résumé PDF. La validation en conditions réelles nécessite votre clé Groq et un modèle accessible sur votre compte.

Gestion des erreurs du client API : [documentation officielle OpenAI](https://developers.openai.com/api/docs/guides/error-codes).
