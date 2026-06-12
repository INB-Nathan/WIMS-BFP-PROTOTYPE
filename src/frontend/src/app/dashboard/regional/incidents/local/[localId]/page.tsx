'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LocalIncidentRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const localId = typeof params?.localId === 'string' ? params.localId : '';

  useEffect(() => {
    if (localId) {
      router.replace(`/dashboard/regional/incidents/${localId}`);
    } else {
      router.replace('/dashboard/regional');
    }
  }, [localId, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-gray-500">
      Opening pending sync incident...
    </div>
  );
}
