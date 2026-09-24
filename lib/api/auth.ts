const delay = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export async function login(_payload: LoginPayload): Promise<{ success: true }> {
  await delay();
  return { success: true };
}

export async function register(_payload: RegisterPayload): Promise<{ success: true }> {
  await delay();
  return { success: true };
}

export async function requestPasswordReset(_email: string): Promise<{ success: true }> {
  await delay(700);
  return { success: true };
}

export async function loginWithGoogle(): Promise<{ success: true }> {
  await delay(900);
  return { success: true };
}
