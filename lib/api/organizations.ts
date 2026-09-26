import { apiRequest } from "./client";
import type { OrganizationDetail, OrganizationMember } from "./types";

export type OrganizationUpdate = Partial<{
  name: string;
  gstin: string;
  pan: string;
  industry: string;
  companySize: string;
  address: string;
  stateCode: string;
  city: string;
  website: string;
  contactPerson: string;
}>;

export const getCurrentOrganization = () => apiRequest<OrganizationDetail>("/organizations/current");
export const updateCurrentOrganization = (data: OrganizationUpdate) =>
  apiRequest<OrganizationDetail>("/organizations/current", { method: "PATCH", body: data });
export const listMembers = () => apiRequest<OrganizationMember[]>("/organizations/current/members");
export const inviteMember = (email: string, role: "MEMBER" | "VIEWER") =>
  apiRequest<{ invited: boolean; expiresAt: string }>("/organizations/current/invitations", { method: "POST", body: { email, role } });
export const updateMemberRole = (userId: string, role: "MEMBER" | "VIEWER") =>
  apiRequest(`/organizations/current/members/${userId}`, { method: "PATCH", body: { role } });
export const removeMember = (userId: string) => apiRequest(`/organizations/current/members/${userId}`, { method: "DELETE" });
export const acceptInvitation = (token: string) => apiRequest("/organizations/invitations/accept", { method: "POST", body: { token } });
