'use client';

export interface OperatorSessionProfile {
  actorId: string;
  displayName: string;
  email: string | null;
  platformAdmin: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'EC';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'EC';
}

export function OperatorSessionControl({
  profile,
  busy,
  onSignOut,
}: {
  profile: OperatorSessionProfile;
  busy: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="ec-session-mini" aria-label="Authenticated operator">
      <span className="ec-profile-avatar" aria-hidden="true">
        {initials(profile.displayName)}
      </span>
      <span className="ec-session-copy">
        <small>{profile.platformAdmin ? 'Platform admin' : 'Operator'}</small>
        <strong>{profile.displayName}</strong>
      </span>
      <button type="button" className="ec-session-button" onClick={onSignOut} disabled={busy}>
        {busy ? 'Ending…' : 'Sign out'}
      </button>
    </div>
  );
}
