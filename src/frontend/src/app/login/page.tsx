'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
    const router = useRouter();
    const { user, loading, login } = useAuth();

    useEffect(() => {
        if (!loading && user) {
            router.push('/dashboard');
        }
    }, [user, loading, router]);

    if (user) {
        return null;
    }

    const handleLogin = () => {
        login();
    };

    return (
        <div className="min-h-auth-container flex items-center justify-center bg-theme-brand-dark py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8 bg-theme-none">
                <div className="bg-theme-brand-primary p-8 rounded-xl shadow-2xl border border-theme-brand-accent relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-2 bg-theme-gradient-fire"></div>

                    <div className="flex flex-col items-center mb-8">
                        <div className="mb-4">
                            <Image
                                src="/bfp-logo.svg"
                                alt="BFP Logo"
                                width={150}
                                height={150}
                                className="object-contain"
                            />
                        </div>
                        <h2 className="text-3xl font-bold text-theme-on-brand tracking-tight">Login</h2>
                        <p className="mt-2 text-theme-brand-light text-sm">Sign in to your account</p>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <button
                                onClick={handleLogin}
                                className="group relative w-full flex justify-center py-3 px-4 border border-theme-none text-sm font-bold rounded-md text-theme-brand-primary bg-theme-surface hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-theme-brand-primary focus:ring-theme-focus-offset transition shadow-lg uppercase cursor-pointer z-50"
                            >
                                Login with Keycloak
                            </button>
                        </div>
                    </div>
                </div>

                <div className="text-center text-theme-brand-primary/60 text-xs">
                    &copy; 2026 Bureau of Fire Protection. All rights reserved.
                </div>
            </div>
        </div>
    );
}
