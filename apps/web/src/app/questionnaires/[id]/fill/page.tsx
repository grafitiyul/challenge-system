'use client';
import { use } from 'react';
import { redirect } from 'next/navigation';
export default function RedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  redirect(`/admin/questionnaires/${id}/fill`);
}
