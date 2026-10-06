export interface Attribution {
  landingPath?: string;
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

const STORAGE_KEY = "ats_attribution";

/**
 * First-touch attribution, captured once per browser tab (sessionStorage) and attached to every event
 * afterwards; the server only uses it when it creates a *new* session row, so resending it is harmless
 * (docs/ARCHITECTURE.md Sec 22.5 - first-touch only, no last-touch overwrite).
 */
export function getAttribution(): Attribution {
  try {
    const cached = window.sessionStorage.getItem(STORAGE_KEY);
    if (cached) return JSON.parse(cached) as Attribution;
  } catch {
    // fall through to a fresh capture
  }

  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).host : undefined;
  } catch {
    referrerHost = undefined;
  }
  const attribution: Attribution = {
    landingPath: window.location.pathname.slice(0, 300),
    referrerHost: referrerHost?.slice(0, 200),
    utmSource: params.get("utm_source")?.slice(0, 100) ?? undefined,
    utmMedium: params.get("utm_medium")?.slice(0, 100) ?? undefined,
    utmCampaign: params.get("utm_campaign")?.slice(0, 150) ?? undefined,
    utmTerm: params.get("utm_term")?.slice(0, 150) ?? undefined,
    utmContent: params.get("utm_content")?.slice(0, 150) ?? undefined,
  };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // private window / storage blocked: attribution just won't persist across page loads this tab
  }
  return attribution;
}
