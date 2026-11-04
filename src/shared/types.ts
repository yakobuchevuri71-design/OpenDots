export type Status =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export interface Settings {
  name: string;
  paused: boolean;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  appsAllowed: boolean;
}
export interface Task {
  id: string;
  prompt: string;
  status: Status;
  intervalSeconds: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  lease: string | null;
  leaseUntil: number | null;
}
export interface Source {
  title: string;
  url: string;
  excerpt: string;
}
export interface Result {
  text: string;
  sources: Source[];
  sample: boolean;
  screenshot?: string;
}
export interface Run {
  id: string;
  taskId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  result: Result | null;
  error: string | null;
}
export interface TaskEvent {
  id: number;
  taskId: string;
  runId: string | null;
  text: string;
  createdAt: number;
}
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
}
export interface Detail {
  task: Task;
  runs: Run[];
  events: TaskEvent[];
}
export interface State {
  settings: Settings;
  tasks: Task[];
  memories: Memory[];
  mode: 'sample' | 'live';
  configured: boolean;
}
export type Action = 'run' | 'pause' | 'cancel';
export interface Space {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
export interface Dot {
  id: string;
  /** Default destination for saved pages, not ownership. */
  spaceId: string;
  spaceIds: string[];
  name: string;
  instructions: string;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  appsAllowed: boolean;
  composioToolkits: string[];
  composioSessionId?: string | null;
  composioPolicyHash?: string | null;
  createdAt: number;
  learningContainerId?: string | null;
  skillDeliveryEnabled?: boolean;
  /** Model override for this Dot; null uses the deployment default. */
  modelId?: string | null;
}
export interface Conversation {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
  createdAt: number;
  /** Frozen at creation; null means this conversation does not participate. */
  learningContainerId?: string | null;
}
export interface CallReceipt {
  anchorMessageId?: string | null;
  id: string;
  threadId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'connecting' | 'active' | 'ended' | 'failed';
  transcript: string;
  error: string | null;
}
export interface SetupStatus {
  intelligence: boolean;
  model: boolean;
  browser: boolean;
  voice: boolean;
  composio: boolean;
  slack: string;
  missing: string[];
}
export interface WorkspaceState {
  spaces: Space[];
  dots: Dot[];
  conversations: Conversation[];
  setup: SetupStatus;
  calls: CallReceipt[];
}

export type AnalyticsEventKind =
  | 'conversation_created'
  | 'agent_run'
  | 'page_created'
  | 'task_run'
  | 'call'
  | 'project_created'
  | 'attachment_added';

export interface AnalyticsEvent {
  id: number;
  at: number;
  kind: AnalyticsEventKind;
  dotId: string | null;
  threadId: string | null;
  refId: string | null;
  durationMs: number | null;
  ok: boolean;
  meta: Record<string, unknown>;
}

export interface DailyActivity {
  date: string;
  agentRuns: number;
  pages: number;
  conversations: number;
  calls: number;
  taskRuns: number;
  projects: number;
}

export interface AgentActivity {
  dotId: string;
  name: string;
  runs: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  lastAt: number | null;
}

export interface AnalyticsSummary {
  generatedAt: number;
  usage: {
    conversations: number;
    agentRuns: number;
    pages: number;
    calls: number;
    taskRuns: number;
    projects: number;
    attachments: number;
  };
  taskStats: Record<Status, number> & { total: number };
  performance: {
    avgAgentRunMs: number;
    p50AgentRunMs: number;
    p95AgentRunMs: number;
    successRate: number;
    busiestHour: number | null;
  };
  agentActivity: AgentActivity[];
  daily: DailyActivity[];
  recent: AnalyticsEvent[];
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  provider: string;
}

export interface Attachment {
  id: string;
  threadId: string;
  name: string;
  kind: 'text' | 'markdown' | 'code' | 'json' | 'csv' | 'binary';
  mimeType: string;
  size: number;
  createdAt: number;
  text: string | null;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface Project {
  id: string;
  dotId: string;
  name: string;
  description: string;
  template: string;
  status: 'draft' | 'ready';
  files: ProjectFile[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  dotId: string;
  name: string;
  description: string;
  template: string;
  status: 'draft' | 'ready';
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}
