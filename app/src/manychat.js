const MANYCHAT_STORAGE_KEY = 'rrn_manychat_contact_id_v1';
const ANSWERS_STORAGE_KEY = 'rrn_answers_v1';

function normalizeManyChatContactId(value) {
  const id = String(value || '').trim();
  return /^[0-9]{3,32}$/.test(id) ? id : '';
}

function writeStoredAnswers(id) {
  try {
    [sessionStorage, localStorage].forEach((storage) => {
      const current = JSON.parse(storage.getItem(ANSWERS_STORAGE_KEY) || 'null');
      if (current && typeof current === 'object' && current.lead_id) {
        storage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify({
          ...current,
          manychat_contact_id: id,
        }));
      }
    });
  } catch (_e) {}
}

function storeManyChatContactId(id) {
  try { sessionStorage.setItem(MANYCHAT_STORAGE_KEY, id); } catch (_e) {}
  try { localStorage.setItem(MANYCHAT_STORAGE_KEY, id); } catch (_e) {}
  writeStoredAnswers(id);
}

function readManyChatContactId() {
  try {
    return normalizeManyChatContactId(
      sessionStorage.getItem(MANYCHAT_STORAGE_KEY) ||
      localStorage.getItem(MANYCHAT_STORAGE_KEY)
    );
  } catch (_e) {
    return '';
  }
}

function captureManyChatContactId() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const id = normalizeManyChatContactId(params.get('lead_id'));
    if (id) storeManyChatContactId(id);
    return id || readManyChatContactId();
  } catch (_e) {
    return readManyChatContactId();
  }
}

const manychatContactId = captureManyChatContactId();

window.rrnManyChatContactId = readManyChatContactId;
window.rrnAttachManyChatContactId = function rrnAttachManyChatContactId(payload) {
  const id = readManyChatContactId();
  return id ? { ...(payload || {}), manychat_contact_id: id } : (payload || {});
};

if (manychatContactId) storeManyChatContactId(manychatContactId);
