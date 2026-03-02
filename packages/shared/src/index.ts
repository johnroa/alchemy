export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type ErrorEnvelope = {
  code: string;
  message: string;
  details?: Json;
  request_id: string;
};

export const API_BASE_PATH = "/v1";
