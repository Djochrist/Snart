/* Libellés français des codes de l'API. Aucun calcul métier : tout vient du backend. */
export const CATEGORIES = {
  dechets: { label: 'Déchets', icon: 'm-dechets', css: 'waste' },
  caniveau_bouche: { label: 'Caniveau bouché', icon: 'm-caniveau', css: 'drain' },
  embouteillage: { label: 'Embouteillage', icon: 'm-trafic', css: 'traffic' },
  indetermine: { label: 'À préciser', icon: 'm-inconnu', css: 'unknown' },
};

const STATUSES = {
  active: 'Actuel',
  stale: 'À actualiser',
  resolved: 'Résolu',
};

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export function categoryInfo(category) {
  return CATEGORIES[category] || CATEGORIES.indetermine;
}

export function statusLabel(status) {
  return STATUSES[status] || 'À vérifier';
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Heure indisponible';
  return DATE_FORMAT.format(date);
}

/* Formatage d'affichage seulement : la fraîcheur et le statut restent ceux de l'API. */
export function formatRelative(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (!value || Number.isNaN(time)) return 'Heure indisponible';
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${plural(days, 'jour')}`;
}

export function reportTime(report) {
  return report.observed_at || report.created_at;
}

export function indexLabel(report) {
  return `Fiabilité estimée : ${report.confidence_percent}/100`;
}

/* Bulles pleines du guide d'identité : seuils proposés, simple dessin du score reçu de l'API. */
export function indexLevel(percent) {
  if (percent >= 67) return 3;
  return percent >= 40 ? 2 : 1;
}

export function factorLines(report) {
  const factors = report.confidence_factors || {};
  const nearby = factors.nearby_confirmations ?? 0;
  const remote = factors.remote_confirmations ?? 0;
  const resolutions = factors.resolution_confirmations ?? 0;
  const lines = [
    nearby === 1 ? '1 personne proche a confirmé' : `${nearby} personnes proches ont confirmé`,
    remote === 1 ? '1 personne à distance a confirmé' : `${remote} personnes à distance ont confirmé`,
  ];
  if (resolutions > 0) lines.push(plural(resolutions, 'proposition de résolution', 'propositions de résolution'));
  lines.push(report.has_photo ? 'Photo jointe' : 'Pas de photo');
  if (factors.freshness) lines.push(`Ancienneté : ${factors.freshness}`);
  return lines;
}

export function structuringNote(report) {
  if (report.structuring_mode === 'demo_rules') {
    return 'Résumé et catégorie obtenus par des règles simples, sans modèle d’IA.';
  }
  if (report.structuring_mode === 'gemini') {
    const model = String(report.model_id || '').startsWith('gemma-4') ? 'Gemma 4' : 'Gemini';
    return `Résumé et catégorie proposés par l’IA ${model} à partir de la description. C’est une proposition.`;
  }
  return 'Résumé et catégorie proposés automatiquement.';
}

export function isDemo(report) {
  return String(report.description || '').startsWith('[DÉMO]');
}
