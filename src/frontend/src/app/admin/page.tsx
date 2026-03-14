'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/admin/system');
    }, [router]);
    return <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Redirecting to Admin Hub...</div>;
}
