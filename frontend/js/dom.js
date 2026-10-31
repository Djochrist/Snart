/* Petits outils DOM. Les données reçues passent toujours par textContent. */
const SVG_NS = 'http://www.w3.org/2000/svg';
let noticeTimer = null;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(id, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export function button(label, className, onClick, iconId) {
  const node = el('button', className);
  node.type = 'button';
  if (iconId) node.append(icon(iconId));
  node.append(el('span', '', label));
  node.addEventListener('click', onClick);
  return node;
}

export function link(label, className, href, iconId) {
  const node = el('a', className);
  node.href = href;
  if (iconId) node.append(icon(iconId));
  node.append(el('span', '', label));
  return node;
}

/* Message global, annoncé aux lecteurs d'écran. */
export function notify(message, { error = false, duration = 6000 } = {}) {
  const notice = document.querySelector('#notice');
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.classList.toggle('is-error', error);
  notice.hidden = false;
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, error ? duration * 2 : duration);
}
