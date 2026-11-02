// People on MediaDesk: their profile pictures (or initials on their colour), for anywhere a person
// is shown, and a list of everyone (names, colours, pictures) for apps that link people.

export const avatarUrl = (u) => (u?.avatar && u.id ? `/portal/avatar/${u.id}?v=${u.avatar}` : null);

// A round picture of someone (or their initial).
export function personEl(u, size = 28, cls = '') {
  const el = document.createElement('span');
  el.className = `md-person ${cls}`.trim();
  el.style.cssText = `--c:${u?.color || '#3b82f6'};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`;
  el.title = u?.name || '';
  const url = avatarUrl(u);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); el.textContent = (u.name || u.username || '?').slice(0, 1).toUpperCase(); };
    el.append(img);
  } else el.textContent = (u?.name || u?.username || '?').slice(0, 1).toUpperCase();
  return el;
}
export const personHtml = (u, size = 18) => personEl(u, size).outerHTML;

// Everyone who can sign in (id → { name, color, avatar }), loaded once.
let people = null;
export function loadPeople(force = false) {
  if (!people || force) {
    people = fetch('/portal/users/directory', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { users: [] })).then((d) => new Map((d.users || []).map((u) => [u.id, u]))).catch(() => new Map());
  }
  return people;
}
// Already loaded (for drawing without waiting), or null.
let known = null;
loadPeopleSync();
function loadPeopleSync() { if (people) people.then((m) => { known = m; }); }
export const personById = (id) => known?.get(id) || null;
export async function warmPeople() { known = await loadPeople(); return known; }

// A picture chosen on this device, made square (the middle) and small, as a JPEG or WebP.
export async function squarePicture(file, size = 256) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('That picture can’t be opened');
  const side = Math.min(bmp.width, bmp.height);
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  const webp = await new Promise((r) => c.toBlob(r, 'image/webp', 0.88));
  return webp && webp.type === 'image/webp' ? webp : new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
}
