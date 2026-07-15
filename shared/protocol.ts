export type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
};

export type RuntimeStatus = {
  api_base_url: string;
  rendering: {
    engine: 'three-js';
    react_renderer: '@react-three/fiber';
  };
};

export type UserProfile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture_url: string | null;
  has_password: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type AuthSessionResponse = {
  user: UserProfile;
  registered: boolean;
  message: string;
};

export type AssetResponse = {
  id: string;
  category: string;
  label: string;
  content_type: string;
  url: string;
};

export type AssetManifestResponse = {
  assets: AssetResponse[];
  expires_in_seconds: number;
};

export type MissionProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';

export type MissionProgressEntry = {
  mission_key: string;
  status: MissionProgressStatus;
  current_step: number;
  attempts: number;
  best_score: number | null;
  progress: Record<string, unknown>;
  completed_at: string | null;
  updated_at: string;
};

export type MissionProgressListResponse = {
  missions: MissionProgressEntry[];
};

export type MissionProgressUpdateResponse = {
  mission: MissionProgressEntry;
};

export type MissionProgressUpdatePayload = {
  status: MissionProgressStatus;
  current_step: number;
  attempts: number;
  best_score: number | null;
  progress: Record<string, unknown>;
};

export type MatchmakingArenaSize = 'duel' | 'small_arena';

export type MatchmakingStatus = 'idle' | 'matched' | 'queued';

export type MatchmakingJoinPayload = {
  arena_size?: MatchmakingArenaSize | null;
};

export type MatchmakingParticipant = {
  side: string;
  user_sub: string;
};

export type MatchmakingMatch = {
  arena_size: MatchmakingArenaSize;
  match_id: string;
  participants: MatchmakingParticipant[];
  websocket_path: string;
};

export type MatchmakingQueueResponse = {
  arena_size: MatchmakingArenaSize | null;
  match_session: MatchmakingMatch | null;
  queue_position: number | null;
  status: MatchmakingStatus;
};
