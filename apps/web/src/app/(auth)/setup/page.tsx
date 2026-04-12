import { Suspense } from 'react';
import SetupForm from './setup-form';

export default function SetupPage() {
  return (
    <Suspense>
      <SetupForm />
    </Suspense>
  );
}
