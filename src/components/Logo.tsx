import { Link } from 'react-router-dom';

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 25V12.5L16 6.5l9 6V25" fill="none" stroke="#C49A55" strokeWidth="2" strokeLinejoin="round" />
      <rect x="13" y="15.5" width="6" height="9.5" fill="#9CC3DD" />
      <path d="M5 25h22" stroke="#C49A55" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="RentReady home">
      <Mark />
      <span>RentReady</span>
    </Link>
  );
}
