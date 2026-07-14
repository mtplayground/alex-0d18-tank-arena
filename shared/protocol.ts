export type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
};

export type RuntimeStatus = {
  apiBaseUrl: string;
  rendering: {
    engine: 'three-js';
    reactRenderer: '@react-three/fiber';
  };
};
