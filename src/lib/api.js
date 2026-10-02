export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

const TOKEN_KEY = 'twendehike_access_token';
const USER_KEY = 'twendehike_user';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getHeaders(extra = {}) {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  const rawError = !response.ok && !payload ? await response.text().catch(() => '') : '';

  if (!response.ok) {
    throw new Error(payload?.message || rawError || `Request failed (${response.status}).`);
  }

  return payload;
}

export function saveSession(authResponse) {
  if (authResponse?.data?.accessToken) {
    localStorage.setItem(TOKEN_KEY, authResponse.data.accessToken);
  }

  if (authResponse?.data?.user) {
    localStorage.setItem(USER_KEY, JSON.stringify(authResponse.data.user));
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
  try {
    const rawUser = localStorage.getItem(USER_KEY)
    return rawUser ? JSON.parse(rawUser) : null
  } catch (error) {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

export function getApiData(response, fallback = null) {
  return response?.data ?? response ?? fallback;
}

export function getApiArray(response) {
  const payload = getApiData(response, [])
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.events)) return payload.events
  if (Array.isArray(payload?.counties)) return payload.counties
  return []
}

export const api = {
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  resetAdminPassword: (payload) =>
    request('/admin/password/reset', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updateAdminProfile: (payload) =>
    request('/admin/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  register: (payload) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createEvent: (payload) =>
    request('/public/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reviewEvent: (eventId, payload) =>
    request(`/admin/events/${eventId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getAdminEvents: () => request('/admin/events'),

  completeEvent: (eventId) =>
    request(`/admin/events/${eventId}/complete`, { method: 'PATCH' }),

  deletePermanentEvent: (eventId) =>
    request(`/admin/events/${eventId}`, {
      method: 'DELETE',
    }),

  deleteEvent: (eventId) =>
    request(`/admin/events/${eventId}`, {
      method: 'DELETE',
    }),

  updateAdminSettings: (payload) =>
    request('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  getHeroSettings: () => request('/public/settings/hero'),

  updateHeroSettings: (payload) =>
    request('/admin/settings/hero', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getCounties: () => request('/public/counties'),

  getPublicEvents: () => request('/public/events'),

  getPublicSettings: () => request('/public/settings'),

  likeEvent: (eventId, payload = {}) =>
    request(`/public/events/${eventId}/like`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  initiateStkPush: (payload) =>
    request('/payments/stk-push', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  mpesaCallback: (payload) =>
    request('/payments/mpesa-callback', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  downloadTicketPdf: async (bookingId) => {
    const response = await fetch(`${API_BASE_URL}/bookings/${bookingId}/ticket.pdf`, {
      headers: {
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.message || 'Unable to download ticket.');
    }

    return response.blob();
  },
};
