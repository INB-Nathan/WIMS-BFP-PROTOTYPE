'use client';

import { Suspense, useEffect } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { defaultRouteForRole } from '@/lib/roleRedirect';
import { ArrowRight, CheckCircle, Lock } from 'lucide-react';
import { PublicThemeProvider } from '@/components/public/PublicThemeProvider';
import '@/styles/public-surface.css';

function RegistrationBanner() {
    const searchParams = useSearchParams();
    const registered = searchParams.get('registered') === 'true';
    if (!registered) return null;
    return (
        <div
            role="alert"
            className="ps-registration-banner"
        >
            <CheckCircle className="w-4 h-4" aria-hidden />
            Account created! Sign in to continue.
        </div>
    );
}

function LoginInner() {
    const router = useRouter();
    const { user, loading, login } = useAuth();

    useEffect(() => {
        if (!loading && user) {
            const role = (user as { role?: string })?.role;
            router.push(defaultRouteForRole(role));
        }
    }, [user, loading, router]);

    if (user) {
        return null;
    }

    const handleLogin = () => {
        login();
    };

    return (
        <div className="ps-auth-split">
            {/* Left Panel — BFP Branding */}
            <div className="ps-auth-branding">
                <div className="ps-branding-content">
                    <div className="ps-auth-logo">
                        <Image
                            src="/bfp-logo.svg"
                            alt="Bureau of Fire Protection"
                            fill
                            className="ps-logo"
                            priority
                        />
                    </div>

                    <h1 className="ps-brand-title">
                        Web-based Incident
                        <br />
                        Management System
                    </h1>
                    <p className="ps-brand-subtitle">Bureau of Fire Protection</p>

                    <div className="ps-brand-tagline">
                        <CheckCircle className="w-4 h-4" aria-hidden />
                        <span>Secured &bull; Monitored &bull; Explainable</span>
                    </div>
                </div>
            </div>

            {/* Right Panel — Login Form */}
            <div className="ps-auth-form">
                <div className="ps-form-container">
                    <h2 className="ps-form-title">Sign In</h2>
                    <p className="ps-form-subtitle">
                        Access the WIMS-BFP dashboard
                    </p>

                    <Suspense fallback={null}>
                        <RegistrationBanner />
                    </Suspense>

                    <div className="ps-form-card">
                        <div className="ps-sso-notice">
                            <Lock className="w-4 h-4 ps-sso-icon" aria-hidden />
                            <p>
                                Secure single sign-on powered by Keycloak.
                                Your credentials are never stored by this application.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={handleLogin}
                            className="ps-btn ps-btn-primary ps-btn-block"
                        >
                            Login with Keycloak
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>

                    <p className="ps-copyright">
                        &copy; 2026 Bureau of Fire Protection &mdash; All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <PublicThemeProvider>
            <LoginInner />
        </PublicThemeProvider>
    );
}
