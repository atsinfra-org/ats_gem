import { apiRequest, setAccessToken } from "./client";
import type { AuthSessionResult, AuthUser, SessionInfo } from "./types";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  acceptTerms: true;
}

export interface RegisterResult {
  user: AuthUser;
  requiresEmailVerification: boolean;
  accessToken: string;
  expiresIn: number;
}

export async function login(payload: LoginPayload): Promise<{ user: AuthUser } & AuthSessionResult> {
  const result = await apiRequest<{ accessToken: string; expiresIn: number; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: payload,
    anonymous: true,
  });
  setAccessToken(result.accessToken);
  return result;
}

export async function register(payload: RegisterPayload): Promise<RegisterResult> {
  const result = await apiRequest<RegisterResult>("/auth/register", { method: "POST", body: payload, anonymous: true });
  setAccessToken(result.accessToken);
  return result;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest("/auth/forgot-password", { method: "POST", body: { email }, anonymous: true });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiRequest("/auth/reset-password", { method: "POST", body: { token, password }, anonymous: true });
}

export async function verifyEmail(token: string): Promise<void> {
  await apiRequest("/auth/verify-email", { method: "POST", body: { token }, anonymous: true });
}

export async function resendVerification(): Promise<void> {
  await apiRequest("/auth/resend-verification", { method: "POST" });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
}

export async function listSessions(): Promise<SessionInfo[]> {
  return apiRequest<SessionInfo[]>("/auth/sessions");
}

export async function revokeSession(id: string): Promise<void> {
  await apiRequest(`/auth/sessions/${id}`, { method: "DELETE" });
}
