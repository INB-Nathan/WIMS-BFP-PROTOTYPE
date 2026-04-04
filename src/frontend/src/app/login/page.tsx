'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ArrowRight, Shield } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const { user, loading, login } = useAuth();

    useEffect(() => {
        if (!loading && user) {
            const role = (user as { role?: string })?.role;
            if (role === 'REGIONAL_ENCODER') {
                router.push('/dashboard/regional');
            } else {
                router.push('/dashboard');
            }
        }
    }, [user, loading, router]);

    if (user) {
        return null;
    }

    const handleLogin = () => {
        login();
    };

    return (
        <div className="min-h-screen flex flex-col md:flex-row overflow-hidden" style={{ backgroundColor: '#f8f9fa' }}>
            {/* Left panel — gradient with BFP branding */}
            <div
                className="relative w-full md:w-[55%] min-h-[220px] md:min-h-screen login-wave-clip flex flex-col items-center justify-center px-8 py-12 md:py-0"
                style={{ background: 'var(--bfp-gradient)' }}
            >
                {/* Subtle geometric pattern overlay */}
                <div
                    className="absolute inset-0 opacity-[0.04]"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                    }}
                />

                <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                    {/* BFP Logo */}
                    <div className="relative w-28 h-28 md:w-36 md:h-36 mb-6 drop-shadow-lg">
                        <Image
                            src="/bfp-logo.svg"
                            alt="Bureau of Fire Protection"
                            fill
                            className="object-contain"
                            priority
                        />
                    </div>

                    <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-3">
                        Web-based Incident
                        <br />
                        Management System
                    </h1>
                    <p className="text-white/70 text-sm md:text-base">
                        Bureau of Fire Protection
                    </p>

                    {/* Decorative line */}
                    <div className="mt-6 w-16 h-0.5 bg-white/30 rounded-full" />
                </div>
            </div>

            {/* Right panel — Login form */}
            <div className="flex-1 flex items-center justify-center px-6 py-12 md:py-0">
                <div className="w-full max-w-sm space-y-8">
                    {/* Welcome text */}
                    <div className="text-center md:text-left">
                        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            Welcome Back
                        </h2>
                        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Sign in to continue to WIMS-BFP
                        </p>
                    </div>

                    {/* Login card */}
                    <div className="card">
                        <div className="card-body space-y-6">
                            {/* Info blurb */}
                            <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                                <Shield className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    Authentication is managed through Keycloak SSO.
                                    You will be redirected to the secure login portal.
                                </p>
                            </div>

                            {/* Login button */}
                            <button
                                onClick={handleLogin}
                                className="group w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-white rounded-lg transition-all duration-200 shadow-md hover:shadow-lg cursor-pointer uppercase tracking-wide"
                                style={{ background: 'var(--bfp-gradient)' }}
                            >
                                Login with Keycloak
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </div>

                    {/* Copyright */}
                    <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                        &copy; 2026 Bureau of Fire Protection. All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    );
}
