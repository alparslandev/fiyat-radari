export interface RadarKv {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export interface Env {
  RADAR: RadarKv
  EMAIL?: SendEmail
  GH_REPO: string
  GH_WORKFLOW: string
  GH_REF: string
  MAIL_FROM: string
  GH_TOKEN?: string
  INGEST_TOKEN?: string
  RESEND_API_KEY?: string
  MAIL_TO?: string
}
