// Service worker registration and update notification.
export const pwaState = { supported: 'serviceWorker' in navigator, registered: false, controlled: Boolean(navigator.serviceWorker?.controller), error: null, registration: null };

export function registerServiceWorker({ onUpdated } = {}) {
  if (!pwaState.supported) return;
  if (!import.meta.env.PROD) { pwaState.error = '開発モードでは Service Worker を登録しません'; return; }
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pwaState.controlled = true;
    // The first install also fires controllerchange (clients.claim); only a
    // replacement of an existing worker is an update.
    if (hadController) onUpdated?.();
    hadController = true;
  });
  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      pwaState.registered = true; pwaState.registration = registration;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch((error) => { pwaState.error = String(error?.message || error); });
      });
    } catch (error) {
      pwaState.error = String(error?.message || error);
      console.warn('[SUMO 500] Service Worker registration failed:', error);
    }
  };
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}

export async function checkForUpdate() {
  if (!pwaState.registration) return { ok: false, message: 'Service Worker が登録されていません' };
  try { await pwaState.registration.update(); return { ok: true, message: '更新を確認しました' }; }
  catch (error) { return { ok: false, message: String(error?.message || error) }; }
}

export async function storageStatus() {
  const result = { persisted: null, usage: null, quota: null };
  try { result.persisted = await navigator.storage?.persisted?.() ?? null; } catch { result.persisted = null; }
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate) { result.usage = estimate.usage; result.quota = estimate.quota; } } catch { /* unsupported */ }
  return result;
}

// Asks the browser not to evict this origin's storage (learning data) under pressure.
export async function requestPersistentStorage() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); }
  catch { return false; }
  return true;
}
