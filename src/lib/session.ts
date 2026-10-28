import { read, uid, write } from './storage';

/** Anonymous funnel session. Not an auth token — paid access is decided server-side. */
export function getSessionId(): string {
  let id = read<string>('session_id', '');
  if (!id) {
    id = uid('ses');
    write('session_id', id);
  }
  return id;
}
