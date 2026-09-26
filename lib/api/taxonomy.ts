import { apiRequest } from "./client";
import type { CategoryRef, DistrictRef, SourceRef, StateRef, TenderTypeRef } from "./types";

export function listStates(): Promise<StateRef[]> {
  return apiRequest<StateRef[]>("/meta/states", { anonymous: true });
}

export function listCategories(): Promise<CategoryRef[]> {
  return apiRequest<CategoryRef[]>("/meta/categories", { anonymous: true });
}

export function listTenderTypes(): Promise<TenderTypeRef[]> {
  return apiRequest<TenderTypeRef[]>("/meta/tender-types", { anonymous: true });
}

export function listSources(): Promise<SourceRef[]> {
  return apiRequest<SourceRef[]>("/meta/sources", { anonymous: true });
}

export function listDistricts(): Promise<DistrictRef[]> {
  return apiRequest<DistrictRef[]>("/meta/districts", { anonymous: true });
}
