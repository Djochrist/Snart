/* Formulaire de signalement. L'état `location` est la seule source de la position envoyée. */
import { createReport, isRetryable } from '../api.js';
import { button, el, link, notify } from '../dom.js';
import { factorLines } from '../format.js';
import { positionFailureMessage, requestPosition } from '../geo.js';
import { reporterId } from '../identity.js';
import { createPinPicker, loadLeaflet } from '../map.js';
import { indexedDbQueue, newClientId, SYNC_STATES } from '../queue.js';
import { DESCRIPTION_MAX, validateDraft, validatePhoto } from '../validation.js';
import { categoryTag, statusPill } from './report-card.js';

const LOW_ACCURACY_M = 100;
const DEFAULT_LOCATION_TEXT = 'Facultatif. Sans position, le signalement n’apparaît pas sur la carte.';
const FIELDS = ['description', 'category', 'location', 'photo', 'observed_at'];

export function createReportFormView({ reports, onQueueChanged }) {
  const form = document.querySelector('#reportForm');
  const description = document.querySelector('#description');
  const counter = document.querySelector('#descriptionCount');
  const locationText = document.querySelector('#locationLabel');
  const locateButton = document.querySelector('#locateButton');
  const pickerButton = document.querySelector('#pickerButton');
  const clearLocationButton = document.querySelector('#clearLocation');
  const pickerPanel = document.querySelector('#pickerPanel');
  const pickerStatus = document.querySelector('#pickerStatus');
  const pickerCenter = document.querySelector('#pickerCenter');
  const photoFile = document.querySelector('#photoFile');
  const photoCamera = document.querySelector('#photoCamera');
  const photoPreview = document.querySelector('#photoPreview');
  const observedAt = document.querySelector('#observedAt');
  const submitButton = document.querySelector('#submitButton');
  const submitLabel = submitButton.querySelector('span');
  const message = document.querySelector('#formMessage');
  const result = document.querySelector('#reportResult');
  const offlineHint = document.querySelector('#formOfflineHint');

  const state = {
    location: null,
    photo: null,
    photoName: null,
    photoUrl: null,
    picker: null,
    sending: false,
    replacing: null,
  };

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function setFieldError(field, text) {
    const target = document.querySelector(`#${field}Error`);
    const input = document.querySelector(`[data-error-for="${field}"]`);
    target.textContent = text || '';
    target.hidden = !text;
    if (!input) return;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function updateCounter() {
    counter.textContent = `${description.value.trim().length} / ${DESCRIPTION_MAX}`;
  }

  function renderLocation() {
    const { location } = state;
    clearLocationButton.hidden = !location;
    if (!location) {
      locationText.textContent = DEFAULT_LOCATION_TEXT;
      return;
    }
    const coordinates = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
    if (location.source === 'manual') {
      locationText.textContent = `Épingle placée sur le problème : ${coordinates}.`;
    } else if (location.accuracy_m > LOW_ACCURACY_M) {
      locationText.textContent = `Position obtenue, peu précise (±${Math.round(location.accuracy_m)} m) : ${coordinates}. Tu peux ajuster l’épingle sur la carte.`;
    } else {
      locationText.textContent = `Position obtenue (±${Math.round(location.accuracy_m)} m) : ${coordinates}.`;
    }
  }

  function setLocation(location) {
    state.location = location;
    setFieldError('location', '');
    renderLocation();
  }

  async function openPicker() {
    pickerPanel.hidden = false;
    pickerButton.setAttribute('aria-expanded', 'true');
    if (state.picker) {
      state.picker.resize();
      return;
    }
    pickerStatus.hidden = false;
    pickerStatus.textContent = 'Chargement de la carte…';
    try {
      await loadLeaflet();
      state.picker = createPinPicker(document.querySelector('#pickerMap'), {
        onChange: (latlng) => setLocation({
          latitude: latlng.lat, longitude: latlng.lng, accuracy_m: null, source: 'manual',
        }),
      });
      pickerStatus.hidden = true;
      pickerCenter.hidden = false;
      if (state.location) state.picker.show(state.location.latitude, state.location.longitude);
    } catch {
      pickerStatus.textContent = 'La carte n’a pas pu se charger : l’épingle est indisponible pour le moment. Tu peux utiliser le GPS ou envoyer sans position.';
    }
  }

  function clearPhoto() {
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    Object.assign(state, { photo: null, photoName: null, photoUrl: null });
    photoFile.value = '';
    photoCamera.value = '';
    photoPreview.replaceChildren();
    photoPreview.hidden = true;
  }

  function showPhoto(file, name) {
    clearPhoto();
    Object.assign(state, { photo: file, photoName: name, photoUrl: URL.createObjectURL(file) });
    const image = el('img');
    image.src = state.photoUrl;
    image.alt = 'Aperçu de la photo choisie';
    photoPreview.append(image, el('span', 'photo-name', name), button('Retirer la photo', 'text-button', () => {
      clearPhoto();
      photoFile.focus();
    }));
    photoPreview.hidden = false;
  }

  function onPhotoChosen(input) {
    const file = input.files?.[0];
    setFieldError('photo', '');
    if (!file) return;
    const problem = validatePhoto(file);
    if (problem) {
      clearPhoto();
      setFieldError('photo', `${problem} Tu peux aussi envoyer le signalement sans photo.`);
      return;
    }
    showPhoto(file, file.name || 'Photo');
  }

  function resetForm() {
    form.reset();
    clearPhoto();
    state.location = null;
    state.replacing = null;
    state.picker?.clear();
    renderLocation();
    updateCounter();
    FIELDS.forEach((field) => setFieldError(field, ''));
  }

  function collectItem() {
    return {
      client_id: state.replacing || newClientId(),
      description: description.value.trim(),
      category_override: form.elements.category_override.value,
      reporter_id: reporterId(),
      observed_at: new Date(observedAt.value || Date.now()).toISOString(),
      latitude: state.location?.latitude,
      longitude: state.location?.longitude,
      location_accuracy_m: state.location?.accuracy_m ?? undefined,
      photo: state.photo,
      photo_name: state.photoName,
      queued_at: new Date().toISOString(),
      sync_state: SYNC_STATES.pending,
    };
  }

  function showResult(report) {
    const tags = el('div', 'detail-tags');
    tags.append(categoryTag(report.category), statusPill(report.status));
    const factors = el('ul', 'factor-list');
    factors.append(...factorLines(report).map((line) => el('li', '', line)));
    const actions = el('div', 'result-actions');
    actions.append(
      link('Voir la fiche', 'primary-button', `#/signalement/${report.id}`),
      button('Faire un autre signalement', 'secondary-button', () => {
        result.hidden = true;
        form.hidden = false;
        description.focus();
      }),
    );
    const title = el('h2', '', 'Signalement publié');
    title.tabIndex = -1;
    result.replaceChildren(
      title,
      tags,
      el('p', 'result-summary', report.summary),
      el('p', 'detail-hint', `Indice de corroboration de départ : ${report.confidence_percent}/100.`),
      factors,
      actions,
    );
    form.hidden = true;
    result.hidden = false;
    title.focus();
  }

  async function keepForLater(item, reason) {
    try {
      await indexedDbQueue.put(item);
    } catch {
      setMessage('Envoi impossible, et ce navigateur ne peut pas garder le signalement. Ne ferme pas cette page et réessaie dans un instant.', true);
      return;
    }
    const trafficNote = item.category_override === 'embouteillage'
      ? ' Un embouteillage vieillit vite : il devra être reconfirmé.'
      : '';
    resetForm();
    setMessage('');
    await onQueueChanged();
    notify(`${reason} Ton signalement est gardé sur ce téléphone, il n’est pas encore publié.${trafficNote}`, { duration: 10000 });
    location.hash = '#/attente';
  }

  async function publish(item) {
    try {
      if (!navigator.onLine) {
        await keepForLater(item, 'Tu es hors ligne.');
        return;
      }
      const report = await createReport(item);
      if (state.replacing) {
        await indexedDbQueue.remove(state.replacing);
        await onQueueChanged();
      }
      reports.invalidate();
      resetForm();
      showResult(report);
    } catch (error) {
      if (isRetryable(error)) await keepForLater(item, 'Le serveur est injoignable pour le moment.');
      else setMessage(error.message, true);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (state.sending) return;
    const item = collectItem();
    const errors = validateDraft({ ...item, observed_at: observedAt.value || null });
    ['description', 'category', 'location', 'observed_at'].forEach((field) => setFieldError(field, errors[field]));
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      setMessage('Corrige les points indiqués puis réessaie.', true);
      document.querySelector(`[data-error-for="${firstError}"]`)?.focus();
      return;
    }

    state.sending = true;
    submitButton.disabled = true;
    submitLabel.textContent = 'Envoi en cours…';
    setMessage('');
    await publish(item);
    state.sending = false;
    submitButton.disabled = false;
    submitLabel.textContent = 'Envoyer le signalement';
  }

  async function onLocate() {
    locateButton.disabled = true;
    setFieldError('location', '');
    locationText.textContent = 'Recherche de ta position…';
    const position = await requestPosition();
    locateButton.disabled = false;
    if (!position.ok) {
      renderLocation();
      setFieldError('location', `${positionFailureMessage(position.reason)} Tu peux placer une épingle sur la carte, ou envoyer sans position.`);
      return;
    }
    setLocation({ ...position, source: 'gps' });
    state.picker?.show(position.latitude, position.longitude);
  }

  form.addEventListener('submit', onSubmit);
  description.addEventListener('input', updateCounter);
  photoFile.addEventListener('change', () => onPhotoChosen(photoFile));
  photoCamera.addEventListener('change', () => onPhotoChosen(photoCamera));
  locateButton.addEventListener('click', onLocate);
  pickerButton.addEventListener('click', openPicker);
  pickerCenter.addEventListener('click', () => state.picker?.placeAtCenter());
  clearLocationButton.addEventListener('click', () => {
    setLocation(null);
    state.picker?.clear();
  });

  updateCounter();
  renderLocation();

  return {
    enter() {
      offlineHint.hidden = navigator.onLine;
      if (!pickerPanel.hidden) state.picker?.resize();
    },
    /* Le résultat d'un envoi ne doit pas cacher le formulaire à la visite suivante. */
    leave() {
      result.hidden = true;
      form.hidden = false;
    },
    /* Reprend dans le formulaire un élément de la file refusé par le serveur. */
    edit(item) {
      resetForm();
      result.hidden = true;
      form.hidden = false;
      description.value = item.description;
      form.elements.category_override.value = item.category_override || 'auto';
      if (Number.isFinite(item.latitude)) {
        const hasAccuracy = Number.isFinite(item.location_accuracy_m);
        setLocation({
          latitude: item.latitude,
          longitude: item.longitude,
          accuracy_m: hasAccuracy ? item.location_accuracy_m : null,
          source: hasAccuracy ? 'gps' : 'manual',
        });
      }
      if (item.photo) showPhoto(item.photo, item.photo_name || 'Photo');
      state.replacing = item.client_id;
      updateCounter();
      setMessage(`À corriger : ${item.last_error || 'le serveur a refusé ce signalement.'}`, true);
    },
  };
}
