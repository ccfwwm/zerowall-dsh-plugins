export interface ClaudeCodeStatus {
  desktop: boolean
  installed: boolean
  version?: string
  rollbackAvailable: boolean
  running: boolean
}
export interface ClaudeCodeTurn {
  id: string
  provider: string
  model: string
  running: boolean
  output: string
  exitCode?: number | null
  message?: string
  skills: number
  mcp: number
  skipped: string[]
}
