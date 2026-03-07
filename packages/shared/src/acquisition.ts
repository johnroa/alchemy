export const ACQUISITION_CHANNELS = [
  "organic",
  "waitlist",
  "friend_share",
  "unknown",
] as const;

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export const LIFECYCLE_STAGES = [
  "new",
  "activated",
  "saved",
  "habit",
  "at_risk",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const INSTALL_TELEMETRY_EVENT_TYPES = [
  "app_first_open",
  "app_session_started",
] as const;

export type InstallTelemetryEventType =
  (typeof INSTALL_TELEMETRY_EVENT_TYPES)[number];

export type InstallTelemetryEvent = {
  eventId: string;
  eventType: InstallTelemetryEventType;
  occurredAt?: string | null;
  payload?: Record<string, string | number | boolean | null>;
};

export const isAcquisitionChannel = (
  value: string,
): value is AcquisitionChannel =>
  (ACQUISITION_CHANNELS as readonly string[]).includes(value);

export const isInstallTelemetryEventType = (
  value: string,
): value is InstallTelemetryEventType =>
  (INSTALL_TELEMETRY_EVENT_TYPES as readonly string[]).includes(value);
