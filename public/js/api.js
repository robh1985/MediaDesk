// Thin clients for the portal's proxy endpoints. Credentials never reach the browser.

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(url, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { Accept: 'application/json', 'X-MediaDesk': '1', ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  if (res.status === 401 && url.startsWith('/portal') === false && (await isLoggedOut())) {
    window.dispatchEvent(new Event('mediadesk:logout'));
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message || (Array.isArray(data) && data[0]?.errorMessage))) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

async function isLoggedOut() {
  try { const s = await (await fetch('/portal/session')).json(); return s.auth && !s.authed; } catch { return false; }
}

const qs = (params) => {
  if (!params) return '';
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return s ? `?${s}` : '';
};

function rest(base) {
  return {
    get: (path, params) => request(`${base}/${path}${qs(params)}`),
    post: (path, body, params) => request(`${base}/${path}${qs(params)}`, { method: 'POST', body: body ?? {} }),
    put: (path, body, params) => request(`${base}/${path}${qs(params)}`, { method: 'PUT', body }),
    del: (path, params) => request(`${base}/${path}${qs(params)}`, { method: 'DELETE' }),
    url: (path, params) => `${base}/${path}${qs(params)}`,
  };
}

export const radarr = rest('/api/radarr/api/v3');
export const sonarr = rest('/api/sonarr/api/v3');
export const jellyfin = rest('/api/jellyfin');
export const nzbget = (method, ...params) => request('/api/nzbget', { method: 'POST', body: { method, params } });

export const portal = {
  config: () => request('/portal/config'),
  saveConfig: (cfg) => request('/portal/config', { method: 'POST', body: cfg }),
  test: () => request('/portal/test'),
  session: () => request('/portal/session'),
  login: (password) => request('/portal/login', { method: 'POST', body: { password } }),
  logout: () => request('/portal/logout', { method: 'POST' }),
};

// Shared state filled at boot.
export const state = { config: null, jellyfinUser: null };

export async function jellyfinUserId() {
  if (state.jellyfinUser) return state.jellyfinUser;
  const configured = state.config?.services.jellyfin.userId;
  if (configured) return (state.jellyfinUser = configured);
  const users = await jellyfin.get('Users');
  const pick = users.find((u) => u.Policy?.IsAdministrator) || users[0];
  if (!pick) throw new Error('No Jellyfin users found');
  return (state.jellyfinUser = pick.Id);
}

export const jellyfinImage = (id, { type = 'Primary', height = 360, tag } = {}) =>
  jellyfin.url(`Items/${id}/Images/${type}`, { fillHeight: height, quality: 90, tag });

export const serviceLink = (svc) => state.config?.services[svc]?.publicUrl || '';
export const isConfigured = (svc) => Boolean(state.config?.services[svc]?.configured);
