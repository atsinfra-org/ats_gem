import { currentUser } from "@/lib/mock/users";
import { currentCompany } from "@/lib/mock/companies";

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getCurrentUser() {
  await delay();
  return currentUser;
}

export async function getCurrentCompany() {
  await delay();
  return currentCompany;
}

export async function updateProfile(_data: Partial<typeof currentUser>): Promise<{ success: true }> {
  await delay(700);
  return { success: true };
}

export async function updateCompany(_data: Partial<typeof currentCompany>): Promise<{ success: true }> {
  await delay(700);
  return { success: true };
}
