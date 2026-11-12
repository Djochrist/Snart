/* Contrôles de confort avant envoi. Le backend reste l'autorité. */
export const DESCRIPTION_MIN = 8;
export const DESCRIPTION_MAX = 2000;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CATEGORY_CHOICES = ['auto', 'dechets', 'caniveau_bouche', 'embouteillage'];

export function validateDraft(draft, now = Date.now()) {
  const errors = {};
  const length = draft.description.trim().length;
  if (length < DESCRIPTION_MIN) {
    errors.description = `Décris le problème en ${DESCRIPTION_MIN} caractères au moins.`;
  } else if (length > DESCRIPTION_MAX) {
    errors.description = `La description dépasse ${DESCRIPTION_MAX} caractères.`;
  }
  if (!CATEGORY_CHOICES.includes(draft.category_override)) {
    errors.category = 'Choisis une catégorie de la liste.';
  }
  if (Number.isFinite(draft.latitude) !== Number.isFinite(draft.longitude)) {
    errors.location = 'La position est incomplète. Choisis-la de nouveau.';
  }
  if (draft.observed_at) {
    const time = new Date(draft.observed_at).getTime();
    if (Number.isNaN(time)) errors.observed_at = 'Cette heure n’est pas valide.';
    else if (time > now + 60000) errors.observed_at = 'L’heure d’observation ne peut pas être dans le futur.';
  }
  return errors;
}

/* Le type déclaré peut être vide sur certains téléphones : le serveur tranche alors. */
export function validatePhoto(file) {
  if (file.size > PHOTO_MAX_BYTES) return 'Cette image dépasse 8 Mo. Choisis-en une plus légère.';
  if (file.size === 0) return 'Cette image est vide.';
  if (file.type && !PHOTO_TYPES.includes(file.type)) {
    return 'Ce format n’est pas accepté. Choisis une image JPEG, PNG ou WebP.';
  }
  return null;
}
