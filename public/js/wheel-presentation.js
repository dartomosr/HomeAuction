import { store } from './store.js';

// Host-only display telemetry. It neither starts nor schedules a spin.
export function reportWheelPresentation(waitMs = 0) {
  if (store.appState?.me?.isHost) store.socket?.emit('wheel_presentation', {
    active: store.autoSpinActive, waitMs
  });
}
