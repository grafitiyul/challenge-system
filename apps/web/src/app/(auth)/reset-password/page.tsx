import { redirect } from 'next/navigation';

// Password reset via email link is not available in this system.
// Admins can reset passwords from the admin users management screen (/admin/admins).
export default function ResetPasswordPage() {
  redirect('/login');
}
