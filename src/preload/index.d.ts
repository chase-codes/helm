import type { HelmApi } from '../shared/types';

declare global {
  interface Window {
    helm: HelmApi;
  }
}
