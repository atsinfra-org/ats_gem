"use client";

import * as React from "react";
import { onApiError } from "@/lib/api/client";
import { track } from "@/lib/analytics/client";

/** Server errors and unexpected failures worth knowing about; routine/expected codes are excluded so this
 * does not just restate every 401 refresh or form validation error the UI already handles. */
const NOISE_CODES = new Set(["UNAUTHENTICATED", "TOKEN_EXPIRED", "VALIDATION_FAILED", "INVALID_CREDENTIALS", "RATE_LIMITED"]);

/** Headless: subscribes to every failed API call and reports the ones worth knowing about. Renders nothing. */
export function ErrorTracker() {
  React.useEffect(() => {
    return onApiError((code, status, path) => {
      if (path.startsWith("/analytics/") || NOISE_CODES.has(code)) return;
      track("API_ERROR", { path, metadata: { code: code.slice(0, 60), status } });
    });
  }, []);
  return null;
}
