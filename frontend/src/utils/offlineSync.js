const QUEUE_KEY = 'sentinelops_offline_queue';

/**
 * Returns list of events queued in LocalStorage
 */
export const getOfflineQueue = () => {
  try {
    const queue = localStorage.getItem(QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
  } catch (e) {
    return [];
  }
};

/**
 * Writes the queue array to LocalStorage
 */
export const saveOfflineQueue = (queue) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[Offline Storage] Write failed', e);
  }
};

/**
 * Queues a tactical update (e.g. telemetry, SOS status, secure chat) to run when network resumes
 */
export const queueOfflineAction = (type, payload) => {
  const queue = getOfflineQueue();
  const newAction = {
    id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    type,
    payload,
    timestamp: new Date().toISOString()
  };
  queue.push(newAction);
  saveOfflineQueue(queue);
  console.log(`[Offline Queue] Event saved. Type: ${type}, Queue size: ${queue.length}`);
  return queue.length;
};

/**
 * Empties the offline queue
 */
export const clearOfflineQueue = () => {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch (e) {
    console.error('[Offline Storage] Clear failed', e);
  }
};

/**
 * Drains the LocalStorage action queue and transmits it via active WebSocket
 */
export const processOfflineSync = async (socket, onProgress) => {
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  console.log(`[Offline Sync] Restored connection. Dispatching ${queue.length} events...`);

  // Dispatch queue entries
  for (let i = 0; i < queue.length; i++) {
    const action = queue[i];
    try {
      if (action.type === 'soldier-telemetry') {
        socket.emit('soldier-telemetry', action.payload);
      } else if (action.type === 'sos-trigger') {
        socket.emit('sos-trigger', action.payload);
      } else if (action.type === 'chat-message') {
        socket.emit('chat-message', action.payload);
      }

      if (onProgress) {
        onProgress(i + 1, queue.length, action);
      }
      
      // Delay between emits to prevent socket throttling
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (e) {
      console.error('[Offline Sync] Sync failed for item', action, e);
    }
  }

  clearOfflineQueue();
  console.log('[Offline Sync] Queue successfully drained.');
};
