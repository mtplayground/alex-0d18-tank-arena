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
