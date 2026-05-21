'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { ArrowRight, Lock } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const { user, loading, login } = useAuth();

    useEffect(() => {
        if (!loading && user) {
            const role = (user as { role?: string })?.role;
            const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;

            // REGIONAL_ENCODER and NATIONAL_VALIDATOR require assigned region
            if (role === 'REGIONAL_ENCODER' && assignedRegionId) {
                router.push('/dashboard/regional');
            } else if ((role === 'NATIONAL_VALIDATOR' || role === 'VALIDATOR') && assignedRegionId) {
                router.push('/dashboard/validator');
            } else {
                // For other roles or if region not assigned, go to main dashboard
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
        <div className="login-page">
            {/* Left Panel — BFP Branding */}
            <div className="wims-login-branding">
                <div className="wims-branding-content">
                    <div className="wims-logo-wrap">
                        <Image
                            src="/bfp-logo.svg"
                            alt="Bureau of Fire Protection"
                            fill
                            className="wims-logo"
                            priority
                        />
                    </div>

                    <h1 className="wims-brand-title">
                        Web-based Incident
                        <br />
                        Management System
                    </h1>
                    <p className="wims-brand-subtitle">Bureau of Fire Protection</p>

                    <div className="wims-brand-tagline">
                        <Lock className="w-4 h-4" />
                        <span>Secured &bull; Monitored &bull; Explainable</span>
                    </div>
                </div>
            </div>

            {/* Right Panel — Login Form */}
            <div className="wims-login-form">
                <div className="wims-form-container">
                    <h2 className="wims-form-title">Sign In</h2>
                    <p className="wims-form-subtitle">
                        Access the WIMS-BFP dashboard
                    </p>

                    <div className="wims-form-card">
                        <div className="wims-sso-notice">
                            <Lock className="w-4 h-4 text-theme-accent-mid flex-shrink-0" />
                            <p>
                                Secure single sign-on powered by Keycloak.
                                Your credentials are never stored by this application.
                            </p>
                        </div>

                        <button
                            onClick={handleLogin}
                            className="wims-button"
                        >
                            Login with Keycloak
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>

                    <p className="wims-copyright">
                        &copy; 2026 Bureau of Fire Protection &mdash; All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    );
}