export type Env = {
  OPENAI_API_KEY: string;
  OPENAI_REALTIME_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  DEBUG_RELAY?: string;
  REALTIME_SESSIONS: DurableObjectNamespace;
};
