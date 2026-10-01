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

  if (!response.ok) {
    throw new Error(payload?.message || 'Request failed.');
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
  const rawUser = localStorage.getItem(USER_KEY);
  return rawUser ? JSON.parse(rawUser) : null;
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

  deleteEvent: (eventId) =>
    request(`/admin/events/${eventId}`, {
      method: 'DELETE',
    }),

  getCounties: () => request('/public/counties'),

  getPublicEvents: () => request('/public/events'),

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
