/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 商店版(MSIX)构建标志,见 src/lib/build-flags.ts 与 .env.store。 */
  readonly VITE_STORE_BUILD?: string;
}
