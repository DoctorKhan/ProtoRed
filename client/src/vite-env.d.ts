export {};

declare global {
  interface ImportMetaEnv {
    VITE_OPENROUTER_KEY?: string;
    VITE_OPENROUTER_API_KEY?: string;
    VITE_MODEL?: string;
  }
  interface ImportMeta {
    env: ImportMetaEnv;
    hot?: {
      dispose(cb: () => void): void;
    };
  }
}
