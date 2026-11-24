const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  chat: '<path d="M20 14a3 3 0 0 1-3 3H9l-5 4v-4a3 3 0 0 1-2-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z"/><path d="M7 9h8M7 12h5"/>',
  spark:
    '<path d="m12 2 2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z"/>',
  folder:
    '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings:
    '<path d="M3 7h8m4 0h6M3 17h3m4 0h11"/><circle cx="13" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zm0 0v15"/>',
  edit: '<path d="m5 15-1 5 5-1L20 8l-4-4zM13 7l4 4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/>',
  fingerprint:
    '<path d="M4 11a8 8 0 0 1 16 0m-13 2v-2a5 5 0 0 1 10 0v3m-7 4c2-2 2-5 2-7m3 9c1-2 2-4 2-6M5 17l1-2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 9a8 8 0 1 0 0 7m0-12v5h-5"/>',
  compare: '<path d="M5 7h14l-3-3m3 13H5l3 3M12 4v16"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  share: '<path d="M9 6h-4v15h14v-6M13 3h8v8m0-8L10 14"/>',
};
export const icon = (key) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  (paths[key] || "") +
  "</svg>";
export function drawIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]"))
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
}
