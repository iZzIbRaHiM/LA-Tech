// OWASP-aligned password policy: length plus a mix of character classes
// (not just length alone) since these are CEO-issued temp passwords and
// self-chosen replacements, not passphrases from a password manager.
export function passwordPolicyError(password: unknown): string | null {
  const pw = String(password ?? '');
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include at least one special character';
  return null;
}
