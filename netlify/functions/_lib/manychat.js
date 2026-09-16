function normalizeManyChatContactId(value) {
  const id = String(value || '').trim();
  return /^[0-9]{3,32}$/.test(id) ? id : '';
}

function manychatMetadata(value) {
  const id = normalizeManyChatContactId(value);
  return id ? { manychat_contact_id: id } : {};
}

module.exports = {
  normalizeManyChatContactId,
  manychatMetadata,
};
