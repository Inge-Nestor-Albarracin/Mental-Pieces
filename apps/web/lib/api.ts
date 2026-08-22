const API_URL = 'http://127.0.0.1:3001';

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    const error = await response.json();

    throw new Error(
      error.message ?? 'No fue posible iniciar sesión.',
    );
  }

  return response.json();
}

export async function getMyProfile(token: string) {
  const response = await fetch(`${API_URL}/patients/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();

    throw new Error(
      error.message ?? 'No fue posible consultar el perfil.',
    );
  }

  return response.json();
}