'use client';

import { Suspense, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { defaultRouteForRole } from '@/lib/roleRedirect';
import { ArrowLeft, CheckCircle, Lock } from 'lucide-react';
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
        <div className="ps-auth-split ps-auth-login">
            <Link href="/" className="ps-login-return" data-testid="login-return">
                <ArrowLeft className="w-4 h-4" aria-hidden />
                Return to WIMS-BFP
            </Link>

            {/* Left Panel — BFP Branding */}
            <div className="ps-auth-branding">
                <div className="ps-branding-content">
                    <div className="ps-auth-logo">
                        <Image
                            src="/bfp-logo.svg"
                            alt="Bureau of Fire Protection"
                            width={96}
                            height={96}
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
                    <div className="ps-form-head">
                        <p className="ps-form-eyebrow">Bureau of Fire Protection</p>
                        <h2 className="ps-form-title">Sign in to your account</h2>
                        <p className="ps-form-subtitle">
                            Authorized access to the WIMS-BFP incident management system.
                        </p>
                    </div>

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
                            className="ps-btn ps-btn-auth ps-btn-block"
                        >
                            <Lock className="w-4 h-4" aria-hidden />
                            Continue to secure sign-in
                        </button>
                    </div>

                    <p className="ps-form-foot">
                        New to WIMS-BFP?{' '}
                        <Link href="/register" className="ps-form-link">
                            Create a reporter account
                        </Link>
                    </p>

                    <p className="ps-copyright">
                        &copy; 2026 Bureau of Fire Protection &mdash; All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return <LoginInner />;
}
